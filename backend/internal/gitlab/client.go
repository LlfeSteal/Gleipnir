// Package gitlab reads the board data from GitLab's GraphQL API (read only).
package gitlab

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"gleipnir/internal/board"
)

// Errors the API maps to explicit messages.
var (
	ErrUnauthorized    = errors.New("gitlab rejected the token")
	ErrGroupNotFound   = errors.New("group not found or not accessible")
	ErrPremiumRequired = errors.New("epics, iterations or blocking links need GitLab Premium or Ultimate")
	ErrNoCadence       = errors.New("no iteration cadence found for the group")
	ErrCadenceNotFound = errors.New("configured iteration cadence not found")
)

// Defaults of the Client limits (fields, so the tests can lower them).
const (
	// defaultMaxBody caps a GraphQL response: a page of 100 work items with their links is a
	// few hundred KB, so this only stops a runaway (or hostile) instance from eating the memory.
	defaultMaxBody = 64 << 20
	// defaultMaxPages caps a walk (100 nodes a page): a cursor that never ends must not loop forever.
	defaultMaxPages = 1000
)

// Client fetches one root group.
type Client struct {
	endpoint string
	baseURL  string
	token    string
	group    string
	cadence  string
	http     *http.Client
	now      func() time.Time // picks the default cadence; injectable for tests
	maxBody  int
	maxPages int
}

// New returns a client for the group rootGroup of the instance baseURL. cadence picks the
// iteration cadence by title or ID ("" = the one holding the current iteration).
func New(baseURL, token, rootGroup, cadence string) *Client {
	baseURL = strings.TrimRight(baseURL, "/")
	return &Client{
		endpoint: baseURL + "/api/graphql",
		baseURL:  baseURL,
		token:    token,
		group:    strings.Trim(rootGroup, "/"),
		cadence:  strings.TrimSpace(cadence),
		// A work items page of a mid-size group takes 3–8 s on gitlab.com.
		http:     &http.Client{Timeout: 60 * time.Second},
		now:      time.Now,
		maxBody:  defaultMaxBody,
		maxPages: defaultMaxPages,
	}
}

// Fetch walks GitLab and returns the raw board data. Groups, the cadence (then its
// iterations) and the work items are fetched concurrently; the first error cancels the rest.
func (c *Client) Fetch(ctx context.Context) (*board.Raw, error) {
	raw := &board.Raw{GitLabURL: c.baseURL}
	err := runAll(ctx,
		func(ctx context.Context) (err error) {
			raw.RootGroup, raw.Groups, err = c.fetchGroups(ctx)
			return err
		},
		func(ctx context.Context) (err error) {
			raw.Cadence, raw.Iterations, err = c.fetchCadence(ctx)
			return err
		},
		func(ctx context.Context) (err error) {
			raw.Items, err = c.fetchItems(ctx)
			return err
		},
	)
	if err != nil {
		return nil, err
	}
	return raw, nil
}

func (c *Client) fetchGroups(ctx context.Context) (board.Group, []board.Group, error) {
	var root board.Group
	var groups []board.Group
	err := c.paginate(ctx, "Groups", groupsQuery, nil, func(g *groupData) pageInfo {
		root = board.Group{Path: g.FullPath, Name: g.Name}
		for _, n := range g.DescendantGroups.Nodes {
			groups = append(groups, board.Group{Path: n.FullPath, Name: n.Name})
		}
		return g.DescendantGroups.PageInfo
	})
	return root, groups, err
}

// fetchCadence lists the cadences (and, when none is configured, the iterations running
// today), picks one, then fetches its iterations.
func (c *Client) fetchCadence(ctx context.Context) (board.Cadence, []board.RawIteration, error) {
	var cadences []cadenceNode
	var current []string // cadence IDs having an iteration that contains today
	fetchCadences := func(ctx context.Context) error {
		return c.paginate(ctx, "Cadences", cadencesQuery, nil, func(g *groupData) pageInfo {
			cadences = append(cadences, g.IterationCadences.Nodes...)
			return g.IterationCadences.PageInfo
		})
	}
	fetchCurrent := func(ctx context.Context) error {
		if c.cadence != "" {
			return nil
		}
		vars := map[string]any{"today": c.now().Format("2006-01-02")}
		return c.paginate(ctx, "CurrentIterations", currentIterationsQuery, vars, func(g *groupData) pageInfo {
			for _, it := range g.Iterations.Nodes {
				if it.IterationCadence != nil {
					current = append(current, it.IterationCadence.ID)
				}
			}
			return g.Iterations.PageInfo
		})
	}
	if err := runAll(ctx, fetchCadences, fetchCurrent); err != nil {
		return board.Cadence{}, nil, err
	}

	chosen, err := chooseCadence(cadences, c.cadence, current)
	if err != nil {
		return board.Cadence{}, nil, err
	}

	var iterations []board.RawIteration
	vars := map[string]any{"cadenceId": chosen.ID}
	err = c.paginate(ctx, "Iterations", iterationsQuery, vars, func(g *groupData) pageInfo {
		for _, n := range g.Iterations.Nodes {
			// Defensive: the filter already keeps the cadence's iterations only.
			if n.IterationCadence == nil || n.IterationCadence.ID == chosen.ID {
				iterations = append(iterations, convertIteration(n))
			}
		}
		return g.Iterations.PageInfo
	})
	if err != nil {
		return board.Cadence{}, nil, err
	}
	return board.Cadence{ID: chosen.ID, Title: strings.TrimSpace(chosen.Title)}, iterations, nil
}

func (c *Client) fetchItems(ctx context.Context) ([]board.RawItem, error) {
	var items []board.RawItem
	err := c.paginate(ctx, "WorkItems", workItemsQuery, nil, func(g *groupData) pageInfo {
		for _, n := range g.WorkItems.Nodes {
			if item, ok := convertItem(n); ok {
				items = append(items, item)
			}
		}
		return g.WorkItems.PageInfo
	})
	return items, err
}

// paginate runs query page by page with vars plus $fullPath and $after (null on the first
// page); collect accumulates the nodes and returns the connection's pageInfo.
func (c *Client) paginate(ctx context.Context, name, query string, vars map[string]any, collect func(*groupData) pageInfo) error {
	variables := make(map[string]any, len(vars)+2)
	for k, v := range vars {
		variables[k] = v
	}
	variables["fullPath"] = c.group
	var cursor *string // nil → JSON null: "" is rejected as a cursor

	for page := 1; ; page++ {
		if page > c.maxPages {
			return fmt.Errorf("gitlab %s: more than %d pages, giving up", name, c.maxPages)
		}
		variables["after"] = cursor
		group, err := c.doGraphQL(ctx, name, query, variables)
		if err != nil {
			return err
		}
		info := collect(group)
		if !info.HasNextPage || info.EndCursor == "" {
			return nil
		}
		if cursor != nil && *cursor == info.EndCursor {
			return fmt.Errorf("gitlab %s: pagination stuck on cursor %q", name, info.EndCursor)
		}
		next := info.EndCursor
		cursor = &next
	}
}

func (c *Client) doGraphQL(ctx context.Context, name, query string, variables map[string]any) (*groupData, error) {
	reqBody, err := json.Marshal(map[string]any{"query": query, "variables": variables})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(reqBody))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "gleipnir")
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("gitlab request failed: %w", err)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, int64(c.maxBody)+1))
	resp.Body.Close()
	if err != nil {
		return nil, fmt.Errorf("reading gitlab response: %w", err)
	}
	if len(body) > c.maxBody {
		return nil, fmt.Errorf("gitlab %s: response larger than %d bytes", name, c.maxBody)
	}

	switch resp.StatusCode {
	case http.StatusUnauthorized:
		return nil, ErrUnauthorized
	case http.StatusForbidden:
		// A token without the read_api scope: GitLab answers 403 insufficient_scope.
		if bytes.Contains(body, []byte("insufficient_scope")) {
			return nil, fmt.Errorf("%w: it lacks the read_api scope", ErrUnauthorized)
		}
	case http.StatusTooManyRequests:
		// No retry: the sync fails (gitlab_unreachable) and the cached board stays served.
		msg := "gitlab rate limited the requests (HTTP 429)"
		if s, err := strconv.Atoi(strings.TrimSpace(resp.Header.Get("Retry-After"))); err == nil && s > 0 {
			msg += fmt.Sprintf(", retry in %s", time.Duration(s)*time.Second)
		}
		return nil, errors.New(msg)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("gitlab returned HTTP %d: %s", resp.StatusCode, truncate(string(body), 200))
	}

	var gql gqlResponse
	if err := json.Unmarshal(body, &gql); err != nil {
		return nil, fmt.Errorf("decoding gitlab response: %w", err)
	}
	// GraphQL errors come back with HTTP 200.
	if len(gql.Errors) > 0 {
		msgs := make([]string, len(gql.Errors))
		premium := false
		for i, e := range gql.Errors {
			msgs[i] = e.Message
			premium = premium || isPremiumError(e)
		}
		if premium {
			return nil, fmt.Errorf("%w: %s", ErrPremiumRequired, strings.Join(msgs, "; "))
		}
		return nil, fmt.Errorf("gitlab graphql error (%s): %s", name, strings.Join(msgs, "; "))
	}
	if gql.Data.Group == nil {
		return nil, ErrGroupNotFound
	}
	return gql.Data.Group, nil
}

// Errors meaning the instance lacks a paid-tier feature we need: the schema of an
// unlicensed or CE instance has no iteration/linked-item fields, types or enum values, and
// gitlab.com answers a free group's iterationCadences with a permission error.
var (
	premiumSchemaError = regexp.MustCompile(
		`Field '(iterationCadences|iterations|iterationCadence|iteration|linkedItems)' doesn't exist` +
			`|No such type (WorkItemWidgetIteration|WorkItemWidgetLinkedItems|IterationCadence|Iteration)\b` +
			`|^(IterationsCadenceID|IterationSort|WorkItemRelatedLinkType|Timeframe) isn't a defined input type` +
			`|Argument '(types|onlyTypes|filter|sort|iterationCadenceIds|timeframe|includeAncestorGroups)' on Field '(workItems|widgets|linkedItems|iterations|iterationCadences)' has an invalid value`)
	premiumPaths = map[string]bool{"iterationCadences": true, "iterations": true, "linkedItems": true}
)

// isPremiumError tells whether a GraphQL error means a Premium feature is unavailable.
func isPremiumError(e gqlError) bool {
	if premiumSchemaError.MatchString(e.Message) {
		return true
	}
	if strings.Contains(e.Message, "does not exist or you don't have permission") {
		for _, p := range e.Path {
			if s, ok := p.(string); ok && premiumPaths[s] {
				return true
			}
		}
	}
	return false
}

// runAll runs fns concurrently and returns the first error; that error cancels the context
// the others run with.
func runAll(ctx context.Context, fns ...func(context.Context) error) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	var (
		wg       sync.WaitGroup
		once     sync.Once
		firstErr error
	)
	for _, fn := range fns {
		wg.Add(1)
		go func(fn func(context.Context) error) {
			defer wg.Done()
			if err := fn(ctx); err != nil {
				once.Do(func() {
					firstErr = err
					cancel()
				})
			}
		}(fn)
	}
	wg.Wait()
	return firstErr
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	// ToValidUTF8 drops a rune cut in half.
	return strings.ToValidUTF8(s[:n], "") + "…"
}

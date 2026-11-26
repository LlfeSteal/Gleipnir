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
	// defaultMaxWalks caps the subtrees FetchItems walks at once: each walk is sequential
	// (cursors), so a few in parallel cut the wait without hammering the instance.
	defaultMaxWalks = 4
)

// Client fetches one root group.
type Client struct {
	endpoint string
	baseURL  string
	token    string
	group    string
	cadence  string
	http     *http.Client
	maxBody  int
	maxPages int
	maxWalks int // concurrent subtree walks of FetchItems
}

// New returns a client for the group rootGroup of the instance baseURL. cadence names the
// default active cadence by title or ID ("" = the ones holding the current iteration, ADR-38).
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
		maxBody:  defaultMaxBody,
		maxPages: defaultMaxPages,
		maxWalks: defaultMaxWalks,
	}
}

// Fetch walks GitLab and returns the raw board data. Groups, the cadences and iterations, and
// the work items are fetched concurrently; the first error cancels the rest.
func (c *Client) Fetch(ctx context.Context) (*board.Raw, error) {
	raw := &board.Raw{GitLabURL: c.baseURL}
	err := runAll(ctx,
		func(ctx context.Context) (err error) {
			raw.RootGroup, raw.Groups, err = c.fetchGroups(ctx)
			return err
		},
		func(ctx context.Context) (err error) {
			raw.Cadences, raw.ConfiguredCadence, raw.Iterations, err = c.fetchIterations(ctx)
			return err
		},
		func(ctx context.Context) (err error) {
			raw.Items, err = c.fetchItems(ctx, c.group)
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
	err := c.paginate(ctx, "Groups", groupsQuery, c.group, nil, func(g *groupData) pageInfo {
		root = board.Group{ID: g.ID, Path: g.FullPath, Name: g.Name}
		for _, n := range g.DescendantGroups.Nodes {
			groups = append(groups, board.Group{ID: n.ID, Path: n.FullPath, Name: n.Name})
		}
		return g.DescendantGroups.PageInfo
	})
	return root, groups, err
}

// fetchIterations lists the cadences and the iterations of all of them (ADR-38), and resolves
// the configured cadence ("" when none is). The cadences of the descendant groups are only
// known through their iterations.
func (c *Client) fetchIterations(ctx context.Context) ([]board.RawCadence, string, []board.RawIteration, error) {
	var nodes []cadenceNode
	var iterations []iterationNode
	err := runAll(ctx,
		func(ctx context.Context) error {
			return c.paginate(ctx, "Cadences", cadencesQuery, c.group, nil, func(g *groupData) pageInfo {
				nodes = append(nodes, g.IterationCadences.Nodes...)
				return g.IterationCadences.PageInfo
			})
		},
		func(ctx context.Context) error {
			return c.paginate(ctx, "Iterations", iterationsQuery, c.group, nil, func(g *groupData) pageInfo {
				iterations = append(iterations, g.Iterations.Nodes...)
				return g.Iterations.PageInfo
			})
		},
	)
	if err != nil {
		return nil, "", nil, err
	}
	known := make(map[string]bool, len(nodes))
	for _, n := range nodes {
		known[n.ID] = true
	}
	var raw []board.RawIteration
	for _, n := range iterations {
		if n.IterationCadence == nil || n.IterationCadence.ID == "" {
			continue // defensive: an iteration always has a cadence
		}
		if !known[n.IterationCadence.ID] {
			known[n.IterationCadence.ID] = true
			nodes = append(nodes, *n.IterationCadence)
		}
		raw = append(raw, convertIteration(n))
	}
	configured, err := configuredCadence(nodes, c.cadence)
	if err != nil {
		return nil, "", nil, err
	}
	cadences := make([]board.RawCadence, 0, len(nodes))
	for _, n := range nodes {
		cadences = append(cadences, board.RawCadence{ID: n.ID, Title: strings.TrimSpace(n.Title), Active: n.Active})
	}
	return cadences, configured, raw, nil
}

// FetchItems reads the epics and issues of the subtrees of groups (each group with its
// descendants and their projects), walking up to maxWalks subtrees at once. The groups should
// not overlap (see board.NormalizeScope); an item met twice is kept once anyway.
func (c *Client) FetchItems(ctx context.Context, groups []string) ([]board.RawItem, error) {
	results := make([][]board.RawItem, len(groups))
	slots := make(chan struct{}, max(c.maxWalks, 1))
	fns := make([]func(context.Context) error, len(groups))
	for i, group := range groups {
		fns[i] = func(ctx context.Context) (err error) {
			select {
			case slots <- struct{}{}:
			case <-ctx.Done():
				return ctx.Err()
			}
			defer func() { <-slots }()
			results[i], err = c.fetchItems(ctx, group)
			return err
		}
	}
	if err := runAll(ctx, fns...); err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	items := []board.RawItem{}
	for _, part := range results {
		for _, it := range part {
			if !seen[it.ID] {
				seen[it.ID] = true
				items = append(items, it)
			}
		}
	}
	return items, nil
}

// fetchItems reads the epics and issues of group and its descendants.
func (c *Client) fetchItems(ctx context.Context, group string) ([]board.RawItem, error) {
	var items []board.RawItem
	err := c.paginate(ctx, "WorkItems", workItemsQuery, group, nil, func(g *groupData) pageInfo {
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
func (c *Client) paginate(ctx context.Context, name, query, fullPath string, vars map[string]any, collect func(*groupData) pageInfo) error {
	variables := make(map[string]any, len(vars)+2)
	for k, v := range vars {
		variables[k] = v
	}
	variables["fullPath"] = fullPath
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

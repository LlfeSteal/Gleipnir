package gitlab

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"gleipnir/internal/board"
)

// gqlRequest is what the fake GitLab receives.
type gqlRequest struct {
	Op        string
	Query     string
	Variables map[string]any
	Auth      string
}

var opName = regexp.MustCompile(`^query (\w+)`)

// fakeGitLab answers each operation (Groups, Cadences, …) with its handler's JSON body and
// records every request.
type fakeGitLab struct {
	t        *testing.T
	mu       sync.Mutex
	requests []gqlRequest
	handlers map[string]func(r gqlRequest) (status int, body string)
}

func newFake(t *testing.T, handlers map[string]func(gqlRequest) (int, string)) (*fakeGitLab, *Client) {
	t.Helper()
	f := &fakeGitLab{t: t, handlers: handlers}
	srv := httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(srv.Close)
	c := New(srv.URL+"/", "tok", "root", "")
	c.now = func() time.Time { return time.Date(2026, 11, 23, 10, 0, 0, 0, time.UTC) }
	return f, c
}

func (f *fakeGitLab) serve(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost || r.URL.Path != "/api/graphql" {
		f.t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
		http.NotFound(w, r)
		return
	}
	var body struct {
		Query     string         `json:"query"`
		Variables map[string]any `json:"variables"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		f.t.Errorf("decoding request: %v", err)
	}
	req := gqlRequest{Query: body.Query, Variables: body.Variables, Auth: r.Header.Get("Authorization")}
	if m := opName.FindStringSubmatch(body.Query); m != nil {
		req.Op = m[1]
	}
	f.mu.Lock()
	f.requests = append(f.requests, req)
	h := f.handlers[req.Op]
	f.mu.Unlock()
	if h == nil {
		f.t.Errorf("no handler for operation %q", req.Op)
		http.Error(w, "no handler", http.StatusInternalServerError)
		return
	}
	status, resp := h(req)
	w.WriteHeader(status)
	_, _ = w.Write([]byte(resp))
}

// requestsFor returns the requests of one operation, all of them when op is "".
func (f *fakeGitLab) requestsFor(op string) []gqlRequest {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []gqlRequest
	for _, r := range f.requests {
		if op == "" || r.Op == op {
			out = append(out, r)
		}
	}
	return out
}

func ok(body string) func(gqlRequest) (int, string) {
	return func(gqlRequest) (int, string) { return http.StatusOK, body }
}

// group wraps a group's JSON fields into a GraphQL response.
func group(fields string) string { return `{"data":{"group":{` + fields + `}}}` }

const lastPage = `"pageInfo":{"hasNextPage":false,"endCursor":"end"}`

// healthy returns handlers for a small, valid root group.
func healthy() map[string]func(gqlRequest) (int, string) {
	return map[string]func(gqlRequest) (int, string){
		"Groups": ok(group(`"id":"gid://gitlab/Group/1","fullPath":"root","name":"Root","descendantGroups":{` + lastPage +
			`,"nodes":[{"id":"gid://gitlab/Group/9","fullPath":"root/a","name":"A"}]}`)),
		"Cadences": ok(group(`"iterationCadences":{` + lastPage + `,"nodes":[` +
			`{"id":"gid://gitlab/Iterations::Cadence/1","title":"Old","active":false},` +
			`{"id":"gid://gitlab/Iterations::Cadence/2","title":"Sprints ","active":true}]}`)),
		"CurrentIterations": ok(group(`"iterations":{` + lastPage + `,"nodes":[` +
			`{"id":"gid://gitlab/Iteration/20","iterationCadence":{"id":"gid://gitlab/Iterations::Cadence/2"}}]}`)),
		"Iterations": ok(group(`"iterations":{` + lastPage + `,"nodes":[` +
			`{"id":"gid://gitlab/Iteration/20","title":null,"sequence":7,"startDate":"2026-11-16","dueDate":"2026-11-29T00:00:00Z",` +
			`"webUrl":"https://gl/it/20","iterationCadence":{"id":"gid://gitlab/Iterations::Cadence/2","title":"Sprints "}}]}`)),
		"WorkItems": ok(group(`"workItems":{` + lastPage + `,"nodes":[` +
			`{"id":"gid://gitlab/WorkItem/1","iid":"18","title":"Epic","state":"OPEN","webUrl":"u1",` +
			`"namespace":{"id":"gid://gitlab/Group/9","fullPath":"root/a"},"workItemType":{"name":"Epic"},"widgets":[]}]}`)),
	}
}

func TestFetchHappyPath(t *testing.T) {
	f, c := newFake(t, healthy())
	raw, err := c.Fetch(context.Background())
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	if raw.GitLabURL != c.baseURL || strings.HasSuffix(raw.GitLabURL, "/") {
		t.Errorf("GitLabURL = %q", raw.GitLabURL)
	}
	if raw.RootGroup != (board.Group{ID: "gid://gitlab/Group/1", Path: "root", Name: "Root"}) {
		t.Errorf("RootGroup = %+v", raw.RootGroup)
	}
	if len(raw.Groups) != 1 || raw.Groups[0] != (board.Group{ID: "gid://gitlab/Group/9", Path: "root/a", Name: "A"}) {
		t.Errorf("Groups = %+v", raw.Groups)
	}
	if raw.Cadence.ID != "gid://gitlab/Iterations::Cadence/2" || raw.Cadence.Title != "Sprints" {
		t.Errorf("Cadence = %+v", raw.Cadence)
	}
	if len(raw.Iterations) != 1 {
		t.Fatalf("Iterations = %+v", raw.Iterations)
	}
	it := raw.Iterations[0]
	if it.Title != "" || it.Sequence != 7 || it.StartDate != "2026-11-16" || it.DueDate != "2026-11-29" || it.WebURL != "https://gl/it/20" {
		t.Errorf("Iteration = %+v", it)
	}
	if len(raw.Items) != 1 || raw.Items[0].Kind != "epic" {
		t.Errorf("Items = %+v", raw.Items)
	}

	for _, r := range f.requestsFor("") {
		if r.Auth != "Bearer tok" {
			t.Errorf("%s: Authorization = %q", r.Op, r.Auth)
		}
		if r.Variables["fullPath"] != "root" {
			t.Errorf("%s: fullPath = %v", r.Op, r.Variables["fullPath"])
		}
	}
	if got := f.requestsFor("CurrentIterations")[0].Variables["today"]; got != "2026-11-23" {
		t.Errorf("today = %v", got)
	}
	if got := f.requestsFor("Iterations")[0].Variables["cadenceId"]; got != "gid://gitlab/Iterations::Cadence/2" {
		t.Errorf("cadenceId = %v", got)
	}
}

func TestPaginationCursorNullThenEndCursor(t *testing.T) {
	h := healthy()
	h["Groups"] = func(r gqlRequest) (int, string) {
		if r.Variables["after"] == nil {
			return http.StatusOK, group(`"fullPath":"root","name":"Root","descendantGroups":{` +
				`"pageInfo":{"hasNextPage":true,"endCursor":"c1"},"nodes":[{"fullPath":"root/a","name":"A"}]}`)
		}
		return http.StatusOK, group(`"fullPath":"root","name":"Root","descendantGroups":{` + lastPage +
			`,"nodes":[{"fullPath":"root/b","name":"B"}]}`)
	}
	f, c := newFake(t, h)
	raw, err := c.Fetch(context.Background())
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	reqs := f.requestsFor("Groups")
	if len(reqs) != 2 {
		t.Fatalf("%d Groups requests, want 2", len(reqs))
	}
	if v, present := reqs[0].Variables["after"]; !present || v != nil {
		t.Errorf("first page after = %v (present %v), want null", v, present)
	}
	if reqs[1].Variables["after"] != "c1" {
		t.Errorf("second page after = %v, want c1", reqs[1].Variables["after"])
	}
	if len(raw.Groups) != 2 || raw.Groups[1].Path != "root/b" {
		t.Errorf("Groups = %+v", raw.Groups)
	}
}

func TestPaginationStuckCursor(t *testing.T) {
	h := healthy()
	h["Groups"] = ok(group(`"fullPath":"root","name":"Root","descendantGroups":{` +
		`"pageInfo":{"hasNextPage":true,"endCursor":"same"},"nodes":[]}`))
	_, c := newFake(t, h)
	if _, err := c.Fetch(context.Background()); err == nil || !strings.Contains(err.Error(), "stuck") {
		t.Fatalf("err = %v, want a stuck pagination error", err)
	}
}

func TestErrors(t *testing.T) {
	everywhere := func(status int, body string) map[string]func(gqlRequest) (int, string) {
		h := healthy()
		for op := range h {
			h[op] = func(gqlRequest) (int, string) { return status, body }
		}
		return h
	}
	tests := []struct {
		name     string
		handlers map[string]func(gqlRequest) (int, string)
		is       error
		contains string
	}{
		{"401", everywhere(http.StatusUnauthorized, `{"message":"401 Unauthorized"}`), ErrUnauthorized, ""},
		{"group null", everywhere(http.StatusOK, `{"data":{"group":null}}`), ErrGroupNotFound, ""},
		{"HTTP 500", everywhere(http.StatusInternalServerError, strings.Repeat("x", 500)), nil, "HTTP 500: xxx"},
		{"graphql error", everywhere(http.StatusOK, `{"errors":[{"message":"Request timed out."}],"data":null}`), nil, "Request timed out."},
		{"premium", func() map[string]func(gqlRequest) (int, string) {
			h := healthy()
			h["Cadences"] = ok(`{"errors":[{"message":"Field 'iterationCadences' doesn't exist on type 'Group'"}],"data":null}`)
			return h
		}(), ErrPremiumRequired, "Field 'iterationCadences' doesn't exist on type 'Group'"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, c := newFake(t, tt.handlers)
			raw, err := c.Fetch(context.Background())
			if err == nil || raw != nil {
				t.Fatalf("Fetch = %v, %v; want an error", raw, err)
			}
			if tt.is != nil && !errors.Is(err, tt.is) {
				t.Errorf("err = %v, want %v", err, tt.is)
			}
			if tt.is == nil && errors.Is(err, ErrPremiumRequired) {
				t.Errorf("err = %v, must not be ErrPremiumRequired", err)
			}
			if !strings.Contains(err.Error(), tt.contains) {
				t.Errorf("err = %q, want it to contain %q", err, tt.contains)
			}
			if len(err.Error()) > 400 {
				t.Errorf("error not truncated: %d bytes", len(err.Error()))
			}
		})
	}
}

func TestIsPremiumError(t *testing.T) {
	tests := []struct {
		msg  string
		path []any
		want bool
	}{
		{"Field 'iterationCadences' doesn't exist on type 'Group'", nil, true},
		{"Field 'iterations' doesn't exist on type 'Group'", nil, true},
		{"Field 'linkedItems' doesn't exist on type 'WorkItemWidgetLinkedItems'", nil, true},
		{"No such type WorkItemWidgetLinkedItems, so it can't be a fragment condition", nil, true},
		{"No such type WorkItemWidgetIteration, so it can't be a fragment condition", nil, true},
		{"IterationsCadenceID isn't a defined input type (on $cadenceId)", nil, true},
		{"Argument 'types' on Field 'workItems' has an invalid value ([EPIC, ISSUE]). Expected type '[IssueType!]'.", nil, true},
		{"Argument 'onlyTypes' on Field 'widgets' has an invalid value ([ITERATION]). Expected type '[WorkItemWidgetType!]'.", nil, true},
		{"Argument 'filter' on Field 'linkedItems' has an invalid value (BLOCKS). Expected type 'WorkItemRelatedLinkType'.", nil, true},
		{"The resource that you are attempting to access does not exist or you don't have permission to perform this action",
			[]any{"group", "iterationCadences"}, true},
		{"The resource that you are attempting to access does not exist or you don't have permission to perform this action",
			[]any{"group", "workItems", "nodes", 0.0}, false},
		{"Field 'nme' doesn't exist on type 'Group'", nil, false},
		{"No such type WorkItemWidgetFoo, so it can't be a fragment condition", nil, false},
		{"Request timed out. Please try a less complex query or a smaller set of records.", nil, false},
		{"Query has complexity of 260, which exceeds max complexity of 250", nil, false},
	}
	for _, tt := range tests {
		if got := isPremiumError(gqlError{Message: tt.msg, Path: tt.path}); got != tt.want {
			t.Errorf("isPremiumError(%q, %v) = %v, want %v", tt.msg, tt.path, got, tt.want)
		}
	}
}

func TestCadenceErrorsThroughFetch(t *testing.T) {
	h := healthy()
	h["Cadences"] = ok(group(`"iterationCadences":{` + lastPage + `,"nodes":[]}`))
	_, c := newFake(t, h)
	if _, err := c.Fetch(context.Background()); !errors.Is(err, ErrNoCadence) {
		t.Errorf("no cadence: err = %v", err)
	}

	f, c := newFake(t, healthy())
	c.cadence = "nope"
	if _, err := c.Fetch(context.Background()); !errors.Is(err, ErrCadenceNotFound) || !strings.Contains(err.Error(), `"nope"`) {
		t.Errorf("unknown cadence: err = %v", err)
	}
	if n := len(f.requestsFor("CurrentIterations")); n != 0 {
		t.Errorf("configured cadence: %d CurrentIterations requests, want 0", n)
	}
}

// TestFetchRunsConcurrently: each top-level query waits until the three have arrived, which
// only happens if Fetch sends them together.
func TestFetchRunsConcurrently(t *testing.T) {
	var arrived sync.WaitGroup
	arrived.Add(3)
	all := make(chan struct{})
	go func() { arrived.Wait(); close(all) }()
	barrier := func(next func(gqlRequest) (int, string)) func(gqlRequest) (int, string) {
		var once sync.Once
		return func(r gqlRequest) (int, string) {
			once.Do(arrived.Done)
			select {
			case <-all:
				return next(r)
			case <-time.After(5 * time.Second):
				return http.StatusInternalServerError, "queries were not concurrent"
			}
		}
	}
	h := healthy()
	for _, op := range []string{"Groups", "Cadences", "WorkItems"} {
		h[op] = barrier(h[op])
	}
	_, c := newFake(t, h)
	if _, err := c.Fetch(context.Background()); err != nil {
		t.Fatalf("Fetch: %v", err)
	}
}

// TestFirstErrorCancelsOthers: a failing query cancels the slow ones instead of waiting.
func TestFirstErrorCancelsOthers(t *testing.T) {
	release := make(chan struct{})
	defer close(release)
	h := healthy()
	slow := func(gqlRequest) (int, string) {
		<-release
		return http.StatusOK, `{"data":{"group":null}}`
	}
	h["Groups"] = slow
	h["WorkItems"] = slow
	h["Cadences"] = func(gqlRequest) (int, string) { return http.StatusUnauthorized, "" }
	_, c := newFake(t, h)
	done := make(chan error, 1)
	go func() { _, err := c.Fetch(context.Background()); done <- err }()
	select {
	case err := <-done:
		if !errors.Is(err, ErrUnauthorized) {
			t.Errorf("err = %v, want ErrUnauthorized", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Fetch kept waiting for the other queries")
	}
}

func TestRunAll(t *testing.T) {
	boom := errors.New("boom")
	err := runAll(context.Background(),
		func(ctx context.Context) error { return boom },
		func(ctx context.Context) error { <-ctx.Done(); return ctx.Err() },
	)
	if err != boom {
		t.Errorf("runAll = %v, want boom", err)
	}
	if err := runAll(context.Background(), func(context.Context) error { return nil }); err != nil {
		t.Errorf("runAll = %v, want nil", err)
	}
}

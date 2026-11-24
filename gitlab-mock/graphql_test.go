package main

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// now is a Wednesday: Itération 15 runs from Monday 2026-11-23 to 2026-12-06.
var now = time.Date(2026, 11, 25, 10, 0, 0, 0, time.UTC)

func newServer(pageSize int, logs io.Writer) http.Handler {
	if logs == nil {
		logs = io.Discard
	}
	s := &server{pageSize: pageSize, now: func() time.Time { return now }, logger: slog.New(slog.NewTextHandler(logs, nil))}
	return s.handler()
}

// response is the GraphQL response, with the group kept raw.
type response struct {
	Data struct {
		Group json.RawMessage `json:"group"`
	} `json:"data"`
	Errors []gqlError `json:"errors"`
}

type pageInfo struct {
	HasNextPage bool    `json:"hasNextPage"`
	EndCursor   *string `json:"endCursor"`
}

func post(t *testing.T, h http.Handler, query string, vars map[string]any, header http.Header) (int, response) {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"query": query, "variables": vars})
	req := httptest.NewRequest(http.MethodPost, "/api/graphql", bytes.NewReader(body))
	for k, v := range header {
		req.Header[k] = v
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var res response
	if rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
			t.Fatalf("invalid JSON: %v: %s", err, rec.Body)
		}
	}
	return rec.Code, res
}

// The operation headers of Gleipnir's queries (backend/internal/gitlab/queries.go).
const (
	qGroups     = "query Groups($fullPath: ID!, $after: String) { … }"
	qCadences   = "query Cadences($fullPath: ID!, $after: String) { … }"
	qCurrent    = "query CurrentIterations($fullPath: ID!, $today: Date!, $after: String) { … }"
	qIterations = "query Iterations($fullPath: ID!, $cadenceId: IterationsCadenceID!, $after: String) { … }"
	qWorkItems  = "\n  query WorkItems($fullPath: ID!, $after: String) { … }"
)

// walk follows the cursors of a connection named field and returns every node.
func walk[T any](t *testing.T, h http.Handler, query, field string, vars map[string]any) []T {
	t.Helper()
	var all []T
	var after any
	for pages := 0; ; pages++ {
		if pages > 100 {
			t.Fatal("pagination never ends")
		}
		v := map[string]any{"after": after}
		for k, x := range vars {
			v[k] = x
		}
		code, res := post(t, h, query, v, nil)
		if code != http.StatusOK || len(res.Errors) > 0 {
			t.Fatalf("%s: HTTP %d, errors %v", field, code, res.Errors)
		}
		var group map[string]json.RawMessage
		if err := json.Unmarshal(res.Data.Group, &group); err != nil {
			t.Fatal(err)
		}
		var conn struct {
			PageInfo pageInfo `json:"pageInfo"`
			Nodes    []T      `json:"nodes"`
		}
		if err := json.Unmarshal(group[field], &conn); err != nil {
			t.Fatal(err)
		}
		all = append(all, conn.Nodes...)
		if !conn.PageInfo.HasNextPage {
			return all
		}
		after = *conn.PageInfo.EndCursor
	}
}

func TestHealth(t *testing.T) {
	rec := httptest.NewRecorder()
	newServer(10, nil).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/-/health", nil))
	if rec.Code != http.StatusOK || rec.Body.String() != "GitLab OK" {
		t.Fatalf("got %d %q", rec.Code, rec.Body)
	}
}

func TestRoutes(t *testing.T) {
	cases := map[string]struct {
		method, path string
		want         int
	}{
		"GET on graphql": {http.MethodGet, "/api/graphql", http.StatusMethodNotAllowed},
		"REST API":       {http.MethodGet, "/api/v4/groups", http.StatusNotFound},
		"root":           {http.MethodGet, "/", http.StatusNotFound},
		"POST on health": {http.MethodPost, "/-/health", http.StatusMethodNotAllowed},
	}
	for name, c := range cases {
		rec := httptest.NewRecorder()
		newServer(10, nil).ServeHTTP(rec, httptest.NewRequest(c.method, c.path, nil))
		if rec.Code != c.want {
			t.Errorf("%s: got %d, want %d", name, rec.Code, c.want)
		}
	}
}

func TestBadBodies(t *testing.T) {
	cases := map[string]struct {
		body string
		want int
	}{
		"not JSON":  {"{", http.StatusBadRequest},
		"too large": {`{"query":"` + strings.Repeat("x", maxBody) + `"}`, http.StatusRequestEntityTooLarge},
	}
	for name, c := range cases {
		rec := httptest.NewRecorder()
		newServer(10, nil).ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/graphql", strings.NewReader(c.body)))
		if rec.Code != c.want {
			t.Errorf("%s: got %d, want %d", name, rec.Code, c.want)
		}
	}
}

func TestGraphQLErrors(t *testing.T) {
	cases := map[string]struct {
		query string
		vars  map[string]any
		want  string
	}{
		"unknown operation":   {"query Projects($fullPath: ID!) { … }", map[string]any{"fullPath": "plateforme/atlas"}, `unsupported query "Projects"`},
		"anonymous query":     {"{ currentUser { id } }", nil, `unsupported query ""`},
		"cursor not base64":   {qGroups, map[string]any{"fullPath": "plateforme/atlas", "after": "%%%"}, "invalid cursor"},
		"cursor not offset":   {qGroups, map[string]any{"fullPath": "plateforme/atlas", "after": "YWJj"}, "invalid cursor"},
		"negative offset":     {qGroups, map[string]any{"fullPath": "plateforme/atlas", "after": "b2Zmc2V0Oi0x"}, "invalid cursor"},
		"offset past the end": {qCadences, map[string]any{"fullPath": "plateforme/atlas", "after": encodeCursor(5)}, "invalid cursor"},
		"cursor not a string": {qWorkItems, map[string]any{"fullPath": "plateforme/atlas", "after": 3}, "invalid cursor"},
		"no today":            {qCurrent, map[string]any{"fullPath": "plateforme/atlas"}, "$today"},
		"today not a date":    {qCurrent, map[string]any{"fullPath": "plateforme/atlas", "today": "demain"}, "$today"},
		"bad iterations page": {qIterations, map[string]any{"fullPath": "plateforme/atlas", "cadenceId": cadenceID, "after": "x"}, "invalid cursor"},
		"bad current page":    {qCurrent, map[string]any{"fullPath": "plateforme/atlas", "today": "2026-11-25", "after": "x"}, "invalid cursor"},
		"bad cadences page":   {qCadences, map[string]any{"fullPath": "plateforme/atlas", "after": "x"}, "invalid cursor"},
	}
	for name, c := range cases {
		code, res := post(t, newServer(10, nil), c.query, c.vars, nil)
		if code != http.StatusOK {
			t.Errorf("%s: GraphQL errors come with HTTP 200, got %d", name, code)
			continue
		}
		if len(res.Errors) != 1 || !strings.Contains(res.Errors[0].Message, c.want) {
			t.Errorf("%s: got errors %v, want %q", name, res.Errors, c.want)
		}
	}
}

func TestUnknownGroupIsNull(t *testing.T) {
	for _, path := range []string{"", "gitlab-org", "plateforme", "plateforme/atlas/identite/sso"} {
		code, res := post(t, newServer(10, nil), qGroups, map[string]any{"fullPath": path, "after": nil}, nil)
		if code != http.StatusOK || len(res.Errors) > 0 || string(res.Data.Group) != "null" {
			t.Errorf("%q: got %d %v %s, want group null", path, code, res.Errors, res.Data.Group)
		}
	}
}

func TestGroups(t *testing.T) {
	h := newServer(3, nil)
	nodes := walk[groupNode](t, h, qGroups, "descendantGroups", map[string]any{"fullPath": "plateforme/atlas"})
	if len(nodes) != 4 {
		t.Fatalf("got %d descendant groups, want 4: %v", len(nodes), nodes)
	}
	_, res := post(t, h, qGroups, map[string]any{"fullPath": "plateforme/atlas"}, nil)
	var root groupNode
	_ = json.Unmarshal(res.Data.Group, &root)
	if root != (groupNode{FullPath: "plateforme/atlas", Name: "Atlas"}) {
		t.Fatalf("root group: %+v", root)
	}
	if sub := walk[groupNode](t, h, qGroups, "descendantGroups", map[string]any{"fullPath": "plateforme/atlas/api"}); len(sub) != 0 {
		t.Fatalf("a leaf group has no descendants, got %v", sub)
	}
}

func TestCadences(t *testing.T) {
	nodes := walk[cadenceNode](t, newServer(10, nil), qCadences, "iterationCadences", map[string]any{"fullPath": "plateforme/atlas/data"})
	if len(nodes) != 1 || nodes[0] != (cadenceNode{ID: cadenceID, Title: cadenceTitle, Active: true}) {
		t.Fatalf("got %+v", nodes)
	}
}

func TestCurrentIterations(t *testing.T) {
	cases := map[string]struct {
		today string
		want  []string
	}{
		"first day":        {"2026-11-23", []string{"Itération 15"}},
		"last day":         {"2026-12-06", []string{"Itération 15"}},
		"next iteration":   {"2026-12-07", []string{"Itération 16"}},
		"holiday gap":      {"2027-01-04", nil},
		"before every one": {"2020-01-01", nil},
	}
	for name, c := range cases {
		nodes := walk[iterationNode](t, newServer(10, nil), qCurrent, "iterations", map[string]any{"fullPath": "plateforme/atlas", "today": c.today})
		var got []string
		for _, n := range nodes {
			got = append(got, *n.Title)
		}
		if strings.Join(got, ",") != strings.Join(c.want, ",") {
			t.Errorf("%s: got %v, want %v", name, got, c.want)
		}
	}
}

func TestIterations(t *testing.T) {
	h := newServer(4, nil)
	nodes := walk[iterationNode](t, h, qIterations, "iterations", map[string]any{"fullPath": "plateforme/atlas", "cadenceId": cadenceID})
	if len(nodes) != 10 || *nodes[0].Title != "Itération 12" || *nodes[9].Title != "Itération 21" {
		t.Fatalf("got %d iterations: %+v", len(nodes), nodes)
	}
	if nodes[3].StartDate != "2026-11-23" || nodes[3].DueDate != "2026-12-06" {
		t.Fatalf("Itération 15 must hold now: %+v", nodes[3])
	}
	// One week off between Itération 17 and 18.
	if nodes[5].DueDate != "2027-01-03" || nodes[6].StartDate != "2027-01-11" {
		t.Fatalf("holiday gap: %+v / %+v", nodes[5], nodes[6])
	}
	if other := walk[iterationNode](t, h, qIterations, "iterations", map[string]any{"fullPath": "plateforme/atlas", "cadenceId": "gid://gitlab/Iterations::Cadence/2"}); len(other) != 0 {
		t.Fatalf("another cadence has no iteration, got %d", len(other))
	}
}

func TestWorkItemsBySubtree(t *testing.T) {
	cases := map[string]struct {
		path          string
		epics, issues int
	}{
		"root":     {"plateforme/atlas", 12, 19},
		"subgroup": {"plateforme/atlas/api", 3, 5},
		"data":     {"plateforme/atlas/data", 2, 4},
	}
	for name, c := range cases {
		nodes := walk[workItemNode](t, newServer(3, nil), qWorkItems, "workItems", map[string]any{"fullPath": c.path})
		epics, issues := 0, 0
		seen := map[string]bool{}
		for _, n := range nodes {
			if seen[n.ID] {
				t.Errorf("%s: %s served twice", name, n.ID)
			}
			seen[n.ID] = true
			if n.Namespace.FullPath != c.path && !under(n.Namespace.FullPath, c.path) {
				t.Errorf("%s: %s is outside the subtree (%s)", name, n.ID, n.Namespace.FullPath)
			}
			switch n.WorkItemType.Name {
			case "Epic":
				epics++
			case "Issue":
				issues++
			}
		}
		if epics != c.epics || issues != c.issues {
			t.Errorf("%s: got %d epics and %d issues, want %d and %d", name, epics, issues, c.epics, c.issues)
		}
	}
}

func TestTokenIsIgnoredAndNeverLogged(t *testing.T) {
	var logs bytes.Buffer
	h := newServer(10, &logs)
	vars := map[string]any{"fullPath": "plateforme/atlas", "after": nil}
	_, anonymous := post(t, h, qGroups, vars, nil)
	_, authed := post(t, h, qGroups, vars, http.Header{"Authorization": {"Bearer glpat-secret"}})
	if string(anonymous.Data.Group) != string(authed.Data.Group) {
		t.Fatal("the token must not change the answer")
	}
	if strings.Contains(logs.String(), "glpat-secret") {
		t.Fatalf("the token was logged: %s", logs.String())
	}
	if !strings.Contains(logs.String(), "op=Groups") {
		t.Fatalf("the query is not logged: %s", logs.String())
	}
}

func TestPage(t *testing.T) {
	nodes := []int{1, 2, 3, 4, 5}
	first, _ := page(nodes, nil, 2)
	if len(first.Nodes) != 2 || !first.PageInfo.HasNextPage || *first.PageInfo.EndCursor != encodeCursor(2) {
		t.Fatalf("first page: %+v", first)
	}
	last, _ := page(nodes, encodeCursor(4), 2)
	if len(last.Nodes) != 1 || last.Nodes[0] != 5 || last.PageInfo.HasNextPage {
		t.Fatalf("last page: %+v", last)
	}
	empty, err := page([]int{}, nil, 2)
	if err != nil || empty.Nodes == nil || len(empty.Nodes) != 0 || empty.PageInfo.EndCursor != nil || empty.PageInfo.HasNextPage {
		t.Fatalf("empty: %+v %v (nodes must be [], endCursor null)", empty, err)
	}
	// A page must not alias the dataset.
	first.Nodes[0] = 99
	if nodes[0] != 1 {
		t.Fatal("page aliases its input")
	}
}

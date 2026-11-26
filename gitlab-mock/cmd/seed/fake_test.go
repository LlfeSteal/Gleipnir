package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
)

// fakeGitLab is a stateful GitLab: just enough REST and GraphQL for the seeder, refusing what
// a real instance refuses (names with "&", overlapping iterations, a parent that is not an
// epic, an assignee who is not a member, a link twice).
type fakeGitLab struct {
	mu  sync.Mutex
	srv *httptest.Server

	admin          bool
	noTypes        bool              // the instance has no Epic type (Free)
	autoIterations bool              // an automatic cadence creates its iterations at once
	failOp         map[string]string // operation or "METHOD path" → error message
	pageSize       int

	nextID     int
	groups     []*fGroup
	projects   []*fProject
	labels     []*fLabel
	users      map[string]int
	members    map[int]map[int]bool
	cadences   []*fCadence
	iterations []*fIteration
	items      []*fItem
	links      map[[2]string]string
	writes     int
}

type fGroup struct {
	id         int
	path, name string
}

type fProject struct {
	id, ns     int
	path, name string
}

type fLabel struct {
	id           int
	title, color string
}

type fCadence struct {
	id        int
	title     string
	automatic bool
	group     string // full path; "" matches any group (a cadence a test sets up)
}

type fIteration struct {
	id, cadence       int
	title, start, due string
}

type fItem struct {
	id                                              int
	typ, ns, title, state, start, due, iter, parent string
	labels, assignees                               []string
}

const (
	token    = "glpat-seed-secret"
	rootPath = "demo/gleipnir"
	epicType = "gid://gitlab/WorkItems::Type/8"
	issType  = "gid://gitlab/WorkItems::Type/1"
)

var gitlabName = regexp.MustCompile(`^[\p{L}\p{N}_][\p{L}\p{N}_.() \-]*$`)

func newFake(t *testing.T, admin bool) *fakeGitLab {
	f := &fakeGitLab{
		admin: admin, pageSize: 7, nextID: 100, failOp: map[string]string{},
		users: map[string]int{}, members: map[int]map[int]bool{}, links: map[[2]string]string{},
	}
	f.groups = []*fGroup{{id: 1, path: rootPath, name: "Gleipnir"}}
	f.srv = httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeGitLab) id() int { f.nextID++; return f.nextID }

func gid(kind string, id int) string { return fmt.Sprintf("gid://gitlab/%s/%d", kind, id) }

func num(gid string) int { n, _ := strconv.Atoi(lastSegment(gid)); return n }

func (f *fakeGitLab) serve(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if r.Header.Get("Authorization") != "Bearer "+token {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	var body map[string]any
	_ = json.NewDecoder(r.Body).Decode(&body)
	if r.URL.Path == "/api/graphql" {
		f.graphql(w, body)
		return
	}
	segs := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.EscapedPath(), "/api/v4"), "/"), "/")
	for i := range segs {
		segs[i], _ = url.PathUnescape(segs[i])
	}
	route := r.Method + " " + strings.Join(segs, "/")
	if msg, ok := f.failOp[r.Method+" "+segs[0]]; ok {
		http.Error(w, msg, http.StatusInternalServerError)
		return
	}
	status, out := f.rest(r, segs, body)
	if status == 0 {
		t := fmt.Sprintf("unexpected %s", route)
		http.Error(w, t, http.StatusTeapot)
		return
	}
	w.WriteHeader(status)
	if out != nil {
		_ = json.NewEncoder(w).Encode(out)
	}
}

func (f *fakeGitLab) group(path string) *fGroup {
	for _, g := range f.groups {
		if g.path == path {
			return g
		}
	}
	return nil
}

func (f *fakeGitLab) groupByID(id int) *fGroup {
	for _, g := range f.groups {
		if g.id == id {
			return g
		}
	}
	return nil
}

func (f *fakeGitLab) project(path string) *fProject {
	for _, p := range f.projects {
		if p.path == path {
			return p
		}
	}
	return nil
}

func (f *fakeGitLab) rest(r *http.Request, segs []string, body map[string]any) (int, any) {
	str := func(k string) string { s, _ := body[k].(string); return s }
	intv := func(k string) int { n, _ := body[k].(float64); return int(n) }
	switch {
	case r.Method == "GET" && segs[0] == "user":
		return 200, map[string]any{"username": "seeder", "is_admin": f.admin}
	case r.Method == "GET" && segs[0] == "groups" && len(segs) == 2:
		if g := f.group(segs[1]); g != nil {
			return 200, map[string]any{"id": g.id, "name": g.name}
		}
		return 404, nil
	case r.Method == "POST" && segs[0] == "groups" && len(segs) == 1:
		parent := f.groupByID(intv("parent_id"))
		if parent == nil || !gitlabName.MatchString(str("name")) {
			return 400, map[string]any{"message": "invalid group"}
		}
		g := &fGroup{id: f.id(), path: parent.path + "/" + str("path"), name: str("name")}
		f.groups = append(f.groups, g)
		f.writes++
		return 201, map[string]any{"id": g.id, "name": g.name}
	case r.Method == "PUT" && segs[0] == "groups" && len(segs) == 2:
		n, _ := strconv.Atoi(segs[1])
		f.groupByID(n).name = str("name")
		f.writes++
		return 200, map[string]any{}
	case r.Method == "GET" && segs[0] == "projects":
		if p := f.project(segs[1]); p != nil {
			return 200, map[string]any{"id": p.id}
		}
		return 404, nil
	case r.Method == "POST" && segs[0] == "projects":
		ns := f.groupByID(intv("namespace_id"))
		if ns == nil || !gitlabName.MatchString(str("name")) {
			return 400, map[string]any{"message": "invalid project"}
		}
		f.projects = append(f.projects, &fProject{id: f.id(), ns: ns.id, path: ns.path + "/" + str("path"), name: str("name")})
		f.writes++
		return 201, map[string]any{}
	case r.Method == "PUT" && segs[0] == "groups" && segs[2] == "labels":
		n, _ := strconv.Atoi(segs[3])
		for _, l := range f.labels {
			if l.id == n {
				l.color = str("new_color")
			}
		}
		f.writes++
		return 200, map[string]any{}
	case r.Method == "GET" && segs[0] == "users":
		if id, ok := f.users[r.URL.Query().Get("username")]; ok {
			return 200, []any{map[string]any{"id": id}}
		}
		return 200, []any{}
	case r.Method == "POST" && segs[0] == "users":
		if !f.admin {
			return 403, map[string]any{"message": "403 Forbidden"}
		}
		if str("password") == "" || !strings.HasSuffix(str("email"), "@gitlab.example.com") {
			return 400, map[string]any{"message": "invalid user"}
		}
		id := f.id()
		f.users[str("username")] = id
		f.writes++
		return 201, map[string]any{"id": id}
	case r.Method == "GET" && segs[0] == "groups" && segs[2] == "members":
		g, _ := strconv.Atoi(segs[1])
		u, _ := strconv.Atoi(segs[3])
		if f.members[g][u] {
			return 200, map[string]any{}
		}
		return 404, nil
	case r.Method == "POST" && segs[0] == "groups" && segs[2] == "members":
		g, _ := strconv.Atoi(segs[1])
		if f.members[g] == nil {
			f.members[g] = map[int]bool{}
		}
		if f.members[g][intv("user_id")] {
			return 409, map[string]any{"message": "Member already exists"}
		}
		f.members[g][intv("user_id")] = true
		f.writes++
		return 201, map[string]any{}
	}
	return 0, nil
}

// page cuts nodes at the cursor "o:N".
func (f *fakeGitLab) page(nodes []any, after any) map[string]any {
	start := 0
	if s, ok := after.(string); ok {
		start, _ = strconv.Atoi(strings.TrimPrefix(s, "o:"))
	}
	end := min(start+f.pageSize, len(nodes))
	return map[string]any{
		"pageInfo": map[string]any{"hasNextPage": end < len(nodes), "endCursor": fmt.Sprintf("o:%d", end)},
		"nodes":    append([]any{}, nodes[start:end]...),
	}
}

func (f *fakeGitLab) overlaps(it *fIteration) bool {
	for _, o := range f.iterations {
		if o.id != it.id && o.cadence == it.cadence && it.start <= o.due && o.start <= it.due {
			return true
		}
	}
	return false
}

func (f *fakeGitLab) graphql(w http.ResponseWriter, body map[string]any) {
	query, _ := body["query"].(string)
	vars, _ := body["variables"].(map[string]any)
	op := operation(query)
	reply := func(data any) { _ = json.NewEncoder(w).Encode(map[string]any{"data": data}) }
	if msg, ok := f.failOp[op]; ok {
		_ = json.NewEncoder(w).Encode(map[string]any{"errors": []any{map[string]any{"message": msg}}})
		return
	}
	in, _ := vars["input"].(map[string]any)
	str := func(m map[string]any, k string) string { s, _ := m[k].(string); return s }
	payload := func(field string, obj string, id string, errs ...string) {
		p := map[string]any{"errors": append([]string{}, errs...)}
		if obj != "" && len(errs) == 0 {
			p[obj] = map[string]any{"id": id}
		}
		if len(errs) == 0 {
			f.writes++
		}
		reply(map[string]any{field: p})
	}
	root := f.group(str(vars, "fullPath"))
	if root == nil && op != "SeedWorkItemTypes" && strings.HasPrefix(query, "query") {
		reply(map[string]any{"group": nil}) // as GitLab does for an unknown path
		return
	}

	switch op {
	case "SeedWorkItemTypes":
		if root == nil || f.noTypes {
			reply(map[string]any{"namespace": nil})
			return
		}
		reply(map[string]any{"namespace": map[string]any{"workItemTypes": map[string]any{"nodes": []any{
			map[string]any{"id": issType, "name": "Issue"}, map[string]any{"id": epicType, "name": "Epic"},
		}}}})
	case "SeedLabels":
		var nodes []any
		for _, l := range f.labels {
			nodes = append(nodes, map[string]any{"id": gid("GroupLabel", l.id), "title": l.title, "color": l.color})
		}
		reply(map[string]any{"group": map[string]any{"labels": f.page(nodes, vars["after"])}})
	case "SeedLabelCreate":
		l := &fLabel{id: f.id(), title: str(in, "title"), color: str(in, "color")}
		f.labels = append(f.labels, l)
		payload("labelCreate", "label", gid("GroupLabel", l.id))
	case "SeedCadences":
		var nodes []any
		for _, c := range f.cadences {
			// includeAncestorGroups: false: the group's own cadences only.
			if strings.Contains(c.title, str(vars, "title")) && (c.group == "" || c.group == str(vars, "fullPath")) {
				nodes = append(nodes, map[string]any{"id": gid("Iterations::Cadence", c.id), "title": c.title, "automatic": c.automatic})
			}
		}
		reply(map[string]any{"group": map[string]any{"iterationCadences": map[string]any{"nodes": nodes}}})
	case "SeedCadenceCreate":
		c := &fCadence{id: f.id(), title: str(in, "title"), automatic: in["automatic"] == true, group: str(in, "groupPath")}
		f.cadences = append(f.cadences, c)
		if c.automatic && f.autoIterations {
			start := mustDate(str(in, "startDate"))
			for i := 0; i < int(in["iterationsInAdvance"].(float64)); i++ {
				s := start.AddDate(0, 0, 14*i)
				f.iterations = append(f.iterations, &fIteration{
					id: f.id(), cadence: c.id, start: s.Format("2006-01-02"), due: s.AddDate(0, 0, 13).Format("2006-01-02"),
				})
			}
		}
		payload("iterationCadenceCreate", "iterationCadence", gid("Iterations::Cadence", c.id))
	case "SeedIterations":
		var its []*fIteration
		for _, it := range f.iterations {
			if gid("Iterations::Cadence", it.cadence) == str(vars, "cadenceId") {
				its = append(its, it)
			}
		}
		sort.Slice(its, func(i, j int) bool { return its[i].due < its[j].due })
		var nodes []any
		for _, it := range its {
			var title any
			if it.title != "" {
				title = it.title
			}
			// Dates typed Time may come back as timestamps.
			nodes = append(nodes, map[string]any{"id": gid("Iteration", it.id), "title": title, "startDate": it.start + "T00:00:00Z", "dueDate": it.due})
		}
		reply(map[string]any{"group": map[string]any{"iterations": f.page(nodes, vars["after"])}})
	case "SeedIterationCreate":
		it := &fIteration{id: f.id(), cadence: num(str(in, "iterationsCadenceId")), title: str(in, "title"), start: str(in, "startDate"), due: str(in, "dueDate")}
		if f.overlaps(it) {
			payload("iterationCreate", "iteration", "", "Dates cannot overlap with other existing Iterations within this iterations cadence")
			return
		}
		f.iterations = append(f.iterations, it)
		payload("iterationCreate", "iteration", gid("Iteration", it.id))
	case "SeedIterationUpdate":
		for _, it := range f.iterations {
			if gid("Iteration", it.id) == str(in, "id") {
				moved := *it
				moved.start, moved.due = str(in, "startDate"), str(in, "dueDate")
				if f.overlaps(&moved) {
					payload("updateIteration", "iteration", "", "Dates cannot overlap with other existing Iterations within this iterations cadence")
					return
				}
				*it = moved
			}
		}
		payload("updateIteration", "iteration", str(in, "id"))
	case "SeedWorkItems":
		var nodes []any
		for _, it := range f.items {
			if it.ns == rootPath || strings.HasPrefix(it.ns, rootPath+"/") {
				nodes = append(nodes, f.node(it))
			}
		}
		reply(map[string]any{"group": map[string]any{"workItems": f.page(nodes, vars["after"])}})
	case "SeedWorkItemCreate":
		it := &fItem{id: f.id(), title: str(in, "title"), ns: str(in, "namespacePath"), state: "OPEN"}
		if err := f.applyWidgets(it, in); err != "" {
			payload("workItemCreate", "workItem", "", err)
			return
		}
		switch str(in, "workItemTypeId") {
		case epicType:
			it.typ = "Epic"
			if f.group(it.ns) == nil {
				payload("workItemCreate", "workItem", "", "an epic lives in a group")
				return
			}
		case issType:
			it.typ = "Issue"
			if f.project(it.ns) == nil {
				payload("workItemCreate", "workItem", "", "an issue lives in a project")
				return
			}
		default:
			payload("workItemCreate", "workItem", "", "unknown type")
			return
		}
		f.items = append(f.items, it)
		payload("workItemCreate", "workItem", gid("WorkItem", it.id))
	case "SeedWorkItemUpdate":
		it := f.item(str(in, "id"))
		if it == nil {
			payload("workItemUpdate", "workItem", "", "not found")
			return
		}
		if err := f.applyWidgets(it, in); err != "" {
			payload("workItemUpdate", "workItem", "", err)
			return
		}
		switch str(in, "stateEvent") {
		case "CLOSE":
			it.state = "CLOSED"
		case "REOPEN":
			it.state = "OPEN"
		}
		payload("workItemUpdate", "workItem", str(in, "id"))
	case "SeedLinkAdd":
		ids, _ := in["workItemsIds"].([]any)
		from, to := str(in, "id"), ids[0].(string)
		pair := [2]string{min(from, to), max(from, to)}
		if f.item(from) == nil || f.item(to) == nil || f.links[pair] != "" {
			payload("workItemAddLinkedItems", "", "", "invalid or duplicate link")
			return
		}
		f.links[pair] = str(in, "linkType")
		payload("workItemAddLinkedItems", "", "")
	default:
		_ = json.NewEncoder(w).Encode(map[string]any{"errors": []any{map[string]any{"message": "unknown operation " + op}}})
	}
}

func (f *fakeGitLab) item(id string) *fItem {
	for _, it := range f.items {
		if gid("WorkItem", it.id) == id {
			return it
		}
	}
	return nil
}

// applyWidgets sets the widgets of a create or update input; it returns what GitLab refuses.
func (f *fakeGitLab) applyWidgets(it *fItem, in map[string]any) string {
	if w, ok := in["startAndDueDateWidget"].(map[string]any); ok {
		it.start, _ = w["startDate"].(string)
		it.due, _ = w["dueDate"].(string)
	}
	if w, ok := in["iterationWidget"].(map[string]any); ok {
		id, _ := w["iterationId"].(string)
		if id != "" && !f.hasIteration(id) {
			return "unknown iteration"
		}
		it.iter = id
	}
	if w, ok := in["hierarchyWidget"].(map[string]any); ok {
		parent := f.item(w["parentId"].(string))
		if parent == nil || parent.typ != "Epic" {
			return "the parent must be an epic"
		}
		it.parent = w["parentId"].(string)
	}
	if w, ok := in["labelsWidget"].(map[string]any); ok {
		for _, key := range []string{"labelIds", "addLabelIds"} {
			ids, _ := w[key].([]any)
			for _, id := range ids {
				it.labels = append(it.labels, id.(string))
			}
		}
	}
	if w, ok := in["assigneesWidget"].(map[string]any); ok {
		ids, _ := w["assigneeIds"].([]any)
		it.assignees = nil
		for _, id := range ids {
			if !f.members[1][num(id.(string))] {
				return "an assignee must be a member"
			}
			it.assignees = append(it.assignees, id.(string))
		}
	}
	return ""
}

func (f *fakeGitLab) hasIteration(id string) bool {
	for _, i := range f.iterations {
		if gid("Iteration", i.id) == id {
			return true
		}
	}
	return false
}

// node is a work item as the SeedWorkItems query returns it.
func (f *fakeGitLab) node(it *fItem) map[string]any {
	ref := func(id string) any {
		if id == "" {
			return nil
		}
		return map[string]any{"id": id}
	}
	nodes := func(ids []string) map[string]any {
		out := []any{}
		for _, id := range ids {
			out = append(out, map[string]any{"id": id})
		}
		return map[string]any{"nodes": out}
	}
	self := gid("WorkItem", it.id)
	var linked []any
	for pair := range f.links {
		switch self {
		case pair[0]:
			linked = append(linked, map[string]any{"workItem": map[string]any{"id": pair[1]}})
		case pair[1]:
			linked = append(linked, map[string]any{"workItem": map[string]any{"id": pair[0]}})
		}
	}
	return map[string]any{
		"id": self, "title": it.title, "state": it.state,
		"namespace": map[string]any{"fullPath": it.ns}, "workItemType": map[string]any{"name": it.typ},
		"widgets": []any{
			map[string]any{"__typename": "WorkItemWidgetStartAndDueDate", "startDate": optional(it.start), "dueDate": optional(it.due)},
			map[string]any{"__typename": "WorkItemWidgetIteration", "iteration": ref(it.iter)},
			map[string]any{"__typename": "WorkItemWidgetHierarchy", "parent": ref(it.parent)},
			map[string]any{"__typename": "WorkItemWidgetLabels", "labels": nodes(it.labels)},
			map[string]any{"__typename": "WorkItemWidgetAssignees", "assignees": nodes(it.assignees)},
			map[string]any{"__typename": "WorkItemWidgetLinkedItems", "linkedItems": map[string]any{"nodes": linked}},
		},
	}
}

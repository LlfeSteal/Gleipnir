package main

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"gitlab-mock/dataset"
)

// t0 is a Wednesday: Itération 15 runs from Monday 2026-11-23 to 2026-12-06.
var t0 = time.Date(2026, 11, 25, 10, 0, 0, 0, time.UTC)

func mustDate(s string) time.Time {
	d, err := time.Parse("2006-01-02", s[:10])
	if err != nil {
		panic(err)
	}
	return d
}

// seed runs the seeder against f on day, with args; it returns what it printed.
func seed(t *testing.T, f *fakeGitLab, day time.Time, args ...string) (string, error) {
	t.Helper()
	defer func(n func() time.Time) { now = n }(now)
	now = func() time.Time { return day }
	vars := map[string]string{"SEED_URL": f.srv.URL, "SEED_TOKEN": token, "SEED_GROUP": rootPath}
	var out bytes.Buffer
	err := run(context.Background(), args, func(k string) string { return vars[k] }, &out)
	if strings.Contains(out.String(), token) || (err != nil && strings.Contains(err.Error(), token)) {
		t.Fatalf("the token was printed: %s %v", out.String(), err)
	}
	return out.String(), err
}

func mustSeed(t *testing.T, f *fakeGitLab, day time.Time, args ...string) string {
	t.Helper()
	out, err := seed(t, f, day, args...)
	if err != nil {
		t.Fatalf("seed %v: %v\n%s", args, err, out)
	}
	return out
}

// expectDataset checks that f holds the dataset placed around day.
func expectDataset(t *testing.T, f *fakeGitLab, day time.Time, assigned bool) {
	t.Helper()
	ds := dataset.New(day)
	if len(f.groups) != 1+len(ds.Groups) || len(f.projects) != len(ds.Projects) || len(f.labels) != len(ds.Labels) {
		t.Fatalf("%d groups, %d projects, %d labels", len(f.groups), len(f.projects), len(f.labels))
	}
	if g := f.group(rootPath + "/api"); g == nil || g.name != "API et intégrations" {
		t.Fatalf("group api: %+v", g)
	}
	if len(f.cadences) != 1 || len(f.iterations) != len(ds.Iterations) {
		t.Fatalf("%d cadences, %d iterations", len(f.cadences), len(f.iterations))
	}
	iterByID := map[string]*fIteration{}
	for _, it := range f.iterations {
		iterByID[gid("Iteration", it.id)] = it
	}
	byTitle := map[string]*fItem{}
	for _, it := range f.items {
		byTitle[it.title] = it
	}
	if len(f.items) != len(ds.Epics)+len(ds.Issues) {
		t.Fatalf("%d work items", len(f.items))
	}
	for _, e := range ds.Epics {
		got := byTitle[e.Title]
		if got == nil || got.typ != "Epic" || got.ns != rootPath+"/"+e.Group || got.start != e.StartDate || got.due != e.DueDate || len(got.labels) != len(e.Labels) {
			t.Errorf("epic %s: %+v", e.Key, got)
		}
	}
	for _, is := range ds.Issues {
		got := byTitle[is.Title]
		if got == nil || got.typ != "Issue" || got.ns != rootPath+"/"+is.Project || (got.state == "CLOSED") != is.Closed {
			t.Errorf("issue %s: %+v", is.Key, got)
			continue
		}
		if is.Iteration >= 0 {
			if it := iterByID[got.iter]; it == nil || it.title != ds.Iterations[is.Iteration].Title || it.start != ds.Iterations[is.Iteration].StartDate {
				t.Errorf("issue %s: iteration %+v", is.Key, it)
			}
		} else if got.iter != "" {
			t.Errorf("issue %s: no iteration expected", is.Key)
		}
		if parent := f.item(got.parent); parent == nil || parent.title != epicTitle(ds, is.Parent) {
			t.Errorf("issue %s: parent %+v", is.Key, parent)
		}
		if (len(got.assignees) == 1) != assigned {
			t.Errorf("issue %s: assignees %v", is.Key, got.assignees)
		}
	}
	if len(f.links) != len(ds.Links) {
		t.Fatalf("%d links, want %d", len(f.links), len(ds.Links))
	}
}

func epicTitle(ds *dataset.Dataset, key string) string {
	for _, e := range ds.Epics {
		if e.Key == key {
			return e.Title
		}
	}
	return ""
}

func TestSeedFreshThenIdempotent(t *testing.T) {
	f := newFake(t, true)
	out := mustSeed(t, f, t0, "-apply")
	expectDataset(t, f, t0, true)
	if len(f.users) != 6 || len(f.members[1]) != 6 {
		t.Fatalf("users %v, members %v", f.users, f.members)
	}
	if !strings.Contains(out, "as seeder, admin") || !strings.Contains(out, "create epic &18 \"API d'export des données\"") {
		t.Fatalf("output:\n%s", out)
	}

	writes := f.writes
	out = mustSeed(t, f, t0, "-apply")
	if f.writes != writes || !strings.Contains(out, "done: 0 to create, 0 to update") {
		t.Fatalf("a second run must write nothing, wrote %d:\n%s", f.writes-writes, out)
	}
}

// Later runs move the iterations and the epic dates with today, forward and backward, without
// two iterations ever overlapping.
func TestSeedMovesTheDatesWithToday(t *testing.T) {
	f := newFake(t, true)
	mustSeed(t, f, t0, "-apply")
	for _, day := range []time.Time{t0.AddDate(0, 0, 28), t0.AddDate(0, 0, -35), t0} {
		out := mustSeed(t, f, day, "-apply")
		if !strings.Contains(out, "done: 0 to create, ") || !strings.Contains(out, "move iteration") {
			t.Fatalf("%s:\n%s", day.Format("2006-01-02"), out)
		}
		expectDataset(t, f, day, true)
	}
}

func TestSeedFixesDrift(t *testing.T) {
	f := newFake(t, true)
	mustSeed(t, f, t0, "-apply")
	f.group(rootPath + "/data").name = "Données"
	f.labels[0].color = "#000000"
	byTitle := map[string]*fItem{}
	for _, it := range f.items {
		byTitle[it.title] = it
	}
	byTitle["Montée de version Kafka"].state = "OPEN"       // closed in the dataset
	byTitle["Pipeline analytique"].state = "CLOSED"         // open
	byTitle["Endpoint d’export CSV / JSON"].labels = nil    // labels removed
	byTitle["Endpoint d’export CSV / JSON"].assignees = nil // unassigned
	byTitle["Endpoint d’export CSV / JSON"].iter = ""       // out of its iteration
	byTitle["Endpoint d’export CSV / JSON"].parent = ""     // detached
	byTitle["Purge des données personnelles"].iter = f.items[0].iter

	out := mustSeed(t, f, t0, "-apply")
	for _, want := range []string{
		`rename group demo/gleipnir/data to "Data"`, "recolor label", "reopen", "close",
		"update issue #110 \"Endpoint d’export CSV / JSON\": iteration, parent &18, assignee, labels",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in:\n%s", want, out)
		}
	}
	expectDataset(t, f, t0, true)
	if f.group(rootPath+"/data").name != "Data" || f.labels[0].color != "#428bca" {
		t.Fatal("the group name or the label color was not fixed")
	}
}

func TestDryRunWritesNothing(t *testing.T) {
	f := newFake(t, true)
	out := mustSeed(t, f, t0)
	if f.writes != 0 {
		t.Fatalf("a dry-run wrote %d times", f.writes)
	}
	for _, want := range []string{
		"dry-run: reading only", "[dry-run] create group demo/gleipnir/identite (Identité et sécurité)",
		"[dry-run] create manual cadence", "[dry-run] link &12 blocks &13", "dry-run done, nothing written",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in:\n%s", want, out)
		}
	}
	mustSeed(t, f, t0, "-apply")
	if out := mustSeed(t, f, t0); !strings.Contains(out, "0 to create, 0 to update") {
		t.Fatalf("dry-run of a seeded group:\n%s", out)
	}
}

func TestWithoutAdminItemsStayUnassigned(t *testing.T) {
	f := newFake(t, false)
	out := mustSeed(t, f, t0, "-apply")
	if !strings.Contains(out, "warning: user demo-snguyen does not exist and the token is not admin") || len(f.users) != 0 {
		t.Fatalf("output:\n%s", out)
	}
	expectDataset(t, f, t0, false)

	// Users created by an admin since then are found, made members and assigned.
	for _, p := range dataset.New(t0).People {
		f.users[p.Username] = f.id()
	}
	mustSeed(t, f, t0, "-apply")
	expectDataset(t, f, t0, true)
}

func TestAutomaticCadence(t *testing.T) {
	f := newFake(t, true)
	f.autoIterations = true
	out := mustSeed(t, f, t0, "-apply", "-cadence=auto")
	if !strings.Contains(out, "create automatic cadence") || len(f.iterations) != 10 || f.iterations[0].title != "" {
		t.Fatalf("iterations %d:\n%s", len(f.iterations), out)
	}
	// Consecutive iterations: the epics are dated from GitLab's, not the dataset's.
	for _, it := range f.items {
		if it.title == "Modèles prédictifs" && it.due != f.iterations[9].due {
			t.Fatalf("epic dated %s, want the last iteration's %s", it.due, f.iterations[9].due)
		}
	}
	writes := f.writes
	mustSeed(t, f, t0, "-apply")
	if f.writes != writes {
		t.Fatal("rerunning on an automatic cadence must not move GitLab's iterations")
	}
}

func TestAutomaticCadenceStillGenerating(t *testing.T) {
	f := newFake(t, true)
	out := mustSeed(t, f, t0, "-apply", "-cadence=auto")
	if !strings.Contains(out, "has 0 of 10 iterations yet") {
		t.Fatalf("output:\n%s", out)
	}
	for _, it := range f.items {
		if it.iter != "" || it.start != "" {
			t.Fatalf("%s is dated without iterations", it.title)
		}
	}
}

func TestExistingCadenceKindWins(t *testing.T) {
	f := newFake(t, true)
	f.cadences = []*fCadence{{id: 7, title: "Sprints produit", automatic: true}}
	out := mustSeed(t, f, t0, "-apply")
	if !strings.Contains(out, "exists with automatic=true: kept as is") || len(f.cadences) != 1 {
		t.Fatalf("output:\n%s", out)
	}
}

func TestSeedErrors(t *testing.T) {
	cases := map[string]struct {
		setup func(*fakeGitLab)
		want  string
	}{
		"no root group":      {func(f *fakeGitLab) { f.groups = nil }, `SEED_GROUP "demo/gleipnir" not found`},
		"free instance":      {func(f *fakeGitLab) { f.noTypes = true }, "needs GitLab Premium or Ultimate"},
		"graphql error":      {func(f *fakeGitLab) { f.failOp["SeedWorkItems"] = "Request timed out" }, "graphql SeedWorkItems: Request timed out"},
		"group creation":     {func(f *fakeGitLab) { f.failOp["POST groups"] = "boom" }, "creating group demo/gleipnir/identite: POST /api/v4/groups: HTTP 500: boom"},
		"project lookup":     {func(f *fakeGitLab) { f.failOp["GET projects"] = "boom" }, "HTTP 500"},
		"user lookup":        {func(f *fakeGitLab) { f.failOp["GET users"] = "boom" }, "HTTP 500"},
		"user creation":      {func(f *fakeGitLab) { f.failOp["POST users"] = "boom" }, "creating user demo-alaurent"},
		"group lookup":       {func(f *fakeGitLab) { f.failOp["GET groups"] = "boom" }, "HTTP 500"},
		"label creation":     {func(f *fakeGitLab) { f.failOp["SeedLabelCreate"] = "no" }, "graphql SeedLabelCreate: no"},
		"labels":             {func(f *fakeGitLab) { f.failOp["SeedLabels"] = "no" }, "graphql SeedLabels: no"},
		"cadences":           {func(f *fakeGitLab) { f.failOp["SeedCadences"] = "no" }, "graphql SeedCadences: no"},
		"cadence creation":   {func(f *fakeGitLab) { f.failOp["SeedCadenceCreate"] = "no" }, "graphql SeedCadenceCreate: no"},
		"iterations":         {func(f *fakeGitLab) { f.failOp["SeedIterations"] = "no" }, "graphql SeedIterations: no"},
		"iteration creation": {func(f *fakeGitLab) { f.failOp["SeedIterationCreate"] = "no" }, "creating iteration Itération 12"},
		"work item creation": {func(f *fakeGitLab) { f.failOp["SeedWorkItemCreate"] = "no" }, "creating epic &12"},
		"link":               {func(f *fakeGitLab) { f.failOp["SeedLinkAdd"] = "no" }, "linking &12 to &13"},
		"types":              {func(f *fakeGitLab) { f.failOp["SeedWorkItemTypes"] = "no" }, "graphql SeedWorkItemTypes: no"},
		"membership":         {func(f *fakeGitLab) { f.failOp["POST groups"] = "boom"; f.groups = append(f.groups, seededGroups()...) }, "membership of demo-alaurent"},
		"overlap": {func(f *fakeGitLab) {
			f.cadences = []*fCadence{{id: 7, title: "Sprints produit"}}
			f.iterations = []*fIteration{{id: 8, cadence: 7, title: "Autre", start: "2020-01-01", due: "2030-01-01"}}
		}, "Dates cannot overlap"},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			f := newFake(t, true)
			c.setup(f)
			_, err := seed(t, f, t0, "-apply")
			if err == nil || !strings.Contains(err.Error(), c.want) {
				t.Fatalf("got %v, want %q", err, c.want)
			}
		})
	}
}

// seededGroups are the dataset's subgroups, already there.
func seededGroups() []*fGroup {
	var out []*fGroup
	for i, g := range dataset.New(t0).Groups {
		out = append(out, &fGroup{id: 50 + i, path: rootPath + "/" + g.Slug, name: g.Name})
	}
	return out
}

func TestUpdateErrors(t *testing.T) {
	for op, want := range map[string]string{
		// Moving later, the last iteration moves first.
		"SeedIterationUpdate": "moving iteration Itération 21",
		"SeedWorkItemUpdate":  "updating epic &12",
	} {
		f := newFake(t, true)
		mustSeed(t, f, t0, "-apply")
		f.failOp[op] = "no"
		if _, err := seed(t, f, t0.AddDate(0, 0, 14), "-apply"); err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("%s: got %v, want %q", op, err, want)
		}
	}
	f := newFake(t, true)
	mustSeed(t, f, t0, "-apply")
	f.group(rootPath + "/data").name = "Données"
	f.labels[0].color = "#000000"
	f.failOp["PUT groups"] = "no"
	if _, err := seed(t, f, t0, "-apply"); err == nil || !strings.Contains(err.Error(), "renaming group") {
		t.Errorf("rename: %v", err)
	}
	f.group(rootPath + "/data").name = "Data"
	if _, err := seed(t, f, t0, "-apply"); err == nil || !strings.Contains(err.Error(), "recoloring label") {
		t.Errorf("recolor: %v", err)
	}
	// Closing a new issue fails: the issue is created, the close is reported.
	f = newFake(t, true)
	mustSeed(t, f, t0, "-apply")
	for i, it := range f.items {
		if it.title == "Montée de version Kafka" {
			f.items = append(f.items[:i], f.items[i+1:]...)
			break
		}
	}
	f.failOp["SeedWorkItemUpdate"] = "no"
	if _, err := seed(t, f, t0, "-apply"); err == nil || !strings.Contains(err.Error(), "closing issue #131") {
		t.Errorf("close: %v", err)
	}
}

func TestRunConfiguration(t *testing.T) {
	cases := map[string]struct {
		vars map[string]string
		args []string
		want string
	}{
		"no url":         {map[string]string{"SEED_TOKEN": "t", "SEED_GROUP": "g"}, nil, "SEED_URL is required"},
		"bad url":        {map[string]string{"SEED_URL": "gitlab.example.com", "SEED_TOKEN": "t", "SEED_GROUP": "g"}, nil, "not a valid http(s) URL"},
		"plain http":     {map[string]string{"SEED_URL": "http://gitlab.example.com", "SEED_TOKEN": "t", "SEED_GROUP": "g"}, nil, "plain http"},
		"no token":       {map[string]string{"SEED_URL": "https://gitlab.example.com", "SEED_GROUP": "g"}, nil, "SEED_TOKEN is required"},
		"no group":       {map[string]string{"SEED_URL": "https://gitlab.example.com", "SEED_TOKEN": "t", "SEED_GROUP": " / "}, nil, "SEED_GROUP is required"},
		"bad cadence":    {nil, []string{"-cadence=weekly"}, "-cadence \"weekly\""},
		"unknown flag":   {nil, []string{"-force"}, "flag provided but not defined"},
		"insecure http":  {map[string]string{"SEED_URL": "http://gitlab.invalid", "SEED_TOKEN": "t", "SEED_GROUP": "g"}, []string{"-insecure-http"}, "GET /api/v4/user"},
		"localhost http": {map[string]string{"SEED_URL": "http://localhost:1", "SEED_TOKEN": "t", "SEED_GROUP": "g"}, nil, "GET /api/v4/user"},
		"loopback ip":    {map[string]string{"SEED_URL": "http://127.0.0.1:1", "SEED_TOKEN": "t", "SEED_GROUP": "g"}, nil, "GET /api/v4/user"},
	}
	for name, c := range cases {
		var out bytes.Buffer
		err := run(context.Background(), c.args, func(k string) string { return c.vars[k] }, &out)
		if err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s: got %v, want %q", name, err, c.want)
		}
	}
}

func TestServe(t *testing.T) {
	var out, errOut bytes.Buffer
	if code := serve(nil, func(string) string { return "" }, &out, &errOut); code != 1 || !strings.Contains(errOut.String(), "seed: SEED_URL is required") {
		t.Fatalf("code %d, stderr %q", code, errOut.String())
	}
	f := newFake(t, true)
	vars := map[string]string{"SEED_URL": f.srv.URL + "/", "SEED_TOKEN": token, "SEED_GROUP": "/" + rootPath + "/"}
	out.Reset()
	if code := serve([]string{"-apply"}, func(k string) string { return vars[k] }, &out, &errOut); code != 0 {
		t.Fatalf("code %d: %s", code, errOut.String())
	}
	if !strings.Contains(out.String(), "writing the demo dataset to "+f.srv.URL+", group demo/gleipnir") {
		t.Fatalf("output:\n%s", out.String())
	}
}

func TestClientErrors(t *testing.T) {
	cases := map[string]struct {
		status int
		body   string
		want   error
		text   string
	}{
		"refused token": {http.StatusUnauthorized, "", errUnauthorized, ""},
		"forbidden":     {http.StatusForbidden, `{"message":"insufficient_scope"}`, nil, "the token needs the api scope"},
		"not found":     {http.StatusNotFound, "", errNotFound, ""},
		"conflict":      {http.StatusConflict, "", errConflict, ""},
		"server error":  {http.StatusBadGateway, strings.Repeat("x", 400), nil, "HTTP 502: " + strings.Repeat("x", 300) + "…"},
		"bad json":      {http.StatusOK, "{", nil, "decoding the response"},
	}
	for name, c := range cases {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(c.status)
			_, _ = w.Write([]byte(c.body))
		}))
		var out map[string]any
		err := newClient(srv.URL, token).rest(context.Background(), http.MethodGet, "/user", nil, &out)
		srv.Close()
		if c.want != nil && err != c.want || c.want == nil && (err == nil || !strings.Contains(err.Error(), c.text)) {
			t.Errorf("%s: got %v", name, err)
		}
	}

	big := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(bytes.Repeat([]byte("x"), maxBody+1))
	}))
	defer big.Close()
	if err := newClient(big.URL, token).rest(context.Background(), http.MethodGet, "/user", nil, nil); err == nil || !strings.Contains(err.Error(), "larger than") {
		t.Errorf("oversized: %v", err)
	}
	if err := newClient("http://127.0.0.1:1", token).rest(context.Background(), http.MethodGet, "/user", nil, nil); err == nil {
		t.Error("unreachable: no error")
	}
	if err := newClient(big.URL, token).rest(context.Background(), "BAD METHOD", "/user", nil, nil); err == nil {
		t.Error("invalid method: no error")
	}
	if err := newClient(big.URL, token).rest(context.Background(), http.MethodPost, "/user", map[string]any{"x": func() {}}, nil); err == nil {
		t.Error("unencodable body: no error")
	}
}

func TestHelpers(t *testing.T) {
	if operation("{") != "query" || operation("mutation SeedLinkAdd($input: X!) {") != "SeedLinkAdd" {
		t.Fatal("operation")
	}
	if day("2026-11-23T00:00:00Z") != "2026-11-23" || day("") != "" || orNone("") != "none" || deref(nil) != "" {
		t.Fatal("helpers")
	}
	if a, b := randomPassword(), randomPassword(); a == b || len(a) < 30 {
		t.Fatal("randomPassword")
	}
	if err := payloadErrors("op", nil); err != nil {
		t.Fatal(err)
	}
}

// The root group disappears during the run: paginate reports it.
func TestPaginateMissingGroup(t *testing.T) {
	f := newFake(t, true)
	s := &seeder{c: newClient(f.srv.URL, token), root: "nope", out: &bytes.Buffer{}}
	if err := s.paginate(context.Background(), labelsQuery, nil, func(map[string]any) pageInfo { return pageInfo{} }); err == nil || !strings.Contains(err.Error(), "group nope not found") {
		t.Fatalf("got %v", err)
	}
}

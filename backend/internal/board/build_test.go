package board

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"
)

var testNow = time.Date(2026, 1, 20, 10, 0, 0, 0, time.UTC)

// testIterations: it0 and it1 back to back, a one-week gap (02-02 … 02-08), then it2, it3.
// Given out of order to check the sort.
func testIterations() []RawIteration {
	return []RawIteration{
		{ID: "it2", Sequence: 3, StartDate: "2026-02-09", DueDate: "2026-02-22"},
		{ID: "it0", Title: "Sprint A", Sequence: 1, StartDate: "2026-01-05", DueDate: "2026-01-18"},
		{ID: "it3", Sequence: 4, StartDate: "2026-02-23", DueDate: "2026-03-08"},
		{ID: "it1", Sequence: 2, StartDate: "2026-01-19", DueDate: "2026-02-01"},
	}
}

func sortedTestIterations(t *testing.T) []Iteration {
	t.Helper()
	its, _ := buildIterations(testIterations(), testNow)
	return its
}

func eid(n int) string { return fmt.Sprintf("gid://gitlab/WorkItem/E%d", n) }
func iid(n int) string { return fmt.Sprintf("gid://gitlab/WorkItem/I%d", n) }

func epicItem(n int, start, due string) RawItem {
	return RawItem{ID: eid(n), IID: fmt.Sprint(n), Kind: KindEpic, State: "OPEN",
		NamespacePath: "root/a", StartDate: start, DueDate: due}
}

func issueItem(n int, iteration string) RawItem {
	return RawItem{ID: iid(n), IID: fmt.Sprint(n), Kind: KindIssue, State: "opened",
		NamespacePath: "root/a/proj", IterationID: iteration}
}

func buildTest(items ...RawItem) *Board {
	return Build(&Raw{RootGroup: Group{Path: "root", Name: "Root"}, Iterations: testIterations(), Items: items}, testNow)
}

func ptr(i int) *int { return &i }

func TestBuildIterations(t *testing.T) {
	its, cur := buildIterations(testIterations(), testNow)
	var ids, titles []string
	for _, it := range its {
		ids = append(ids, it.ID)
		titles = append(titles, it.Title)
	}
	if want := []string{"it0", "it1", "it2", "it3"}; !reflect.DeepEqual(ids, want) {
		t.Errorf("order = %v, want %v", ids, want)
	}
	if want := []string{"Sprint A", "Itération 2", "Itération 3", "Itération 4"}; !reflect.DeepEqual(titles, want) {
		t.Errorf("titles = %v, want %v", titles, want)
	}
	if cur != 1 || !its[1].Current || its[0].Current {
		t.Errorf("current = %d (%+v)", cur, its)
	}

	paris := time.FixedZone("UTC+2", 2*3600)
	tests := []struct {
		name string
		now  time.Time
		want int
	}{
		{"first day inclusive", time.Date(2026, 1, 5, 0, 0, 0, 0, time.UTC), 0},
		{"due day inclusive", time.Date(2026, 1, 18, 23, 59, 0, 0, time.UTC), 0},
		{"next start", time.Date(2026, 1, 19, 0, 0, 0, 0, time.UTC), 1},
		{"in the gap", time.Date(2026, 2, 4, 12, 0, 0, 0, time.UTC), -1},
		{"before the cadence", time.Date(2025, 12, 1, 0, 0, 0, 0, time.UTC), -1},
		{"after the cadence", time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC), -1},
		// 2026-01-18 23:00 UTC is already 2026-01-19 in UTC+2: the location decides.
		{"date in now's location", time.Date(2026, 1, 18, 23, 0, 0, 0, time.UTC).In(paris), 1},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, got := buildIterations(testIterations(), tt.now); got != tt.want {
				t.Errorf("current = %d, want %d", got, tt.want)
			}
		})
	}
}

func TestBuildIterationsDropsDuplicatesAndBadDates(t *testing.T) {
	raw := append(testIterations(),
		RawIteration{ID: "it1", Sequence: 2, StartDate: "2026-01-19", DueDate: "2026-02-01"}, // repeated across pages
		RawIteration{ID: "noStart", Sequence: 9, DueDate: "2026-02-05"},
		RawIteration{ID: "garbage", Sequence: 9, StartDate: "soon", DueDate: "2026-02-05"},
		RawIteration{ID: "inverted", Sequence: 9, StartDate: "2026-02-06", DueDate: "2026-02-03"},
		RawIteration{ID: "", Sequence: 9, StartDate: "2026-02-03", DueDate: "2026-02-04"},
	)
	its, cur := buildIterations(raw, testNow)
	var ids []string
	for _, it := range its {
		ids = append(ids, it.ID)
	}
	if want := []string{"it0", "it1", "it2", "it3"}; !reflect.DeepEqual(ids, want) || cur != 1 {
		t.Fatalf("iterations = %v (current %d), want %v (current 1)", ids, cur, want)
	}
	// The placement still binary-searches correctly: the gap rule is unchanged.
	if s, e, _, ok := placeEpic(its, "2026-02-03", "2026-02-25", span{}); !ok || s != 2 || e != 3 {
		t.Errorf("placeEpic = %d, %d, %v; want 2, 3, true", s, e, ok)
	}
	// Timestamps are cut to their date.
	its, _ = buildIterations([]RawIteration{{ID: "t", StartDate: "2026-01-05T00:00:00Z", DueDate: "2026-01-18T00:00:00+01:00"}}, testNow)
	if len(its) != 1 || its[0].StartDate != "2026-01-05" || its[0].DueDate != "2026-01-18" {
		t.Errorf("timestamps: %+v", its)
	}
}

func TestBuildDuplicateItemsAcrossPages(t *testing.T) {
	is := issueItem(1, "it1")
	is.Blocks = []string{eid(1)}
	dup := is
	dup.Title = "second copy"
	other := issueItem(2, "it1")
	other.BlockedBy = []string{eid(1)} // epic E1 blocks I2: not a reason to show I2
	b := buildTest(epicItem(1, "2026-01-20", "2026-02-10"), is, dup, epicItem(1, "", ""), other)
	if len(b.Epics) != 1 || len(b.Issues) != 1 || b.Issues[0].Title != "" || b.IgnoredIssues != 1 {
		t.Fatalf("epics %d, issues %+v, ignored %d", len(b.Epics), b.Issues, b.IgnoredIssues)
	}
	if len(b.Links) != 1 || b.Links[0] != (Link{Source: iid(1), Target: eid(1), Type: LinkBlocks}) {
		t.Errorf("links = %+v", b.Links)
	}
}

func TestPlaceEpic(t *testing.T) {
	its := sortedTestIterations(t)
	none := span{}
	kids := func(lo, hi int) span { return span{lo, hi, true} }
	tests := []struct {
		name         string
		start, due   string
		children     span
		wantOK       bool
		wantS, wantE int
		fromChildren bool
	}{
		{"both inside iterations", "2026-01-07", "2026-02-10", none, true, 0, 2, false},
		{"start in a gap takes the following", "2026-02-03", "2026-02-25", none, true, 2, 3, false},
		{"due in a gap takes the preceding", "2026-01-20", "2026-02-05", none, true, 1, 1, false},
		{"start before the first", "2025-12-01", "2026-01-20", none, true, 0, 1, false},
		{"due after the last", "2026-02-10", "2026-04-01", none, true, 2, 3, false},
		{"start on a due day, due on a start day", "2026-01-18", "2026-01-19", none, true, 0, 1, false},
		{"entirely inside a gap", "2026-02-03", "2026-02-06", none, true, 2, 2, false},
		{"covers the whole cadence", "2025-01-01", "2027-01-01", none, true, 0, 3, false},
		{"entirely before the cadence", "2025-11-01", "2025-12-01", none, false, 0, 0, false},
		{"entirely after the cadence", "2026-04-01", "2026-05-01", none, false, 0, 0, false},
		{"inverted dates are swapped", "2026-02-10", "2026-01-07", none, true, 0, 2, false},
		{"dates win over children", "2026-01-07", "2026-01-08", kids(2, 3), true, 0, 0, false},
		{"start only, no children", "2026-01-20", "", none, true, 1, 1, false},
		{"start only, end from children", "2026-01-20", "", kids(0, 3), true, 1, 3, false},
		{"start only, children before it", "2026-02-10", "", kids(0, 1), true, 2, 2, false},
		{"start only, after the cadence", "2026-04-01", "", kids(0, 3), false, 0, 0, false},
		{"due only, no children", "", "2026-02-10", none, true, 2, 2, false},
		{"due only, start from children", "", "2026-02-10", kids(0, 3), true, 0, 2, false},
		{"due only, after the cadence", "", "2026-05-01", none, true, 3, 3, false},
		{"due only, before the cadence", "", "2025-05-01", kids(0, 1), false, 0, 0, false},
		{"no dates, from children", "", "", kids(1, 2), true, 1, 2, true},
		{"no dates, no children", "", "", none, false, 0, 0, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s, e, fc, ok := placeEpic(its, tt.start, tt.due, tt.children)
			if ok != tt.wantOK || (ok && (s != tt.wantS || e != tt.wantE || fc != tt.fromChildren)) {
				t.Errorf("placeEpic = (%d, %d, fromChildren %v, ok %v), want (%d, %d, %v, %v)",
					s, e, fc, ok, tt.wantS, tt.wantE, tt.fromChildren, tt.wantOK)
			}
		})
	}
	if _, _, _, ok := placeEpic(nil, "2026-01-07", "2026-02-10", none); ok {
		t.Error("an epic must be unplanned without iterations")
	}
}

func TestBuildEpicPlacement(t *testing.T) {
	childA, childB := issueItem(1, "it1"), issueItem(2, "it3")
	childA.ParentID, childB.ParentID = eid(2), eid(2)
	otherCadence := issueItem(3, "gid://gitlab/Iteration/other")
	otherCadence.ParentID = eid(3)
	b := buildTest(
		epicItem(1, "2026-01-07", "2026-02-10"),
		epicItem(2, "", ""), // children are ignored issues: they still date it
		epicItem(3, "", ""), // its only child is in another cadence
		epicItem(4, "2026-01-07T00:00:00Z", "bad"),
		childA, childB, otherCadence,
	)
	byID := map[string]Epic{}
	for _, e := range b.Epics {
		byID[e.ID] = e
	}
	check := func(n int, start, end *int, fromChildren, unplanned bool) {
		t.Helper()
		e := byID[eid(n)]
		if !reflect.DeepEqual(e.Start, start) || !reflect.DeepEqual(e.End, end) ||
			e.DatesFromChildren != fromChildren || e.Unplanned != unplanned {
			t.Errorf("epic %d = start %v end %v fromChildren %v unplanned %v", n, e.Start, e.End, e.DatesFromChildren, e.Unplanned)
		}
	}
	check(1, ptr(0), ptr(2), false, false)
	check(2, ptr(1), ptr(3), true, false)
	check(3, nil, nil, false, true)
	check(4, ptr(0), ptr(0), false, false) // timestamp trimmed, unparseable due date unset
	if e := byID[eid(4)]; e.StartDate != "2026-01-07" || e.DueDate != "" {
		t.Errorf("epic 4 dates = %q, %q", e.StartDate, e.DueDate)
	}
	if b.IgnoredIssues != 3 || len(b.Issues) != 0 {
		t.Errorf("ignored = %d, issues = %d", b.IgnoredIssues, len(b.Issues))
	}
}

func TestBuildGroups(t *testing.T) {
	b := Build(&Raw{
		RootGroup: Group{Path: "root", Name: "Root"},
		Groups: []Group{
			{Path: "root/zeta", Name: "Z"}, {Path: "root/Beta", Name: "B"}, {Path: "root/alpha", Name: "A"},
			{Path: "root/alpha/sub", Name: "AS"}, {Path: "root/alpha", Name: "dup"}, {Path: "root", Name: "self"},
		},
	}, testNow)
	var paths []string
	for _, g := range b.Groups {
		paths = append(paths, g.Path)
	}
	want := []string{"root", "root/alpha", "root/alpha/sub", "root/Beta", "root/zeta"}
	if !reflect.DeepEqual(paths, want) {
		t.Errorf("groups = %v, want %v", paths, want)
	}
	if b.Groups[0].Name != "Root" || b.Groups[1].Name != "A" {
		t.Errorf("names = %+v", b.Groups)
	}
}

func TestBuildItemFields(t *testing.T) {
	e := epicItem(18, "2026-01-07", "2026-01-10")
	e.NamespacePath, e.WebURL, e.State = "root/api", "https://x/groups/root/api/-/epics/18", "CLOSED"
	e.Labels = []Label{{"zeta", "#111111"}, {"Alpha", "#222222"}}
	is := issueItem(110, "it0")
	is.NamespacePath = "root/api/export"
	is.ParentID = eid(18)
	is.Assignee = &Person{Name: "Sofia Nguyen", Username: "snguyen"}
	is.Labels = []Label{{"bug", "#dc143c"}}
	is.Blocks = []string{eid(18)}
	b := buildTest(e, is)

	ep := b.Epics[0]
	if ep.Ref != "&18" || ep.GroupPath != "root/api" || ep.State != StateClosed ||
		!reflect.DeepEqual(ep.Labels, []string{"zeta", "Alpha"}) || ep.WebURL != e.WebURL {
		t.Errorf("epic = %+v", ep)
	}
	got := b.Issues[0]
	if got.Ref != "#110" || got.GroupPath != "root/api" || got.ProjectPath != "root/api/export" ||
		got.State != StateOpen || got.ParentEpic != eid(18) || got.Assignee == nil ||
		got.Assignee.Username != "snguyen" || !reflect.DeepEqual(got.Iteration, ptr(0)) || got.Unplanned {
		t.Errorf("issue = %+v", got)
	}
	if is.Assignee.Name = "changed"; got.Assignee.Name != "Sofia Nguyen" {
		t.Error("the assignee must be copied")
	}
}

func TestShownIssues(t *testing.T) {
	viaBlocks := issueItem(1, "it0")
	viaBlocks.Blocks = []string{eid(2), eid(1), eid(1)}
	viaEpicSide := issueItem(2, "") // listed only in the epic's BlockedBy, no iteration
	blockedByEpic := issueItem(3, "it0")
	blockedByEpic.BlockedBy = []string{eid(1)} // an epic blocks it: not shown
	blocksIssue := issueItem(4, "it0")
	blocksIssue.Blocks = []string{iid(1)} // blocks a shown issue only: not shown
	unknown := issueItem(5, "it0")
	unknown.Blocks = []string{"gid://gitlab/WorkItem/elsewhere"}
	otherCadence := issueItem(6, "gid://gitlab/Iteration/other")
	otherCadence.Blocks = []string{eid(1)}
	otherCadence.ParentID = iid(1) // parent that is not an epic
	e1 := epicItem(1, "", "")
	e1.BlockedBy = []string{iid(2)}

	b := buildTest(e1, epicItem(2, "", ""), viaBlocks, viaEpicSide, blockedByEpic, blocksIssue, unknown, otherCadence)
	byID := map[string]Issue{}
	for _, is := range b.Issues {
		byID[is.ID] = is
	}
	if len(b.Issues) != 3 || b.IgnoredIssues != 3 {
		t.Fatalf("shown = %d, ignored = %d", len(b.Issues), b.IgnoredIssues)
	}
	if got := byID[iid(1)].BlocksEpics; !reflect.DeepEqual(got, []string{eid(1), eid(2)}) {
		t.Errorf("blocksEpics = %v", got)
	}
	if is := byID[iid(2)]; !is.Unplanned || is.Iteration != nil || !reflect.DeepEqual(is.BlocksEpics, []string{eid(1)}) {
		t.Errorf("issue 2 = %+v", is)
	}
	if is := byID[iid(6)]; !is.Unplanned || is.ParentEpic != "" {
		t.Errorf("issue 6 = %+v", is)
	}
	for _, l := range b.Links {
		if l.Source == iid(3) || l.Target == iid(3) || l.Source == iid(4) {
			t.Errorf("link to an ignored issue kept: %+v", l)
		}
	}
}

func TestLinkNormalization(t *testing.T) {
	e1, e2, e3 := epicItem(1, "", ""), epicItem(2, "", ""), epicItem(3, "", "")
	e1.Blocks = []string{eid(2), eid(2), eid(1), "gid://gitlab/WorkItem/unknown"} // dup, self, unknown
	e2.BlockedBy = []string{eid(1)}                                               // same link, other side
	e3.BlockedBy = []string{eid(2)}                                               // only on the blocked side
	e3.Related = []string{eid(1), eid(1)}
	e1.Related = []string{eid(3), eid(1)} // same relation, other side; self
	i1 := issueItem(1, "it0")
	i1.Blocks = []string{eid(1)}
	i1.Related = []string{iid(2), iid(9)} // ignored issue, unknown issue
	i1.ParentID = eid(2)
	i2 := issueItem(2, "it0") // ignored
	i2.ParentID = eid(2)
	i2.Related = []string{eid(1)}

	b := buildTest(e3, e2, e1, i1, i2)
	want := []Link{
		{Source: eid(1), Target: eid(2), Type: LinkBlocks},
		{Source: eid(2), Target: eid(3), Type: LinkBlocks},
		{Source: iid(1), Target: eid(1), Type: LinkBlocks},
		{Source: eid(1), Target: eid(3), Type: LinkRelates},
		{Source: eid(2), Target: iid(1), Type: LinkParent},
	}
	if !reflect.DeepEqual(b.Links, want) {
		t.Errorf("links =\n%+v\nwant\n%+v", b.Links, want)
	}
}

func TestRelatesOrdering(t *testing.T) {
	// The relation is stored with Source < Target whichever side lists it.
	for _, fromSecond := range []bool{false, true} {
		a, z := epicItem(1, "", ""), epicItem(2, "", "")
		if fromSecond {
			z.Related = []string{eid(1)}
		} else {
			a.Related = []string{eid(2)}
		}
		b := buildTest(z, a)
		if len(b.Links) != 1 || b.Links[0].Source != eid(1) || b.Links[0].Target != eid(2) {
			t.Errorf("fromSecond=%v: links = %+v", fromSecond, b.Links)
		}
	}
}

func TestBuildLabels(t *testing.T) {
	e := epicItem(1, "", "")
	e.Labels = []Label{{"backend", "#111111"}, {"API", "#222222"}}
	shown := issueItem(1, "it0")
	shown.Blocks = []string{eid(1)}
	shown.Labels = []Label{{"Bug", "#333333"}, {"backend", "#999999"}}
	ignored := issueItem(2, "it0")
	ignored.Labels = []Label{{"ignored-only", "#444444"}}
	b := buildTest(e, shown, ignored)
	want := []Label{{"API", "#222222"}, {"backend", "#111111"}, {"Bug", "#333333"}}
	if !reflect.DeepEqual(b.Labels, want) {
		t.Errorf("labels = %+v, want %+v", b.Labels, want)
	}
}

func TestBuildSorting(t *testing.T) {
	items := []RawItem{
		epicItem(10, "", ""),                      // unplanned
		epicItem(9, "2026-01-20", "2026-02-25"),   // 1..3
		epicItem(100, "2026-01-07", "2026-01-20"), // 0..1
		epicItem(20, "2026-01-07", "2026-01-20"),  // 0..1, smaller IID
		epicItem(3, "2026-01-07", "2026-02-25"),   // 0..3
		issueItem(2, ""), issueItem(10, "it1"),    // unplanned, it1
		issueItem(9, "it1"), issueItem(100, "it0"), // it1, it0
	}
	for i := range items {
		if items[i].Kind == KindIssue {
			items[i].Blocks = []string{eid(10)}
		}
	}
	b := buildTest(items...)
	var epics, issues []string
	for _, e := range b.Epics {
		epics = append(epics, e.Ref)
	}
	for _, is := range b.Issues {
		issues = append(issues, is.Ref)
	}
	if want := []string{"&20", "&100", "&3", "&9", "&10"}; !reflect.DeepEqual(epics, want) {
		t.Errorf("epics = %v, want %v", epics, want)
	}
	if want := []string{"#100", "#9", "#10", "#2"}; !reflect.DeepEqual(issues, want) {
		t.Errorf("issues = %v, want %v", issues, want)
	}
}

func TestBuildEmptyGivesArrays(t *testing.T) {
	for name, raw := range map[string]*Raw{"nil": nil, "empty": {}} {
		b := Build(raw, testNow)
		data, err := json.Marshal(b)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(data), "null") {
			t.Errorf("%s: JSON holds a null: %s", name, data)
		}
		if b.Current != -1 || !b.SyncedAt.Equal(testNow) {
			t.Errorf("%s: current = %d, syncedAt = %v", name, b.Current, b.SyncedAt)
		}
	}
	// Items too: empty labels and blocksEpics.
	is := issueItem(1, "it0")
	is.Blocks = []string{eid(1)}
	b := buildTest(epicItem(1, "2026-01-07", "2026-01-08"), is)
	if b.Epics[0].Labels == nil || b.Issues[0].Labels == nil {
		t.Error("item labels must be [] not null")
	}
}

func TestCmpIID(t *testing.T) {
	if cmpIID("9", "10") >= 0 || cmpIID("10", "9") <= 0 || cmpIID("7", "7") != 0 || cmpIID("a", "b") >= 0 {
		t.Error("cmpIID is not numeric-first")
	}
}

package board

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"
)

func TestDemoIterationsAroundNow(t *testing.T) {
	for _, now := range []time.Time{
		time.Date(2026, 11, 23, 9, 0, 0, 0, time.UTC),  // a Monday
		time.Date(2026, 11, 29, 23, 0, 0, 0, time.UTC), // a Sunday
		time.Date(2027, 1, 1, 12, 0, 0, 0, time.UTC),
	} {
		b := Build(DemoRaw(now), now)
		if len(b.Iterations) != 10 || b.Current != 3 || b.Iterations[3].Title != "Itération 15" {
			t.Fatalf("%v: current = %d among %d", now, b.Current, len(b.Iterations))
		}
		start, _ := time.Parse(dateLayout, b.Iterations[3].StartDate)
		if start.Weekday() != time.Monday {
			t.Errorf("%v: Itération 15 starts on a %v", now, start.Weekday())
		}
		// One-week gap between Itération 17 and 18, none elsewhere.
		for i := 1; i < len(b.Iterations); i++ {
			due, _ := time.Parse(dateLayout, b.Iterations[i-1].DueDate)
			next, _ := time.Parse(dateLayout, b.Iterations[i].StartDate)
			gap := int(next.Sub(due).Hours()/24) - 1
			if want := map[bool]int{true: 7, false: 0}[i == 6]; gap != want {
				t.Errorf("%v: gap before %s = %d days, want %d", now, b.Iterations[i].Title, gap, want)
			}
		}
	}
}

func TestDemoBuild(t *testing.T) {
	now := time.Date(2026, 11, 23, 9, 0, 0, 0, time.UTC)
	b := Build(DemoRaw(now), now)

	// Every issue is sent (ADR-35): 10 block an epic, 9 block none.
	blocking := 0
	for _, is := range b.Issues {
		if len(is.BlocksEpics) > 0 {
			blocking++
		}
	}
	if len(b.Epics) != 12 || len(b.Issues) != 19 || blocking != 10 {
		t.Fatalf("epics %d, issues %d, blocking %d", len(b.Epics), len(b.Issues), blocking)
	}
	if len(b.Groups) != 5 || b.Groups[0].Path != "plateforme/atlas" || b.Groups[1].Path != "plateforme/atlas/api" {
		t.Errorf("groups = %+v", b.Groups)
	}

	ref := map[string]string{}
	epics := map[string]Epic{}
	for _, e := range b.Epics {
		ref[e.ID] = e.Ref
		epics[e.Ref] = e
	}
	issues := map[string]Issue{}
	for _, is := range b.Issues {
		ref[is.ID] = is.Ref
		issues[is.Ref] = is
	}

	// The mockup's spans, plus the extra cases.
	spans := map[string][2]int{
		"&12": {2, 4}, "&13": {5, 7}, "&16": {7, 9}, "&15": {3, 5}, "&17": {6, 8}, "&19": {0, 3},
		"&18": {4, 6}, "&22": {7, 9}, "&21": {5, 7}, "&23": {8, 9}, "&24": {7, 8},
	}
	for r, want := range spans {
		e := epics[r]
		if e.Start == nil || e.End == nil || *e.Start != want[0] || *e.End != want[1] {
			t.Errorf("%s span = %v..%v, want %v", r, e.Start, e.End, want)
		}
	}
	if !epics["&24"].DatesFromChildren || !epics["&25"].Unplanned || b.Epics[len(b.Epics)-1].Ref != "&25" {
		t.Errorf("&24 = %+v, &25 = %+v", epics["&24"], epics["&25"])
	}
	if is := issues["#132"]; !is.Unplanned || b.Issues[len(b.Issues)-1].Ref != "#132" {
		t.Errorf("#132 = %+v", is)
	}
	if is := issues["#110"]; is.GroupPath != "plateforme/atlas/api" || is.ProjectPath != "plateforme/atlas/api/export" ||
		is.WebURL != "https://gitlab.example.com/plateforme/atlas/api/export/-/issues/110" || is.Assignee.Username != "snguyen" {
		t.Errorf("#110 = %+v", is)
	}
	if e := epics["&18"]; e.WebURL != "https://gitlab.example.com/groups/plateforme/atlas/api/-/epics/18" {
		t.Errorf("&18 url = %s", e.WebURL)
	}

	type key struct{ a, typ, b string }
	links := map[key]Link{}
	for _, l := range b.Links {
		k := key{ref[l.Source], l.Type, ref[l.Target]}
		if _, dup := links[k]; dup {
			t.Errorf("duplicate link %v", k)
		}
		links[k] = l
	}
	var conflicts []key
	for _, l := range b.Links {
		if l.Conflict {
			conflicts = append(conflicts, key{ref[l.Source], l.Type, ref[l.Target]})
		}
	}
	wantConflicts := []key{{"#107", "blocks", "&15"}, {"&13", "blocks", "&17"}, {"&18", "blocks", "&21"}}
	if len(conflicts) != len(wantConflicts) {
		t.Errorf("conflicts = %v, want %v", conflicts, wantConflicts)
	}
	for _, k := range wantConflicts {
		if !links[k].Conflict {
			t.Errorf("%v must be a conflict", k)
		}
	}
	// Links of issues that block no epic are kept too: #109 and #103 block none.
	for _, k := range []key{
		{"&12", "blocks", "&13"}, {"#107", "relates", "#110"}, {"&17", "parent", "#125"},
		{"#109", "blocks", "#110"}, {"#103", "relates", "#104"}, {"&12", "parent", "#101"},
	} {
		if _, ok := links[k]; !ok {
			t.Errorf("missing link %v", k)
		}
	}
	// 8 epic → epic (mockup) + 10 issue → epic (mockup and #132) + 1 issue → issue.
	if n := countType(b.Links, LinkBlocks); n != 19 {
		t.Errorf("blocks links = %d, want 19", n)
	}

	var path []string
	for _, id := range b.CriticalPath {
		path = append(path, ref[id])
	}
	// Three chains of four items end at &23; &19 starts earliest (It. 12).
	if want := []string{"&19", "&18", "&21", "&23"}; !reflect.DeepEqual(path, want) {
		t.Errorf("critical path = %v, want %v", path, want)
	}

	first, _ := json.Marshal(b)
	second, _ := json.Marshal(Build(DemoRaw(now), now))
	if string(first) != string(second) {
		t.Error("Build is not deterministic")
	}
}

func countType(links []Link, typ string) int {
	n := 0
	for _, l := range links {
		if l.Type == typ {
			n++
		}
	}
	return n
}

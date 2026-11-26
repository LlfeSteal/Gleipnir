package board

import (
	"reflect"
	"testing"
)

func TestNormDate(t *testing.T) {
	cases := []struct{ in, want string }{
		{"", ""},
		{"2026-1-5", ""},   // too short
		{"2026-02-30", ""}, // no such day
		{"not-a-date", ""}, // date-sized garbage
		{"2026-11-23", "2026-11-23"},
		{"2026-11-23T23:59:59+14:00", "2026-11-23"}, // the date part is kept as written
		{"2024-02-29", "2024-02-29"},                // leap day
	}
	for _, c := range cases {
		if got := normDate(c.in); got != c.want {
			t.Errorf("normDate(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestParentPath(t *testing.T) {
	cases := map[string]string{
		"root/a/proj": "root/a",
		"root/proj":   "root",
		"proj":        "proj", // a project without a group: its own path
		"":            "",
	}
	for in, want := range cases {
		if got := parentPath(in); got != want {
			t.Errorf("parentPath(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestLessFold(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{"alpha", "Beta", true}, // case ignored first
		{"Beta", "alpha", false},
		{"ABC", "abc", true}, // equal folding: exact order ("A" < "a")
		{"abc", "ABC", false},
		{"same", "same", false},
	}
	for _, c := range cases {
		if got := lessFold(c.a, c.b); got != c.want {
			t.Errorf("lessFold(%q, %q) = %v, want %v", c.a, c.b, got, c.want)
		}
	}
}

func TestBuildIterationsSameStartDate(t *testing.T) {
	raw := []RawIteration{
		{ID: "z", Sequence: 2, StartDate: "2026-01-05", DueDate: "2026-01-18"},
		{ID: "b", Sequence: 1, StartDate: "2026-01-05", DueDate: "2026-01-18"},
		{ID: "a", Sequence: 1, StartDate: "2026-01-05", DueDate: "2026-01-18"},
	}
	its, cur := columns(raw, testNow)
	// Same dates: one column (ADR-38), its iterations by sequence, then by ID.
	if len(its) != 1 || its[0].ID != "a" || !reflect.DeepEqual(its[0].IterationIDs, []string{"a", "b", "z"}) {
		t.Fatalf("iterations = %+v, want one column of a, b, z", its)
	}
	if cur != -1 {
		t.Fatalf("current = %d, want -1 (now is after them all)", cur)
	}
}

func TestBuildIterationsCurrentBounds(t *testing.T) {
	its := []RawIteration{{ID: "it", StartDate: "2026-01-20", DueDate: "2026-01-20"}}
	if _, cur := columns(its, testNow); cur != 0 {
		t.Fatalf("a one-day iteration on today: current = %d, want 0", cur)
	}
	if _, cur := columns(nil, testNow); cur != -1 {
		t.Fatalf("no iteration: current = %d, want -1", cur)
	}
}

// Items with the same IID (from different projects or groups) and the same placement keep a
// stable order: by ID.
func TestSortTiesFallBackToTheID(t *testing.T) {
	epicA, epicB := epicItem(1, "2026-01-07", "2026-01-20"), epicItem(1, "2026-01-07", "2026-01-20")
	epicA.ID, epicB.ID = "gid://gitlab/WorkItem/2", "gid://gitlab/WorkItem/1"
	epicB.NamespacePath = "root/b"
	isA, isB := issueItem(5, "it1"), issueItem(5, "it1")
	isA.ID, isB.ID = "gid://gitlab/WorkItem/4", "gid://gitlab/WorkItem/3"
	isB.NamespacePath = "root/b/proj"
	isA.Blocks, isB.Blocks = []string{epicA.ID}, []string{epicA.ID}

	for _, order := range [][]RawItem{{epicA, epicB, isA, isB}, {isB, isA, epicB, epicA}} {
		b := buildTest(order...)
		if len(b.Epics) != 2 || b.Epics[0].ID != epicB.ID || b.Epics[1].ID != epicA.ID {
			t.Errorf("epics %+v: want %s then %s", b.Epics, epicB.ID, epicA.ID)
		}
		if len(b.Issues) != 2 || b.Issues[0].ID != isB.ID || b.Issues[1].ID != isA.ID {
			t.Errorf("issues %+v: want %s then %s", b.Issues, isB.ID, isA.ID)
		}
	}
}

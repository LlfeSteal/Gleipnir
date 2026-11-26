package board

import (
	"encoding/json"
	"reflect"
	"slices"
	"testing"
	"time"
)

// Three cadences (ADR-38). Alpha and Beta share their first iteration's dates; b2 overlaps a2
// without matching it; bg falls in Alpha's gap (02-02 … 02-08); b3 starts after Alpha ends;
// Gamma lies entirely before them. Only Beta is flagged active by GitLab.
const (
	cadA = "gid://gitlab/Iterations::Cadence/1"
	cadB = "gid://gitlab/Iterations::Cadence/2"
	cadC = "gid://gitlab/Iterations::Cadence/3"
)

func multiCadences() []RawCadence {
	return []RawCadence{
		{ID: cadC, Title: "Gamma"},
		{ID: cadB, Title: " Beta ", Active: true},
		{ID: cadA, Title: "Alpha"},
		{ID: cadA, Title: "duplicate"},
		{ID: "", Title: "no id"},
	}
}

func multiIterations() []RawIteration {
	return []RawIteration{
		{ID: "a1", CadenceID: cadA, Sequence: 1, StartDate: "2026-01-05", DueDate: "2026-01-18"},
		{ID: "a2", CadenceID: cadA, Sequence: 2, StartDate: "2026-01-19", DueDate: "2026-02-01"},
		{ID: "a3", CadenceID: cadA, Sequence: 3, StartDate: "2026-02-09", DueDate: "2026-02-22"},
		{ID: "b1", CadenceID: cadB, Title: "Beta 1", Sequence: 1, StartDate: "2026-01-05", DueDate: "2026-01-18"},
		{ID: "b2", CadenceID: cadB, Sequence: 2, StartDate: "2026-01-26", DueDate: "2026-01-28"},
		{ID: "bg", CadenceID: cadB, Sequence: 3, StartDate: "2026-02-03", DueDate: "2026-02-06"},
		{ID: "b3", CadenceID: cadB, Sequence: 4, StartDate: "2026-03-09", DueDate: "2026-03-22"},
		{ID: "c1", CadenceID: cadC, Sequence: 1, StartDate: "2025-06-02", DueDate: "2025-06-15"},
	}
}

func multiRaw(configured string, items ...RawItem) *Raw {
	return &Raw{
		RootGroup:         Group{Path: "root", Name: "Root"},
		Cadences:          multiCadences(),
		ConfiguredCadence: configured,
		Iterations:        multiIterations(),
		Items:             items,
	}
}

func activeCadences(b *Board) []string {
	var ids []string
	for _, c := range b.Cadences {
		if c.Active {
			ids = append(ids, c.ID)
		}
	}
	return ids
}

func columnIDs(b *Board) []string {
	var ids []string
	for _, it := range b.Iterations {
		ids = append(ids, it.ID)
	}
	return ids
}

func day0(s string) time.Time {
	t, _ := time.Parse(dateLayout, s)
	return t.Add(10 * time.Hour)
}

func TestBuildCadencesSortedAndDeduplicated(t *testing.T) {
	b := Build(multiRaw(""), day0("2026-01-20"))
	want := []Cadence{
		{ID: cadA, Title: "Alpha", Active: true},
		{ID: cadB, Title: "Beta"},
		{ID: cadC, Title: "Gamma"},
	}
	if !reflect.DeepEqual(b.Cadences, want) {
		t.Errorf("cadences = %+v, want %+v", b.Cadences, want)
	}
	if b := Build(&Raw{}, testNow); b.Cadences == nil || len(b.Cadences) != 0 || len(b.Iterations) != 0 || b.Current != -1 {
		t.Errorf("no cadence: %+v", b)
	}
}

// ADR-38: the active cadences are the known ones asked for, else the configured one, else
// those holding today, else the first one GitLab flags active, else the first one.
func TestBuildActiveCadences(t *testing.T) {
	tests := []struct {
		name       string
		configured string
		now        string
		selected   []string
		want       []string
	}{
		{"today in Alpha only", "", "2026-01-20", nil, []string{cadA}},
		{"today in Alpha and Beta", "", "2026-01-27", nil, []string{cadA, cadB}},
		{"today first day of a shared iteration", "", "2026-01-05", nil, []string{cadA, cadB}},
		{"none today: the first GitLab active", "", "2027-06-01", nil, []string{cadB}},
		{"configured wins over today", cadC, "2026-01-27", nil, []string{cadC}},
		{"unknown configured: today", "gid://gitlab/Iterations::Cadence/9", "2026-01-20", nil, []string{cadA}},
		{"selection wins over configured", cadC, "2026-01-20", []string{cadB}, []string{cadB}},
		{"several, duplicated, unknown ignored", "", "2026-01-20", []string{cadC, "nope", cadA, cadC}, []string{cadA, cadC}},
		{"only unknown: the default", "", "2026-01-20", []string{"nope", ""}, []string{cadA}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			b := Build(multiRaw(tt.configured), day0(tt.now), tt.selected...)
			if got := activeCadences(b); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("active = %v, want %v", got, tt.want)
			}
		})
	}

	// Without any GitLab active flag nor today: the first cadence by title.
	raw := multiRaw("")
	for i := range raw.Cadences {
		raw.Cadences[i].Active = false
	}
	if got := activeCadences(Build(raw, day0("2027-06-01"))); !reflect.DeepEqual(got, []string{cadA}) {
		t.Errorf("no flag, no today: active = %v, want Alpha", got)
	}
}

// ADR-38: iterations of the active cadences with the same dates make one column, named after
// the cadence first by title; other ones are columns of their own, sorted by start date.
func TestBuildMergesIterationsWithTheSameDates(t *testing.T) {
	b := Build(multiRaw(""), day0("2026-01-27"), cadB, cadA)
	if want := []string{"a1", "a2", "b2", "bg", "a3", "b3"}; !reflect.DeepEqual(columnIDs(b), want) {
		t.Fatalf("columns = %v, want %v", columnIDs(b), want)
	}
	first := b.Iterations[0]
	if first.Title != "Itération 1" || !reflect.DeepEqual(first.IterationIDs, []string{"a1", "b1"}) ||
		!reflect.DeepEqual(first.CadenceIDs, []string{cadA, cadB}) {
		t.Errorf("merged column = %+v", first)
	}
	if got := b.Iterations[2]; !reflect.DeepEqual(got.IterationIDs, []string{"b2"}) || !reflect.DeepEqual(got.CadenceIDs, []string{cadB}) {
		t.Errorf("b2 column = %+v", got)
	}
	// 01-27 is in a2 and in b2: the first column holding it is current.
	if b.Current != 1 || !b.Iterations[1].Current || b.Iterations[2].Current {
		t.Errorf("current = %d", b.Current)
	}

	// Beta alone: its own titles.
	b = Build(multiRaw(""), day0("2026-01-27"), cadB)
	if want := []string{"b1", "b2", "bg", "b3"}; !reflect.DeepEqual(columnIDs(b), want) || b.Iterations[0].Title != "Beta 1" {
		t.Errorf("Beta columns = %v (%q)", columnIDs(b), b.Iterations[0].Title)
	}
}

// ADR-38: with shifted cadences, columns overlap and their due dates are not sorted: the start
// of an epic is the first column, in start order, that ends on or after its start date.
func TestPlaceEpicOnOverlappingColumns(t *testing.T) {
	epic := epicItem(1, "2026-01-29", "2026-02-15")
	b := Build(multiRaw("", epic), day0("2026-01-27"), cadA, cadB)
	// Columns: a1+b1, a2 (… 02-01), b2 (… 01-28), bg, a3, b3. 01-29 is in a2 only.
	e := b.Epics[0]
	if e.Unplanned || *e.Start != 1 || *e.End != 4 {
		t.Errorf("epic = %v … %v (unplanned %v), want 1 … 4", deref(e.Start), deref(e.End), e.Unplanned)
	}
}

func deref(p *int) int {
	if p == nil {
		return -1
	}
	return *p
}

// ADR-38: an issue of an inactive cadence goes to the active column holding its iteration's
// start date, the next one in a gap; it is unplanned past the last column, or when its
// iteration ends before the first one.
func TestIssueOfAnInactiveCadence(t *testing.T) {
	tests := []struct {
		iteration string
		want      int // -1: unplanned
	}{
		{"a2", 1},       // active cadence: its own column
		{"b1", 0},       // same dates as a1
		{"b2", 1},       // inside a2
		{"bg", 2},       // in Alpha's gap: the next column, a3
		{"b3", -1},      // after Alpha's last iteration
		{"c1", -1},      // entirely before Alpha's first iteration
		{"unknown", -1}, // not an iteration of any cadence
		{"", -1},        // no iteration
	}
	for _, tt := range tests {
		t.Run(tt.iteration, func(t *testing.T) {
			b := Build(multiRaw("", issueItem(1, tt.iteration)), day0("2026-01-20"), cadA)
			is := b.Issues[0]
			if got := deref(is.Iteration); got != tt.want || is.Unplanned != (tt.want < 0) {
				t.Errorf("iteration = %d (unplanned %v), want %d", got, is.Unplanned, tt.want)
			}
		})
	}
}

// An iteration starting before the first column and ending in it lands in the first column.
func TestIssueOfAnInactiveCadenceOverlappingTheFirstColumn(t *testing.T) {
	raw := multiRaw("", issueItem(1, "early"))
	raw.Iterations = append(raw.Iterations, RawIteration{ID: "early", CadenceID: cadC, StartDate: "2026-01-01", DueDate: "2026-01-06"})
	if b := Build(raw, day0("2026-01-20"), cadA); deref(b.Issues[0].Iteration) != 0 {
		t.Errorf("iteration = %d, want 0", deref(b.Issues[0].Iteration))
	}
}

// The child issues of an epic without dates count wherever their iteration lands.
func TestEpicFromChildrenOfAnInactiveCadence(t *testing.T) {
	epic := epicItem(1, "", "")
	child := issueItem(1, "b2")
	child.ParentID = eid(1)
	b := Build(multiRaw("", epic, child), day0("2026-01-20"), cadA)
	e := b.Epics[0]
	if !e.DatesFromChildren || deref(e.Start) != 1 || deref(e.End) != 1 {
		t.Errorf("epic = %+v", e)
	}
}

func TestBuildCadencesDeterministic(t *testing.T) {
	raw := multiRaw("", epicItem(1, "2026-01-29", "2026-02-15"), issueItem(1, "b2"))
	raw.Cadences = raw.Cadences[:3] // a duplicate keeps its first copy, like a label
	first, _ := json.Marshal(Build(raw, day0("2026-01-27"), cadA, cadB))
	slices.Reverse(raw.Iterations)
	slices.Reverse(raw.Cadences)
	second, _ := json.Marshal(Build(raw, day0("2026-01-27"), cadB, cadA))
	if string(first) != string(second) {
		t.Errorf("same data, other order:\n%s\n%s", first, second)
	}
}

package board

import (
	"reflect"
	"testing"
)

func TestItemGroup(t *testing.T) {
	tests := []struct {
		name string
		item RawItem
		want string
	}{
		{"epic: its namespace", RawItem{Kind: KindEpic, NamespacePath: "root/a"}, "root/a"},
		{"issue: project minus last segment", RawItem{Kind: KindIssue, NamespacePath: "root/a/proj"}, "root/a"},
		{"issue kind not normalized yet", RawItem{Kind: " Issue ", NamespacePath: "root/proj"}, "root"},
		{"issue without slash", RawItem{Kind: KindIssue, NamespacePath: "proj"}, "proj"},
		{"unknown kind: its namespace", RawItem{Kind: "task", NamespacePath: "root/a/proj"}, "root/a/proj"},
	}
	for _, tt := range tests {
		if got := ItemGroup(tt.item); got != tt.want {
			t.Errorf("%s: ItemGroup = %q, want %q", tt.name, got, tt.want)
		}
	}
}

func TestInScope(t *testing.T) {
	scope := []string{"root/a", "root/c/d"}
	tests := []struct {
		path string
		want bool
	}{
		{"root/a", true},
		{"root/a/b", true},
		{"root/ab", false}, // a sibling sharing a prefix is not a descendant
		{"root", false},
		{"root/c", false},
		{"root/c/d/e", true},
		{"", false},
	}
	for _, tt := range tests {
		if got := InScope(tt.path, scope); got != tt.want {
			t.Errorf("InScope(%q) = %v, want %v", tt.path, got, tt.want)
		}
	}
	if InScope("root/a", nil) {
		t.Error("an empty scope holds nothing")
	}
}

func TestNormalizeScope(t *testing.T) {
	root := Group{Path: "root"}
	groups := []Group{{Path: "root/a"}, {Path: "root/a/b"}, {Path: "root/ab"}, {Path: "root/c"}}
	tests := []struct {
		name  string
		paths []string
		want  []string
	}{
		{"nil", nil, []string{}},
		{"unknown and blank dropped", []string{"other", " ", "", "root/zz"}, []string{}},
		{"sorted", []string{"root/c", "root/a"}, []string{"root/a", "root/c"}},
		{"duplicates", []string{"root/c", "root/c"}, []string{"root/c"}},
		{"descendant covered by its ancestor", []string{"root/a/b", "root/a"}, []string{"root/a"}},
		{"prefix sibling kept", []string{"root/a", "root/ab"}, []string{"root/a", "root/ab"}},
		{"root covers everything", []string{"root/c", "root", "root/a/b"}, []string{"root"}},
		{"spaces and slashes trimmed", []string{" /root/c/ "}, []string{"root/c"}},
	}
	for _, tt := range tests {
		if got := NormalizeScope(tt.paths, root, groups); !reflect.DeepEqual(got, tt.want) {
			t.Errorf("%s: NormalizeScope = %#v, want %#v", tt.name, got, tt.want)
		}
	}
}

func subtrees(scope []string) func(string) bool {
	return func(g string) bool { return InScope(g, scope) }
}

func mergeItem(id, kind, ns string, blocks ...string) RawItem {
	return RawItem{ID: id, Kind: kind, NamespacePath: ns, Blocks: blocks}
}

func itemIDs(items []RawItem) []string {
	ids := []string{}
	for _, it := range items {
		ids = append(ids, it.ID)
	}
	return ids
}

func TestMergeScope(t *testing.T) {
	prevItems := func() []RawItem {
		return []RawItem{
			mergeItem("E1", KindEpic, "root/a"),
			mergeItem("I1", KindIssue, "root/a/proj", "E2"),  // in scope root/a
			mergeItem("E2", KindEpic, "root/b"),              // out of scope
			mergeItem("I2", KindIssue, "root/b/proj", "E1"),  // out of scope, blocks an epic in scope
			mergeItem("I3", KindIssue, "root/a/b/proj"),      // in a descendant of the scope
			mergeItem("I4", KindIssue, "root/ab/proj", "I9"), // sibling sharing the prefix
			mergeItem("I5", KindIssue, "root/b/proj"),        // will move into the scope
		}
	}
	tests := []struct {
		name      string
		scope     []string
		items     []RawItem
		wantIDs   []string
		wantLinks map[string][]string // Blocks of the given items in the result
	}{
		{
			name:    "scope replaced, subtree included",
			scope:   []string{"root/a"},
			items:   []RawItem{mergeItem("E1", KindEpic, "root/a"), mergeItem("I6", KindIssue, "root/a/proj")},
			wantIDs: []string{"E2", "I2", "I4", "I5", "E1", "I6"},
			// I2 → E1 was listed on the stale side only: the fresh E1 doesn't list it, so it goes.
			wantLinks: map[string][]string{"I2": nil, "I4": {"I9"}},
		},
		{
			name:    "deleted or moved out of the scope: gone",
			scope:   []string{"root/a"},
			items:   nil,
			wantIDs: []string{"E2", "I2", "I4", "I5"},
			// I4's link to an item outside the data set is not the merge's business.
			wantLinks: map[string][]string{"I2": nil, "I4": {"I9"}},
		},
		{
			name:      "moved into the scope: the stale copy goes",
			scope:     []string{"root/a"},
			items:     []RawItem{mergeItem("I5", KindIssue, "root/a/proj2", "E2")},
			wantIDs:   []string{"E2", "I2", "I4", "I5"},
			wantLinks: map[string][]string{"I5": {"E2"}},
		},
		{
			name:      "fresh items outside the scope are ignored",
			scope:     []string{"root/c"},
			items:     []RawItem{mergeItem("I4", KindIssue, "root/ab/proj"), mergeItem("I7", KindIssue, "root/b/proj")},
			wantIDs:   []string{"E1", "I1", "E2", "I2", "I3", "I4", "I5"},
			wantLinks: map[string][]string{"I1": {"E2"}, "I2": {"E1"}, "I4": {"I9"}},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			prev := &Raw{GitLabURL: "u", RootGroup: Group{Path: "root"}, Items: prevItems()}
			before := prevItems()
			got := MergeScope(prev, subtrees(tt.scope), tt.items)
			if ids := itemIDs(got.Items); !reflect.DeepEqual(ids, tt.wantIDs) {
				t.Errorf("items = %v, want %v", ids, tt.wantIDs)
			}
			for id, want := range tt.wantLinks {
				for _, it := range got.Items {
					if it.ID == id && !reflect.DeepEqual(it.Blocks, want) {
						t.Errorf("%s.Blocks = %#v, want %#v", id, it.Blocks, want)
					}
				}
			}
			if got.GitLabURL != "u" || got.RootGroup.Path != "root" {
				t.Errorf("the rest of the data set is lost: %+v", got)
			}
			if !reflect.DeepEqual(prev.Items, before) {
				t.Errorf("prev was modified: %+v", prev.Items)
			}
		})
	}
}

func TestMergeScopeStripsEveryLinkKind(t *testing.T) {
	stale := RawItem{ID: "X", Kind: KindEpic, NamespacePath: "root/b",
		Blocks: []string{"A", "Y"}, BlockedBy: []string{"A"}, Related: []string{"A", "Z"}}
	prev := &Raw{Items: []RawItem{stale, mergeItem("A", KindEpic, "root/a")}}
	got := MergeScope(prev, subtrees([]string{"root/a"}), []RawItem{mergeItem("A", KindEpic, "root/a")})
	x := got.Items[0]
	if !reflect.DeepEqual(x.Blocks, []string{"Y"}) || x.BlockedBy != nil || !reflect.DeepEqual(x.Related, []string{"Z"}) {
		t.Errorf("links of X = %v / %v / %v", x.Blocks, x.BlockedBy, x.Related)
	}
	if !reflect.DeepEqual(prev.Items[0].Blocks, []string{"A", "Y"}) {
		t.Errorf("prev's slices were modified: %v", prev.Items[0].Blocks)
	}
}

func TestMergeScopeNilPrev(t *testing.T) {
	got := MergeScope(nil, subtrees([]string{"root"}), []RawItem{mergeItem("A", KindEpic, "root")})
	if ids := itemIDs(got.Items); !reflect.DeepEqual(ids, []string{"A"}) {
		t.Errorf("items = %v", ids)
	}
}

// The merged data set goes through Build: a link removed on the fresh side is gone from the
// board, even though the stale side still lists it.
func TestMergeScopeThenBuild(t *testing.T) {
	epic := epicItem(1, "2026-01-05", "2026-01-18")
	epic.NamespacePath = "root/a"
	issue := issueItem(1, "it0")
	issue.NamespacePath = "root/b/proj"
	issue.Blocks = []string{eid(1)}
	epicBlocked := epic
	epicBlocked.BlockedBy = []string{iid(1)}

	prev := &Raw{RootGroup: Group{Path: "root"}, Iterations: testIterations(), Items: []RawItem{epicBlocked, issue}}
	if b := Build(prev, testNow); len(b.Issues) != 1 || len(b.Issues[0].BlocksEpics) != 1 || len(b.Links) != 1 {
		t.Fatalf("before: issues = %+v, links = %+v", b.Issues, b.Links)
	}
	// The link was removed in GitLab, and only root/a was refreshed: the issue stays, but
	// blocks no epic any more.
	merged := MergeScope(prev, subtrees([]string{"root/a"}), []RawItem{epic})
	if b := Build(merged, testNow); len(b.Issues) != 1 || len(b.Issues[0].BlocksEpics) != 0 || len(b.Links) != 0 {
		t.Errorf("after: issues = %+v, links = %+v", b.Issues, b.Links)
	}
}

// A full sync applied after a scoped refresh that started later keeps the newer groups: the
// scope is every group but those.
func TestMergeScopeExactGroups(t *testing.T) {
	prev := &Raw{Items: []RawItem{
		mergeItem("A1", KindEpic, "root/a", "B1"),
		mergeItem("B1", KindEpic, "root/a/b"), // refreshed after the full sync started
	}}
	newer := map[string]bool{"root/a/b": true}
	full := []RawItem{mergeItem("A1", KindEpic, "root/a"), mergeItem("B1", KindEpic, "root/a/b", "A1"), mergeItem("C1", KindEpic, "root/c")}
	got := MergeScope(prev, func(g string) bool { return !newer[g] }, full)
	if ids := itemIDs(got.Items); !reflect.DeepEqual(ids, []string{"B1", "A1", "C1"}) {
		t.Fatalf("items = %v", ids)
	}
	if got.Items[0].Blocks != nil {
		t.Errorf("the kept B1 has no link in its own data, got %v", got.Items[0].Blocks)
	}
}

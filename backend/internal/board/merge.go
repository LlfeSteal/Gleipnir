package board

import (
	"sort"
	"strings"
)

// ItemGroup is the group an item belongs to (spec §5.3): the namespace of an epic, the
// project path minus its last segment for an issue.
func ItemGroup(it RawItem) string {
	if strings.ToLower(strings.TrimSpace(it.Kind)) == KindIssue {
		return parentPath(it.NamespacePath)
	}
	return it.NamespacePath
}

// InScope tells whether the group path lies in the subtree of one of the scope groups.
func InScope(path string, scope []string) bool {
	for _, s := range scope {
		if path == s || strings.HasPrefix(path, s+"/") {
			return true
		}
	}
	return false
}

// NormalizeScope keeps the paths of known groups (the root group and its descendants), drops
// a path whose ancestor is also listed (its subtree already covers it), and sorts the rest.
func NormalizeScope(paths []string, root Group, groups []Group) []string {
	known := make(map[string]bool, len(groups)+1)
	known[root.Path] = true
	for _, g := range groups {
		known[g.Path] = true
	}
	var kept []string
	for _, p := range paths {
		p = strings.Trim(strings.TrimSpace(p), "/")
		if p != "" && known[p] {
			kept = append(kept, p)
		}
	}
	sort.Strings(kept)
	scope := []string{}
	for _, p := range kept {
		// Sorted: an ancestor ("a") comes before its descendants ("a/b") and duplicates.
		if !InScope(p, scope) {
			scope = append(scope, p)
		}
	}
	return scope
}

// MergeScope returns prev with the items of the groups in scope replaced by items, freshly
// read from GitLab. inScope tells whether a group path is in the scope; fresh items outside it
// are ignored. prev is not modified.
//
//   - Items of prev in the scope, or sharing an ID with a fresh item (moved into the scope),
//     are dropped. An item moved out of the scope disappears until its new group is read.
//   - The fresh side is authoritative for the links touching it: GitLab lists a link on both
//     items and Build joins both sides, so the links of the remaining items pointing into the
//     scope are dropped, or a link deleted in GitLab would live on through the stale side.
//
// Only Items changes: the caller sets the other fields.
func MergeScope(prev *Raw, inScope func(group string) bool, items []RawItem) *Raw {
	if prev == nil {
		prev = &Raw{}
	}
	fresh := make([]RawItem, 0, len(items))
	replaced := map[string]bool{} // fresh IDs, and IDs of prev items in the scope
	for _, it := range items {
		if inScope(ItemGroup(it)) {
			fresh = append(fresh, it)
			replaced[it.ID] = true
		}
	}
	for _, it := range prev.Items {
		if inScope(ItemGroup(it)) {
			replaced[it.ID] = true
		}
	}
	drop := func(id string) bool { return replaced[id] }

	merged := make([]RawItem, 0, len(prev.Items)+len(fresh))
	for _, it := range prev.Items {
		if replaced[it.ID] {
			continue
		}
		it.Blocks = dropIDs(it.Blocks, drop)
		it.BlockedBy = dropIDs(it.BlockedBy, drop)
		it.Related = dropIDs(it.Related, drop)
		merged = append(merged, it)
	}
	merged = append(merged, fresh...)

	next := *prev
	next.Items = merged
	return &next
}

// dropIDs returns ids without those matching drop, as a new slice (ids is shared with the
// previous data set, which must not change).
func dropIDs(ids []string, drop func(string) bool) []string {
	var kept []string
	for _, id := range ids {
		if !drop(id) {
			kept = append(kept, id)
		}
	}
	return kept
}

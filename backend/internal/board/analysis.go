package board

import (
	"log/slog"
	"sort"
)

// itemInfo is what the analyses need of an item. start and end are iteration indexes: an
// epic's Start/End, an issue's Iteration for both; -1 when unplanned. onPath: the item may
// be on the critical path, i.e. an epic or an issue that blocks an epic (ADR-35).
type itemInfo struct {
	ref        string
	open       bool
	planned    bool
	onPath     bool
	start, end int
}

func itemInfos(epics []Epic, issues []Issue) map[string]itemInfo {
	info := make(map[string]itemInfo, len(epics)+len(issues))
	for _, e := range epics {
		in := itemInfo{ref: e.Ref, open: e.State == StateOpen, onPath: true, start: -1, end: -1}
		if e.Start != nil && e.End != nil {
			in.planned, in.start, in.end = true, *e.Start, *e.End
		}
		info[e.ID] = in
	}
	for _, is := range issues {
		in := itemInfo{ref: is.Ref, open: is.State == StateOpen, onPath: len(is.BlocksEpics) > 0, start: -1, end: -1}
		if is.Iteration != nil {
			in.planned, in.start, in.end = true, *is.Iteration, *is.Iteration
		}
		info[is.ID] = in
	}
	return info
}

// markConflicts flags the blocks links, issue → issue ones included, whose open blocker ends strictly after the iteration
// its target starts in. Same iteration is fine (work done early in the sprint); a closed
// blocker is lifted, hence never a conflict; unplanned ends cannot be compared.
func markConflicts(links []Link, info map[string]itemInfo) {
	for i := range links {
		l := &links[i]
		if l.Type != LinkBlocks {
			continue
		}
		src, dst := info[l.Source], info[l.Target]
		l.Conflict = src.open && src.planned && dst.planned && src.end > dst.start
	}
}

// criticalPath returns the longest chain (in items) of blocks links between open epics and
// open issues that block an epic, from the first blocker to the last blocked item; empty
// when there is no such link. Issues that block no epic stay out of it, so it is the same
// whichever issue mode the lanes use (ADR-35).
//
// Cycles are broken by a DFS in ID order that ignores its back edges (logged once). The DAG
// left is solved by memoized DP in DFS post-order, which is a reverse topological order:
// linear in nodes + edges, plus chain comparisons on ties. Ties go to the chain whose last
// item ends latest (unplanned counts as -1), then to the one whose first item starts earliest,
// then to the lexicographically smaller ID list.
// The best chain from v is v + the best chain from one of its successors under that same
// order, since the shared prefix v changes neither length, last item nor ID order.
func criticalPath(links []Link, info map[string]itemInfo) []string {
	succ := map[string][]string{}
	var nodes []string
	seen := map[string]bool{}
	for _, l := range links {
		src, dst := info[l.Source], info[l.Target]
		if l.Type != LinkBlocks || !src.open || !dst.open || !src.onPath || !dst.onPath {
			continue
		}
		succ[l.Source] = append(succ[l.Source], l.Target)
		for _, id := range []string{l.Source, l.Target} {
			if !seen[id] {
				seen[id] = true
				nodes = append(nodes, id)
			}
		}
	}
	if len(nodes) == 0 {
		return []string{}
	}
	sort.Strings(nodes)
	for _, v := range nodes {
		sort.Strings(succ[v])
	}

	const (
		unvisited = iota
		onStack
		done
	)
	state := make(map[string]int, len(nodes))
	dag := make(map[string][]string, len(nodes))
	post := make([]string, 0, len(nodes))
	var back []string
	var visit func(v string)
	visit = func(v string) {
		state[v] = onStack
		for _, w := range succ[v] {
			switch state[w] {
			case onStack:
				back = append(back, info[v].ref+" → "+info[w].ref)
				continue
			case unvisited:
				visit(w)
			}
			dag[v] = append(dag[v], w)
		}
		state[v] = done
		post = append(post, v)
	}
	for _, v := range nodes {
		if state[v] == unvisited {
			visit(v)
		}
	}
	if len(back) > 0 {
		slog.Warn("board: blocking links form a cycle, ignoring them for the critical path", "links", back)
	}

	type best struct {
		length  int
		lastEnd int
		next    string // "" when the chain stops here
	}
	memo := make(map[string]best, len(nodes))
	// lexLess compares the chains starting at a and b, ID by ID.
	lexLess := func(a, b string) bool {
		for a != "" && b != "" {
			if a != b {
				return a < b
			}
			a, b = memo[a].next, memo[b].next
		}
		return a == "" && b != ""
	}
	better := func(a, b string) bool {
		x, y := memo[a], memo[b]
		if x.length != y.length {
			return x.length > y.length
		}
		if x.lastEnd != y.lastEnd {
			return x.lastEnd > y.lastEnd
		}
		return lexLess(a, b)
	}
	for _, v := range post {
		bv := best{length: 1, lastEnd: info[v].end}
		for _, w := range dag[v] {
			if bv.next == "" || better(w, bv.next) {
				bw := memo[w]
				bv = best{length: bw.length + 1, lastEnd: bw.lastEnd, next: w}
			}
		}
		memo[v] = bv
	}

	// Between whole chains, one more tie-break before the IDs: the chain whose first item
	// starts earliest (it spans the most of the plan; unplanned starts last). It can't apply
	// to the successor choice above, where every candidate shares the first item v.
	firstStart := func(v string) int {
		if !info[v].planned {
			return int(^uint(0) >> 1)
		}
		return info[v].start
	}
	betterChain := func(a, b string) bool {
		x, y := memo[a], memo[b]
		if x.length == y.length && x.lastEnd == y.lastEnd && firstStart(a) != firstStart(b) {
			return firstStart(a) < firstStart(b)
		}
		return better(a, b)
	}
	start := ""
	for _, v := range nodes {
		if memo[v].length >= 2 && (start == "" || betterChain(v, start)) {
			start = v
		}
	}
	path := []string{}
	for v := start; v != ""; v = memo[v].next {
		path = append(path, v)
	}
	return path
}

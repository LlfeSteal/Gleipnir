package board

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
)

const dateLayout = "2006-01-02"

// Build applies the business rules (spec §5) to raw data. cadences are the active cadences,
// whose iterations make the columns: unknown IDs are ignored, and without a known one the
// default applies (ADR-38). now picks the current iteration, compared as a calendar date in
// now's location. The output never depends on map iteration order, and every JSON array is
// non-nil so the frontend always gets [].
func Build(raw *Raw, now time.Time, cadences ...string) *Board {
	if raw == nil {
		raw = &Raw{}
	}
	known := validIterations(raw.Iterations)
	cads, active := buildCadences(raw, known, cadences, now)
	its, current := buildIterations(known, cads, active, now)
	iterIdx := make(map[string]int, len(known))
	for i, it := range its {
		for _, id := range it.IterationIDs {
			iterIdx[id] = i
		}
	}
	byID := make(map[string]RawIteration, len(known))
	for _, r := range known {
		byID[r.ID] = r
	}
	// The column of an issue's iteration: its own, or for an iteration of an inactive cadence,
	// the column holding its start date, else the next one; none when the iteration lies
	// entirely before or after the columns, like an epic (ADR-38).
	iterationOf := func(it *RawItem) (int, bool) {
		if i, ok := iterIdx[it.IterationID]; ok {
			return i, true
		}
		if r, ok := byID[it.IterationID]; ok {
			s, _, _, ok := placeEpic(its, r.StartDate, r.DueDate, span{})
			return s, ok
		}
		return 0, false
	}

	items, kinds := dedupItems(raw.Items)
	blocks, relates := normalizeLinks(items, kinds)

	// Spec §5.1: the epics each issue blocks. Every issue is sent; the lane's issue mode
	// decides on the frontend whether one that blocks no epic is shown (ADR-35).
	blocksEpics := map[string][]string{}
	for _, p := range blocks {
		if kinds[p.a] == KindIssue && kinds[p.b] == KindEpic {
			blocksEpics[p.a] = append(blocksEpics[p.a], p.b)
		}
	}

	// Iteration span of each epic's child issues, all of them, blocking an epic or not
	// (spec §5.2).
	children := map[string]span{}
	for _, it := range items {
		if it.Kind != KindIssue || kinds[it.ParentID] != KindEpic {
			continue
		}
		if i, ok := iterationOf(it); ok {
			children[it.ParentID] = children[it.ParentID].add(i)
		}
	}

	epics := []Epic{}
	issues := []Issue{}
	for _, it := range items {
		switch it.Kind {
		case KindEpic:
			e := Epic{
				ID:        it.ID,
				IID:       it.IID,
				Ref:       "&" + it.IID,
				GroupPath: it.NamespacePath,
				Title:     it.Title,
				Labels:    labelTitles(it.Labels),
				State:     normState(it.State),
				StartDate: normDate(it.StartDate),
				DueDate:   normDate(it.DueDate),
				WebURL:    it.WebURL,
			}
			s, end, fromChildren, ok := placeEpic(its, e.StartDate, e.DueDate, children[it.ID])
			if ok {
				e.Start, e.End, e.DatesFromChildren = intPtr(s), intPtr(end), fromChildren
			} else {
				e.Unplanned = true
			}
			epics = append(epics, e)
		case KindIssue:
			targets := blocksEpics[it.ID]
			if targets == nil {
				targets = []string{}
			}
			sort.Strings(targets)
			is := Issue{
				ID:          it.ID,
				IID:         it.IID,
				Ref:         "#" + it.IID,
				GroupPath:   parentPath(it.NamespacePath),
				ProjectPath: it.NamespacePath,
				Title:       it.Title,
				Labels:      labelTitles(it.Labels),
				State:       normState(it.State),
				BlocksEpics: targets,
				WebURL:      it.WebURL,
			}
			if i, ok := iterationOf(it); ok {
				is.Iteration = intPtr(i)
			} else {
				is.Unplanned = true
			}
			if kinds[it.ParentID] == KindEpic {
				is.ParentEpic = it.ParentID
			}
			if it.Assignee != nil {
				a := *it.Assignee
				is.Assignee = &a
			}
			issues = append(issues, is)
		}
	}
	sortEpics(epics)
	sortIssues(issues)

	// Every item of the data set is sent, so every normalized link is kept: both ends are
	// known items (normalizeLinks drops the others).
	links := []Link{}
	for _, p := range blocks {
		links = append(links, Link{Source: p.a, Target: p.b, Type: LinkBlocks})
	}
	for _, p := range relates {
		links = append(links, Link{Source: p.a, Target: p.b, Type: LinkRelates})
	}
	for _, is := range issues {
		if is.ParentEpic != "" {
			links = append(links, Link{Source: is.ParentEpic, Target: is.ID, Type: LinkParent})
		}
	}
	sortLinks(links)

	info := itemInfos(epics, issues)
	markConflicts(links, info)

	return &Board{
		SyncedAt:     now,
		GitLabURL:    raw.GitLabURL,
		RootGroup:    raw.RootGroup,
		Cadences:     cads,
		Iterations:   its,
		Current:      current,
		Groups:       buildGroups(raw.RootGroup, raw.Groups),
		Labels:       buildLabels(items),
		Epics:        epics,
		Issues:       issues,
		Links:        links,
		CriticalPath: criticalPath(links, info),
	}
}

// validIterations normalizes the iterations' dates and drops duplicates (an iteration
// repeated across pages) and iterations without valid dates: the epic placement searches the
// dates, so one bad row would skew it. Input order is kept.
func validIterations(raw []RawIteration) []RawIteration {
	valid := make([]RawIteration, 0, len(raw))
	seen := make(map[string]bool, len(raw))
	for _, r := range raw {
		r.StartDate, r.DueDate = normDate(r.StartDate), normDate(r.DueDate)
		if r.ID == "" || seen[r.ID] || r.StartDate == "" || r.DueDate == "" || r.DueDate < r.StartDate {
			continue
		}
		seen[r.ID] = true
		valid = append(valid, r)
	}
	return valid
}

// buildCadences sorts the cadences by title then ID, and flags the active ones: the known IDs
// of selected, else the default (ADR-38): the configured cadence, else every cadence with an
// iteration holding today, else the first one GitLab flags active, else the first one.
func buildCadences(raw *Raw, its []RawIteration, selected []string, now time.Time) ([]Cadence, map[string]bool) {
	cads := []Cadence{}
	gitlabActive := map[string]bool{}
	for _, c := range raw.Cadences {
		if c.ID == "" || containsCadence(cads, c.ID) {
			continue
		}
		cads = append(cads, Cadence{ID: c.ID, Title: strings.TrimSpace(c.Title)})
		gitlabActive[c.ID] = c.Active
	}
	sort.Slice(cads, func(i, j int) bool {
		if !strings.EqualFold(cads[i].Title, cads[j].Title) {
			return lessFold(cads[i].Title, cads[j].Title)
		}
		return cads[i].ID < cads[j].ID
	})

	active := map[string]bool{}
	for _, id := range selected {
		if containsCadence(cads, id) {
			active[id] = true
		}
	}
	if len(active) == 0 && containsCadence(cads, raw.ConfiguredCadence) {
		active[raw.ConfiguredCadence] = true
	}
	if len(active) == 0 {
		today := now.Format(dateLayout)
		for _, r := range its {
			if r.StartDate <= today && today <= r.DueDate && containsCadence(cads, r.CadenceID) {
				active[r.CadenceID] = true
			}
		}
	}
	if len(active) == 0 {
		for _, c := range cads {
			if gitlabActive[c.ID] {
				active[c.ID] = true
				break
			}
		}
	}
	if len(active) == 0 && len(cads) > 0 {
		active[cads[0].ID] = true
	}
	for i := range cads {
		cads[i].Active = active[cads[i].ID]
	}
	return cads, active
}

func containsCadence(cads []Cadence, id string) bool {
	for _, c := range cads {
		if c.ID == id {
			return true
		}
	}
	return false
}

// buildIterations makes the columns: the iterations of the active cadences, sorted by start
// date, those with the same start and due dates merged into one (ADR-38). It finds the first
// column holding now's calendar date (in now's location), -1 when none does.
func buildIterations(valid []RawIteration, cads []Cadence, active map[string]bool, now time.Time) ([]Iteration, int) {
	rank := make(map[string]int, len(cads)) // cadence order: by title
	for i, c := range cads {
		rank[c.ID] = i
	}
	sorted := make([]RawIteration, 0, len(valid))
	for _, r := range valid {
		if active[r.CadenceID] {
			sorted = append(sorted, r)
		}
	}
	sort.SliceStable(sorted, func(i, j int) bool {
		a, b := sorted[i], sorted[j]
		switch {
		case a.StartDate != b.StartDate:
			return a.StartDate < b.StartDate
		case a.DueDate != b.DueDate:
			return a.DueDate < b.DueDate
		case rank[a.CadenceID] != rank[b.CadenceID]:
			return rank[a.CadenceID] < rank[b.CadenceID]
		case a.Sequence != b.Sequence:
			return a.Sequence < b.Sequence
		}
		return a.ID < b.ID
	})
	today := now.Format(dateLayout)
	its := []Iteration{}
	current := -1
	for _, r := range sorted {
		if n := len(its); n > 0 && its[n-1].StartDate == r.StartDate && its[n-1].DueDate == r.DueDate {
			last := &its[n-1]
			last.IterationIDs = append(last.IterationIDs, r.ID)
			if !containsString(last.CadenceIDs, r.CadenceID) {
				last.CadenceIDs = append(last.CadenceIDs, r.CadenceID)
			}
			continue
		}
		it := Iteration{
			ID:           r.ID,
			Title:        r.Title,
			StartDate:    r.StartDate,
			DueDate:      r.DueDate,
			WebURL:       r.WebURL,
			IterationIDs: []string{r.ID},
			CadenceIDs:   []string{r.CadenceID},
		}
		if strings.TrimSpace(it.Title) == "" {
			it.Title = fmt.Sprintf("Itération %d", r.Sequence)
		}
		if current < 0 && it.StartDate <= today && today <= it.DueDate {
			current = len(its)
			it.Current = true
		}
		its = append(its, it)
	}
	return its, current
}

func containsString(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

// buildGroups puts the root group first, then its descendants sorted by path, ignoring case.
func buildGroups(root Group, descendants []Group) []Group {
	seen := map[string]bool{root.Path: true}
	rest := []Group{}
	for _, g := range descendants {
		if g.Path == "" || seen[g.Path] {
			continue
		}
		seen[g.Path] = true
		rest = append(rest, g)
	}
	sort.Slice(rest, func(i, j int) bool { return lessFold(rest[i].Path, rest[j].Path) })
	return append([]Group{root}, rest...)
}

// buildLabels collects the labels of every item, deduped by title (the first color met in
// input order wins) and sorted by title, ignoring case.
func buildLabels(items []*RawItem) []Label {
	seen := map[string]bool{}
	labels := []Label{}
	for _, it := range items {
		for _, l := range it.Labels {
			if seen[l.Title] {
				continue
			}
			seen[l.Title] = true
			labels = append(labels, l)
		}
	}
	sort.Slice(labels, func(i, j int) bool { return lessFold(labels[i].Title, labels[j].Title) })
	return labels
}

// dedupItems keeps the first item of each ID with a known kind, in input order.
func dedupItems(raw []RawItem) ([]*RawItem, map[string]string) {
	kinds := make(map[string]string, len(raw))
	items := make([]*RawItem, 0, len(raw))
	for i := range raw {
		it := raw[i] // copy: the kind is normalized without touching the caller's data
		it.Kind = strings.ToLower(strings.TrimSpace(it.Kind))
		if it.ID == "" || kinds[it.ID] != "" || (it.Kind != KindEpic && it.Kind != KindIssue) {
			continue
		}
		kinds[it.ID] = it.Kind
		items = append(items, &it)
	}
	return items, kinds
}

type pair struct{ a, b string }

// normalizeLinks implements spec §5.4. GitLab lists a blocking link on both sides (blocks on
// one, blocked by on the other), so both become one blocker → blocked pair. Related links are
// unordered: stored as (smaller ID, greater ID). Self-links and links to an item outside the
// data set are dropped. Both results are sorted.
func normalizeLinks(items []*RawItem, kinds map[string]string) (blocks, relates []pair) {
	seenB, seenR := map[pair]bool{}, map[pair]bool{}
	valid := func(a, b string) bool { return a != b && kinds[a] != "" && kinds[b] != "" }
	addBlocks := func(a, b string) {
		p := pair{a, b}
		if valid(a, b) && !seenB[p] {
			seenB[p] = true
			blocks = append(blocks, p)
		}
	}
	for _, it := range items {
		for _, x := range it.Blocks {
			addBlocks(it.ID, x)
		}
		for _, x := range it.BlockedBy {
			addBlocks(x, it.ID)
		}
		for _, x := range it.Related {
			p := pair{it.ID, x}
			if p.b < p.a {
				p = pair{x, it.ID}
			}
			if valid(p.a, p.b) && !seenR[p] {
				seenR[p] = true
				relates = append(relates, p)
			}
		}
	}
	sortPairs(blocks)
	sortPairs(relates)
	return blocks, relates
}

// span is the min/max iteration index of an epic's child issues; ok is false when none.
type span struct {
	lo, hi int
	ok     bool
}

func (s span) add(i int) span {
	if !s.ok {
		return span{i, i, true}
	}
	if i < s.lo {
		s.lo = i
	}
	if i > s.hi {
		s.hi = i
	}
	return s
}

// placeEpic maps an epic onto iteration indexes (spec §5.2). ok is false when the epic is
// unplanned. The edge rules:
//   - the start is the iteration holding the start date; when that date falls in a gap
//     between two iterations or before the first one, the FOLLOWING iteration;
//   - the end is the iteration holding the due date; when that date falls in a gap, the
//     PRECEDING iteration, and the last one when after the last;
//   - inverted dates (start after due) are swapped first;
//   - an epic lying entirely outside the columns (due before the first iteration starts, or
//     start after the last one ends) is unplanned;
//   - an epic lying entirely inside a gap (start mapped after end) gets the following
//     iteration as both start and end;
//   - only one date set: the missing side comes from the child issues (min for the start,
//     max for the end), else is the same iteration as the set side; it never crosses the
//     set side (children ending before the start date give a one-iteration epic);
//   - no date: min/max of the child issues' iterations (fromChildren), else unplanned.
func placeEpic(its []Iteration, startDate, dueDate string, children span) (start, end int, fromChildren, ok bool) {
	if len(its) == 0 {
		return 0, 0, false, false
	}
	if startDate != "" && dueDate != "" && startDate > dueDate {
		startDate, dueDate = dueDate, startDate
	}
	switch {
	case startDate == "" && dueDate == "":
		if !children.ok {
			return 0, 0, false, false
		}
		return children.lo, children.hi, true, true
	case dueDate == "":
		s, ok := startIteration(its, startDate)
		if !ok {
			return 0, 0, false, false
		}
		e := s
		if children.ok && children.hi > e {
			e = children.hi
		}
		return s, e, false, true
	case startDate == "":
		e, ok := endIteration(its, dueDate)
		if !ok {
			return 0, 0, false, false
		}
		s := e
		if children.ok && children.lo < s {
			s = children.lo
		}
		return s, e, false, true
	default:
		s, okS := startIteration(its, startDate)
		e, okE := endIteration(its, dueDate)
		if !okS || !okE {
			return 0, 0, false, false
		}
		if s > e {
			e = s
		}
		return s, e, false, true
	}
}

// startIteration returns the first iteration that ends on or after date: the one holding
// it, or the following one. false when date is after the last iteration. A linear scan: with
// shifted cadences, columns overlap and their due dates are not sorted (ADR-38).
func startIteration(its []Iteration, date string) (int, bool) {
	for i, it := range its {
		if it.DueDate >= date {
			return i, true
		}
	}
	return len(its), false
}

// endIteration returns the last iteration that starts on or before date: the one holding
// it, or the preceding one. false when date is before the first iteration.
func endIteration(its []Iteration, date string) (int, bool) {
	i := sort.Search(len(its), func(i int) bool { return its[i].StartDate > date }) - 1
	return i, i >= 0
}

func sortEpics(epics []Epic) {
	sort.Slice(epics, func(i, j int) bool {
		a, b := epics[i], epics[j]
		if a.Unplanned != b.Unplanned {
			return b.Unplanned
		}
		if !a.Unplanned {
			if *a.Start != *b.Start {
				return *a.Start < *b.Start
			}
			if *a.End != *b.End {
				return *a.End < *b.End
			}
		}
		if c := cmpIID(a.IID, b.IID); c != 0 {
			return c < 0
		}
		return a.ID < b.ID
	})
}

func sortIssues(issues []Issue) {
	sort.Slice(issues, func(i, j int) bool {
		a, b := issues[i], issues[j]
		if a.Unplanned != b.Unplanned {
			return b.Unplanned
		}
		if !a.Unplanned && *a.Iteration != *b.Iteration {
			return *a.Iteration < *b.Iteration
		}
		if c := cmpIID(a.IID, b.IID); c != 0 {
			return c < 0
		}
		return a.ID < b.ID
	})
}

var linkOrder = map[string]int{LinkBlocks: 0, LinkRelates: 1, LinkParent: 2}

func sortLinks(links []Link) {
	sort.Slice(links, func(i, j int) bool {
		a, b := links[i], links[j]
		if a.Type != b.Type {
			return linkOrder[a.Type] < linkOrder[b.Type]
		}
		if a.Source != b.Source {
			return a.Source < b.Source
		}
		return a.Target < b.Target
	})
}

func sortPairs(ps []pair) {
	sort.Slice(ps, func(i, j int) bool {
		if ps[i].a != ps[j].a {
			return ps[i].a < ps[j].a
		}
		return ps[i].b < ps[j].b
	})
}

// cmpIID compares IIDs numerically, falling back to text for non-numeric ones.
func cmpIID(a, b string) int {
	x, errA := strconv.Atoi(a)
	y, errB := strconv.Atoi(b)
	if errA == nil && errB == nil {
		return x - y
	}
	return strings.Compare(a, b)
}

// lessFold orders strings ignoring case, then exactly, so equal-folding strings stay stable.
func lessFold(a, b string) bool {
	la, lb := strings.ToLower(a), strings.ToLower(b)
	if la != lb {
		return la < lb
	}
	return a < b
}

// parentPath is the group of an issue: its project path minus the last segment (spec §5.3).
func parentPath(project string) string {
	if i := strings.LastIndex(project, "/"); i >= 0 {
		return project[:i]
	}
	return project
}

func normState(s string) string {
	if strings.EqualFold(strings.TrimSpace(s), StateClosed) {
		return StateClosed
	}
	return StateOpen
}

// normDate keeps the YYYY-MM-DD part of a date; "" when unset or unparseable.
func normDate(s string) string {
	if len(s) < len(dateLayout) {
		return ""
	}
	t, err := time.Parse(dateLayout, s[:len(dateLayout)])
	if err != nil {
		return ""
	}
	return t.Format(dateLayout)
}

func labelTitles(labels []Label) []string {
	titles := make([]string, 0, len(labels))
	for _, l := range labels {
		titles = append(titles, l.Title)
	}
	return titles
}

func intPtr(i int) *int { return &i }

package main

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	demo "gitlab-mock/dataset"
)

// webBase prefixes the webUrl of every item: a reserved domain (RFC 2606), so a demo link
// never leads to a real site.
const webBase = "https://gitlab.example.com"

const (
	cadenceID     = "gid://gitlab/Iterations::Cadence/1" // the root group's
	teamCadenceID = "gid://gitlab/Iterations::Cadence/2" // the team's subgroup's (ADR-38)
	dateLayout    = demo.DateLayout
)

// dataset is the demo data as GitLab's GraphQL API returns it, for the queries Gleipnir sends.
type dataset struct {
	root       groupNode
	groups     []groupNode // descendants of root, in any order
	cadences   []ownedCadence
	iterations []iterationNode
	items      []workItemNode
}

// ownedCadence is a cadence and the path of the group that holds it.
type ownedCadence struct {
	cadenceNode
	group string
}

type groupNode struct {
	ID       string `json:"id"`
	FullPath string `json:"fullPath"`
	Name     string `json:"name"`
}

type cadenceNode struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Active bool   `json:"active"`
}

type iterationNode struct {
	ID               string      `json:"id"`
	Title            *string     `json:"title"`
	Sequence         int         `json:"sequence"`
	StartDate        string      `json:"startDate"`
	DueDate          string      `json:"dueDate"`
	WebURL           string      `json:"webUrl"`
	IterationCadence cadenceNode `json:"iterationCadence"`
}

type idRef struct {
	ID string `json:"id"`
}

type workItemNode struct {
	ID           string       `json:"id"`
	IID          string       `json:"iid"`
	Title        string       `json:"title"`
	State        string       `json:"state"` // OPEN or CLOSED
	WebURL       string       `json:"webUrl"`
	Namespace    namespaceRef `json:"namespace"`
	WorkItemType struct {
		Name string `json:"name"`
	} `json:"workItemType"`
	Widgets []map[string]any `json:"widgets"`
}

// namespaceRef: the group of an epic, the project of an issue.
type namespaceRef struct {
	ID       string `json:"id"`
	FullPath string `json:"fullPath"`
}

// knows tells whether path is a group of the dataset (projects are not groups).
func (d *dataset) knows(path string) bool {
	return path == d.root.FullPath || d.descendant(path) != nil
}

func (d *dataset) descendant(path string) *groupNode {
	for i := range d.groups {
		if d.groups[i].FullPath == path {
			return &d.groups[i]
		}
	}
	return nil
}

// group returns the group at path; ok is false when the dataset has none.
func (d *dataset) group(path string) (groupNode, bool) {
	if path == d.root.FullPath {
		return d.root, true
	}
	if g := d.descendant(path); g != nil {
		return *g, true
	}
	return groupNode{}, false
}

// descendantsOf lists the groups below path, at every level.
func (d *dataset) descendantsOf(path string) []groupNode {
	out := []groupNode{}
	for _, g := range d.groups {
		if under(g.FullPath, path) {
			out = append(out, g)
		}
	}
	return out
}

// itemsUnder lists the work items of the group at path and of its descendants and projects,
// as includeDescendants: true does.
func (d *dataset) itemsUnder(path string) []workItemNode {
	out := []workItemNode{}
	for _, it := range d.items {
		if it.Namespace.FullPath == path || under(it.Namespace.FullPath, path) {
			out = append(out, it)
		}
	}
	return out
}

// cadencesOf lists the cadences of the group at path and of its ancestors, as
// iterationCadences(includeAncestorGroups: true) does: never a descendant's.
func (d *dataset) cadencesOf(path string) []cadenceNode {
	out := []cadenceNode{}
	for _, c := range d.cadences {
		if c.group == path || under(path, c.group) {
			out = append(out, c.cadenceNode)
		}
	}
	return out
}

// iterationsAround lists the iterations of the cadences of the group at path, its ancestors
// and its descendants, as iterations(includeAncestors: true, includeDescendants: true) does.
func (d *dataset) iterationsAround(path string) []iterationNode {
	owner := map[string]string{}
	for _, c := range d.cadences {
		owner[c.ID] = c.group
	}
	out := []iterationNode{}
	for _, it := range d.iterations {
		g := owner[it.IterationCadence.ID]
		if g == path || under(path, g) || under(g, path) {
			out = append(out, it)
		}
	}
	return out
}

// under tells whether path is strictly below parent.
func under(path, parent string) bool {
	return strings.HasPrefix(path, parent+"/")
}

// defaultRoot is the fake GitLab's root group: GITLAB_GROUP of the demo.
const defaultRoot = "plateforme/atlas"

// layout places the dataset. The zero value is the mockup's: root plateforme/atlas, named
// Atlas, items numbered as in the mockup (&18, #110). gitlabIIDs numbers them as a GitLab
// filled by the seeder would: from 1 in each group (epics) and each project (issues), in
// creation order, so references repeat ("&1" in every group). The e2e must pass on both.
type layout struct {
	root, rootName string
	gitlabIIDs     bool
}

// newDataset renders the demo data (package dataset) placed around now as GitLab's GraphQL
// API returns it. On top of the shared data, &22 is related to an item outside the group, a
// link the backend must drop.
func newDataset(now time.Time, lay layout) *dataset {
	ds := demo.New(now)
	rootPath, rootName := lay.root, lay.rootName
	if rootPath == "" {
		rootPath = defaultRoot
	}
	if rootName == "" {
		rootName = ds.RootName
	}
	// iid numbers an item: its mockup number, or the next one of its namespace.
	counters := map[string]int{}
	iid := func(key, namespace string) string {
		if !lay.gitlabIIDs {
			return key[1:]
		}
		counters[namespace]++
		return strconv.Itoa(counters[namespace])
	}
	d := &dataset{root: groupNode{ID: "gid://gitlab/Group/40", FullPath: rootPath, Name: rootName}}
	teamGroup := rootPath + "/" + ds.Team.Group
	d.cadences = []ownedCadence{
		{cadenceNode{ID: cadenceID, Title: ds.Cadence, Active: true}, rootPath},
		{cadenceNode{ID: teamCadenceID, Title: ds.Team.Title, Active: true}, teamGroup},
	}
	groupIDs := map[string]int{rootPath: 40}
	for i, g := range ds.Groups {
		path := rootPath + "/" + g.Slug
		groupIDs[path] = 41 + i
		d.groups = append(d.groups, groupNode{ID: fmt.Sprintf("gid://gitlab/Group/%d", 41+i), FullPath: path, Name: g.Name})
	}
	projectIDs := map[string]int{}
	for i, p := range ds.Projects {
		projectIDs[rootPath+"/"+p.Path()] = 100 + i
	}

	iterationIDs := make([]string, len(ds.Iterations))
	for i, it := range ds.Iterations {
		title := it.Title
		iterationIDs[i] = fmt.Sprintf("gid://gitlab/Iteration/%d", 300+it.Sequence)
		d.iterations = append(d.iterations, iterationNode{
			ID:               iterationIDs[i],
			Title:            &title,
			Sequence:         it.Sequence,
			StartDate:        it.StartDate,
			DueDate:          it.DueDate,
			WebURL:           fmt.Sprintf("%s/groups/%s/-/cadences/1/iterations/%d", webBase, rootPath, 300+it.Sequence),
			IterationCadence: d.cadences[0].cadenceNode,
		})
	}
	// The team's iterations, by the index of the root iteration with the same dates.
	teamIDs := map[int]string{}
	for i, it := range ds.TeamIterations() {
		title, n := it.Title, 400+it.Sequence
		teamIDs[ds.Team.First+i] = fmt.Sprintf("gid://gitlab/Iteration/%d", n)
		d.iterations = append(d.iterations, iterationNode{
			ID:               teamIDs[ds.Team.First+i],
			Title:            &title,
			Sequence:         it.Sequence,
			StartDate:        it.StartDate,
			DueDate:          it.DueDate,
			WebURL:           fmt.Sprintf("%s/groups/%s/-/cadences/2/iterations/%d", webBase, teamGroup, n),
			IterationCadence: d.cadences[1].cadenceNode,
		})
	}

	// The work item GID of a key: &N → 500+N, #N → 1000+N.
	gid := func(key string) string {
		n, _ := strconv.Atoi(key[1:])
		if key[0] == '&' {
			return fmt.Sprintf("gid://gitlab/WorkItem/%d", 500+n)
		}
		return fmt.Sprintf("gid://gitlab/WorkItem/%d", 1000+n)
	}
	type links struct{ blocks, blockedBy, related []string }
	linked := map[string]*links{}
	side := func(key string) *links {
		if linked[key] == nil {
			linked[key] = &links{}
		}
		return linked[key]
	}
	for _, l := range ds.Links {
		from, to := side(l.From), side(l.To)
		switch l.Kind {
		case demo.Blocks:
			if l.FromSide {
				from.blocks = append(from.blocks, gid(l.To))
			}
			if l.ToSide {
				to.blockedBy = append(to.blockedBy, gid(l.From))
			}
		case demo.Relates:
			if l.FromSide {
				from.related = append(from.related, gid(l.To))
			}
			if l.ToSide {
				to.related = append(to.related, gid(l.From))
			}
		}
	}
	side("&22").related = append(side("&22").related, "gid://gitlab/WorkItem/9999")

	labelNodes := func(titles []string) []map[string]any {
		out := []map[string]any{}
		for _, t := range titles {
			l, _ := ds.Label(t)
			out = append(out, map[string]any{"title": l.Title, "color": l.Color})
		}
		return out
	}
	common := func(key string, labels []string, assignee, parent string) []map[string]any {
		people := []map[string]any{}
		if p, ok := ds.Person(assignee); ok {
			people = append(people, map[string]any{"name": p.Name, "username": p.Username})
		}
		l := side(key)
		return []map[string]any{
			{"__typename": "WorkItemWidgetAssignees", "assignees": map[string]any{"nodes": people}},
			{"__typename": "WorkItemWidgetLabels", "labels": map[string]any{"nodes": labelNodes(labels)}},
			{"__typename": "WorkItemWidgetHierarchy", "parent": optionalRef(parent)},
			{
				"__typename": "WorkItemWidgetLinkedItems",
				"blocks":     linkedConn(l.blocks),
				"blockedBy":  linkedConn(l.blockedBy),
				"related":    linkedConn(l.related),
			},
		}
	}

	for _, e := range ds.Epics {
		group := demo.Under(rootPath, e.Group)
		number := iid(e.Key, group)
		n := workItemNode{
			ID: gid(e.Key), IID: number, Title: e.Title, State: "OPEN",
			WebURL:    fmt.Sprintf("%s/groups/%s/-/work_items/%s", webBase, group, number),
			Namespace: namespaceRef{ID: fmt.Sprintf("gid://gitlab/Group/%d", groupIDs[group]), FullPath: group},
		}
		n.WorkItemType.Name = "Epic"
		n.Widgets = append(common(e.Key, e.Labels, "", ""), map[string]any{
			"__typename": "WorkItemWidgetStartAndDueDate", "startDate": optional(e.StartDate), "dueDate": optional(e.DueDate),
		})
		d.items = append(d.items, n)
	}
	for _, is := range ds.Issues {
		project := rootPath + "/" + is.Project
		state := "OPEN"
		if is.Closed {
			state = "CLOSED"
		}
		number := iid(is.Key, project)
		n := workItemNode{
			ID: gid(is.Key), IID: number, Title: is.Title, State: state,
			WebURL:    fmt.Sprintf("%s/%s/-/work_items/%s", webBase, project, number),
			Namespace: namespaceRef{ID: fmt.Sprintf("gid://gitlab/Namespaces::ProjectNamespace/%d", projectIDs[project]), FullPath: project},
		}
		n.WorkItemType.Name = "Issue"
		iteration := ""
		switch {
		case is.Team:
			iteration = teamIDs[is.Iteration]
		case is.Iteration >= 0:
			iteration = iterationIDs[is.Iteration]
		}
		parent := ""
		if is.Parent != "" {
			parent = gid(is.Parent)
		}
		// Issues have both widgets on GitLab; the backend reads only the iteration of an issue.
		n.Widgets = append(common(is.Key, is.Labels, is.Assignee, parent),
			map[string]any{"__typename": "WorkItemWidgetStartAndDueDate", "startDate": nil, "dueDate": nil},
			map[string]any{"__typename": "WorkItemWidgetIteration", "iteration": optionalRef(iteration)},
		)
		d.items = append(d.items, n)
	}
	return d
}

// optional is s, or JSON null when s is empty.
func optional(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// optionalRef is {id}, or JSON null when id is empty.
func optionalRef(id string) any {
	if id == "" {
		return nil
	}
	return idRef{ID: id}
}

// linkedConn is a linkedItems connection to ids.
func linkedConn(ids []string) map[string]any {
	nodes := make([]map[string]any, 0, len(ids))
	for _, id := range ids {
		nodes = append(nodes, map[string]any{"workItem": idRef{ID: id}})
	}
	return map[string]any{"nodes": nodes}
}

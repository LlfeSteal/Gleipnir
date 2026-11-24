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
	cadenceID  = "gid://gitlab/Iterations::Cadence/1"
	dateLayout = demo.DateLayout
)

// dataset is the demo data as GitLab's GraphQL API returns it, for the queries Gleipnir sends.
type dataset struct {
	root       groupNode
	groups     []groupNode // descendants of root, in any order
	cadence    string      // title of the one cadence
	iterations []iterationNode
	items      []workItemNode
}

type groupNode struct {
	FullPath string `json:"fullPath"`
	Name     string `json:"name"`
}

type cadenceNode struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Active bool   `json:"active"`
}

type idTitle struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

type iterationNode struct {
	ID               string  `json:"id"`
	Title            *string `json:"title"`
	Sequence         int     `json:"sequence"`
	StartDate        string  `json:"startDate"`
	DueDate          string  `json:"dueDate"`
	WebURL           string  `json:"webUrl"`
	IterationCadence idTitle `json:"iterationCadence"`
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

// under tells whether path is strictly below parent.
func under(path, parent string) bool {
	return strings.HasPrefix(path, parent+"/")
}

// rootPath is the fake GitLab's root group: GITLAB_GROUP of the demo.
const rootPath = "plateforme/atlas"

// newDataset renders the demo data (package dataset) placed around now as GitLab's GraphQL
// API returns it. On top of the shared data, &22 is related to an item outside the group, a
// link the backend must drop.
func newDataset(now time.Time) *dataset {
	ds := demo.New(now)
	d := &dataset{root: groupNode{FullPath: rootPath, Name: ds.RootName}, cadence: ds.Cadence}
	groupIDs := map[string]int{rootPath: 40}
	for i, g := range ds.Groups {
		path := rootPath + "/" + g.Slug
		d.groups = append(d.groups, groupNode{FullPath: path, Name: g.Name})
		groupIDs[path] = 41 + i
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
			IterationCadence: idTitle{ID: cadenceID, Title: ds.Cadence},
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
		group := rootPath + "/" + e.Group
		n := workItemNode{
			ID: gid(e.Key), IID: e.Key[1:], Title: e.Title, State: "OPEN",
			WebURL:    fmt.Sprintf("%s/groups/%s/-/work_items/%s", webBase, group, e.Key[1:]),
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
		n := workItemNode{
			ID: gid(is.Key), IID: is.Key[1:], Title: is.Title, State: state,
			WebURL:    fmt.Sprintf("%s/%s/-/work_items/%s", webBase, project, is.Key[1:]),
			Namespace: namespaceRef{ID: fmt.Sprintf("gid://gitlab/Namespaces::ProjectNamespace/%d", projectIDs[project]), FullPath: project},
		}
		n.WorkItemType.Name = "Issue"
		iteration := ""
		if is.Iteration >= 0 {
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

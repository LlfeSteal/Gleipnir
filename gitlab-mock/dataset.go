package main

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// webBase prefixes the webUrl of every item: a reserved domain (RFC 2606), so a demo link
// never leads to a real site.
const webBase = "https://gitlab.example.com"

const (
	cadenceID    = "gid://gitlab/Iterations::Cadence/1"
	cadenceTitle = "Sprints produit"
	dateLayout   = "2006-01-02"
)

// dataset is the demo data as GitLab's GraphQL API returns it, for the queries Gleipnir sends.
type dataset struct {
	root       groupNode
	groups     []groupNode // descendants of root, in any order
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

// newDataset builds the demo data around now: ten two-week iterations, "Itération 15"
// starting on the Monday on or before now, with a one-week holiday gap between Itération 17
// and 18. On top of the mockup it holds an epic dated by its children (&24), an epic with
// neither dates nor children (&25) and an open issue that blocks an epic without an
// iteration (#132). Some links are listed on both sides, as GitLab does, and one points
// outside the group, so that the backend's normalization runs.
func newDataset(now time.Time) *dataset {
	const (
		root     = "plateforme/atlas"
		identite = root + "/identite"
		xp       = root + "/experience"
		api      = root + "/api"
		data     = root + "/data"
	)
	groupIDs := map[string]int{root: 40, identite: 41, xp: 42, api: 43, data: 44}

	y, m, d := now.Date()
	today := time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
	monday := today.AddDate(0, 0, -((int(today.Weekday()) + 6) % 7))
	its := make([]iterationNode, 0, 10)
	for i := range 10 {
		start := monday.AddDate(0, 0, (i-3)*14)
		if i >= 6 {
			start = start.AddDate(0, 0, 7)
		}
		n := 12 + i
		title := fmt.Sprintf("Itération %d", n)
		its = append(its, iterationNode{
			ID:               fmt.Sprintf("gid://gitlab/Iteration/%d", 300+n),
			Title:            &title,
			Sequence:         n,
			StartDate:        start.Format(dateLayout),
			DueDate:          start.AddDate(0, 0, 13).Format(dateLayout),
			WebURL:           fmt.Sprintf("%s/groups/%s/-/cadences/1/iterations/%d", webBase, root, 300+n),
			IterationCadence: idTitle{ID: cadenceID, Title: cadenceTitle},
		})
	}

	type label struct{ title, color string }
	labels := map[string]label{}
	for _, l := range []label{
		{"frontend", "#428bca"}, {"backend", "#6699cc"}, {"API", "#009966"}, {"bug", "#dc143c"},
		{"sécurité", "#ed9121"}, {"UX", "#d10069"}, {"data", "#8fbc8f"}, {"mobile", "#5843ad"},
		{"priorité::haute", "#9e1c1c"},
	} {
		labels[l.title] = l
	}
	type person struct{ name, username string }
	people := map[string]person{
		"AL": {"Amélie Laurent", "alaurent"},
		"MB": {"Malik Benali", "mbenali"},
		"CD": {"Chloé Dubois", "cdubois"},
		"TR": {"Thomas Roux", "troux"},
		"SN": {"Sofia Nguyen", "snguyen"},
		"JP": {"Julien Petit", "jpetit"},
	}

	// item holds what the widgets are built from, once every link is known.
	type item struct {
		node                   workItemNode
		start, due, iteration  string
		parent                 string
		labels                 []string
		assignee               string
		blocks, blockedBy, rel []string
	}
	var items []*item
	byID := map[string]*item{}
	add := func(it *item) {
		items = append(items, it)
		byID[it.node.ID] = it
	}
	epicID := func(iid int) string { return fmt.Sprintf("gid://gitlab/WorkItem/%d", 500+iid) }
	issueID := func(iid int) string { return fmt.Sprintf("gid://gitlab/WorkItem/%d", 1000+iid) }
	projectIDs := map[string]int{}

	// epic adds an epic spanning iterations first..last (mockup indexes, -1: no date).
	epic := func(iid int, group, title string, first, last int, lbls ...string) {
		it := &item{labels: lbls}
		it.node = workItemNode{
			ID: epicID(iid), IID: strconv.Itoa(iid), Title: title, State: "OPEN",
			WebURL:    fmt.Sprintf("%s/groups/%s/-/work_items/%d", webBase, group, iid),
			Namespace: namespaceRef{ID: fmt.Sprintf("gid://gitlab/Group/%d", groupIDs[group]), FullPath: group},
		}
		it.node.WorkItemType.Name = "Epic"
		if first >= 0 {
			it.start = its[first].StartDate
		}
		if last >= 0 {
			it.due = its[last].DueDate
		}
		add(it)
	}
	// issue adds an issue of project in iteration iter (-1: none), child of epic parent.
	issue := func(iid int, project, title string, iter, parent int, state, who string, lbls ...string) {
		if _, ok := projectIDs[project]; !ok {
			projectIDs[project] = 100 + len(projectIDs)
		}
		it := &item{labels: lbls, assignee: who}
		it.node = workItemNode{
			ID: issueID(iid), IID: strconv.Itoa(iid), Title: title, State: state,
			WebURL:    fmt.Sprintf("%s/%s/-/work_items/%d", webBase, project, iid),
			Namespace: namespaceRef{ID: fmt.Sprintf("gid://gitlab/Namespaces::ProjectNamespace/%d", projectIDs[project]), FullPath: project},
		}
		it.node.WorkItemType.Name = "Issue"
		if iter >= 0 {
			it.iteration = its[iter].ID
		}
		if parent > 0 {
			it.parent = epicID(parent)
		}
		add(it)
	}

	epic(12, identite, "Authentification SSO", 2, 4, "sécurité", "backend")
	epic(13, identite, "Gestion fine des droits", 5, 7, "sécurité", "backend")
	epic(16, identite, "Journal d'audit", 7, 9, "sécurité")
	epic(15, xp, "Refonte du tableau de bord", 3, 5, "frontend", "UX")
	epic(17, xp, "Mode hors ligne mobile", 6, 8, "mobile", "frontend")
	epic(19, api, "Webhooks sortants", 0, 3, "API", "backend")
	epic(18, api, "API d'export des données", 4, 6, "API", "backend")
	epic(22, api, "Portail développeur", 7, 9, "API", "UX")
	epic(21, data, "Pipeline analytique", 5, 7, "data", "backend")
	epic(23, data, "Modèles prédictifs", 8, 9, "data")
	// Extra cases: dates inherited from children, and no date nor child at all.
	epic(24, xp, "Notifications push", -1, -1, "mobile")
	epic(25, xp, "Accessibilité RGAA", -1, -1, "UX", "frontend")

	const open, closed = "OPEN", "CLOSED"
	sso, webhooks, export := identite+"/sso", api+"/webhooks", api+"/export"
	web, mobile, pipeline := xp+"/web", xp+"/mobile", data+"/pipeline"
	// Issues that block an epic (shown).
	issue(104, sso, "Corriger la déconnexion intempestive", 3, 12, open, "TR", "bug", "priorité::haute", "backend")
	issue(114, sso, "Audit de sécurité du SSO", 4, 12, open, "TR", "sécurité")
	issue(140, webhooks, "Contrat d’interface des webhooks", 1, 19, closed, "SN", "API")
	issue(107, export, "API d'agrégation des métriques", 4, 18, open, "SN", "backend", "API")
	issue(110, export, "Endpoint d’export CSV / JSON", 5, 18, open, "SN", "backend", "API")
	issue(113, web, "Lenteur au chargement du tableau", 5, 15, open, "MB", "bug", "priorité::haute", "frontend")
	issue(125, mobile, "Quota de stockage local", 6, 17, open, "CD", "mobile", "backend")
	issue(131, pipeline, "Montée de version Kafka", 2, 21, closed, "JP", "data", "backend")
	issue(130, pipeline, "Schéma d'événements v2", 6, 21, open, "JP", "data")
	issue(132, pipeline, "Purge des données personnelles", -1, 23, open, "AL", "data", "sécurité")
	// Issues that block no epic (ignored by the board, but they still date their parent epic).
	issue(101, sso, "Configurer le fournisseur SAML", 2, 12, closed, "AL", "backend", "sécurité")
	issue(103, sso, "Gestion des sessions et refresh token", 3, 12, open, "AL", "backend", "sécurité")
	issue(106, web, "Widgets configurables", 4, 15, open, "MB", "frontend")
	issue(108, web, "Persistance des préférences utilisateur", 5, 15, open, "AL", "backend")
	issue(109, export, "Spécification OpenAPI de l'export", 4, 18, open, "SN", "API")
	issue(112, export, "Documentation développeur de l'export", 6, 18, open, "CD", "API")
	issue(120, pipeline, "Ingestion des événements produit", 5, 21, open, "JP", "data", "backend")
	issue(126, mobile, "Service d'envoi des notifications", 7, 24, open, "CD", "mobile", "backend")
	issue(127, mobile, "Préférences de notification", 8, 24, open, "MB", "mobile")

	ref := func(r string) string {
		n, _ := strconv.Atoi(r[1:])
		if r[0] == '&' {
			return epicID(n)
		}
		return issueID(n)
	}
	// blocks records "a blocks b" on the blocker's side, the blocked side or both, as GitLab
	// does.
	blocks := func(a, b string, blockerSide, blockedSide bool) {
		if blockerSide {
			byID[ref(a)].blocks = append(byID[ref(a)].blocks, ref(b))
		}
		if blockedSide {
			byID[ref(b)].blockedBy = append(byID[ref(b)].blockedBy, ref(a))
		}
	}
	relates := func(a, b string, both bool) {
		byID[ref(a)].rel = append(byID[ref(a)].rel, ref(b))
		if both {
			byID[ref(b)].rel = append(byID[ref(b)].rel, ref(a))
		}
	}

	// Epic ↔ epic.
	blocks("&12", "&13", true, true)
	blocks("&12", "&18", true, false)
	blocks("&19", "&18", false, true)
	blocks("&18", "&22", true, true)
	blocks("&13", "&16", true, false)
	blocks("&13", "&17", true, true)
	relates("&15", "&17", true)
	blocks("&18", "&21", true, true)
	blocks("&21", "&23", false, true)
	relates("&16", "&22", false)
	relates("&24", "&17", true)
	// Issue → epic (only these issues are shown).
	blocks("#104", "&13", true, true)
	blocks("#114", "&18", true, false)
	blocks("#140", "&18", true, true)
	blocks("#107", "&15", true, true)
	blocks("#110", "&21", false, true)
	blocks("#113", "&17", true, true)
	blocks("#125", "&17", true, false)
	blocks("#131", "&21", true, true)
	blocks("#130", "&23", true, true)
	blocks("#132", "&23", true, true)
	// Issue ↔ issue: dropped unless both issues are shown.
	relates("#107", "#110", true)
	relates("#103", "#104", true)
	blocks("#109", "#110", true, true)
	// A link to an item outside the group, dropped.
	byID[ref("&22")].rel = append(byID[ref("&22")].rel, "gid://gitlab/WorkItem/9999")

	nodes := make([]workItemNode, 0, len(items))
	for _, it := range items {
		lbls := []map[string]any{}
		for _, t := range it.labels {
			lbls = append(lbls, map[string]any{"title": labels[t].title, "color": labels[t].color})
		}
		assignees := []map[string]any{}
		if p, ok := people[it.assignee]; ok {
			assignees = append(assignees, map[string]any{"name": p.name, "username": p.username})
		}
		n := it.node
		n.Widgets = []map[string]any{
			{"__typename": "WorkItemWidgetAssignees", "assignees": map[string]any{"nodes": assignees}},
			{"__typename": "WorkItemWidgetLabels", "labels": map[string]any{"nodes": lbls}},
			{"__typename": "WorkItemWidgetHierarchy", "parent": optionalRef(it.parent)},
			{
				"__typename": "WorkItemWidgetLinkedItems",
				"blocks":     linked(it.blocks),
				"blockedBy":  linked(it.blockedBy),
				"related":    linked(it.rel),
			},
		}
		if n.WorkItemType.Name == "Epic" {
			n.Widgets = append(n.Widgets, map[string]any{
				"__typename": "WorkItemWidgetStartAndDueDate", "startDate": optional(it.start), "dueDate": optional(it.due),
			})
		} else {
			// Issues have both widgets on GitLab; the backend reads only the iteration of an issue.
			n.Widgets = append(n.Widgets,
				map[string]any{"__typename": "WorkItemWidgetStartAndDueDate", "startDate": nil, "dueDate": nil},
				map[string]any{"__typename": "WorkItemWidgetIteration", "iteration": optionalRef(it.iteration)},
			)
		}
		nodes = append(nodes, n)
	}

	return &dataset{
		root: groupNode{FullPath: root, Name: "Atlas"},
		groups: []groupNode{
			{FullPath: identite, Name: "Identité & sécurité"},
			{FullPath: xp, Name: "Expérience produit"},
			{FullPath: api, Name: "API & intégrations"},
			{FullPath: data, Name: "Data"},
		},
		iterations: its,
		items:      nodes,
	}
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

// linked is a linkedItems connection to ids.
func linked(ids []string) map[string]any {
	nodes := make([]map[string]any, 0, len(ids))
	for _, id := range ids {
		nodes = append(nodes, map[string]any{"workItem": idRef{ID: id}})
	}
	return map[string]any{"nodes": nodes}
}

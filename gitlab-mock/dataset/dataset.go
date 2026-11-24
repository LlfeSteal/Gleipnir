// Package dataset describes Gleipnir's demo data once, in terms a real GitLab can store: the
// fake GitLab renders it as GraphQL, the seeder writes it into a GitLab instance. Paths are
// relative to the root group, which each side chooses.
package dataset

import (
	"fmt"
	"time"
)

// DateLayout is GitLab's date format.
const DateLayout = "2006-01-02"

// Dataset is the demo data. Every slice is in creation order: the seeder writes it in that
// order, so that parents exist before their children.
type Dataset struct {
	RootName   string // the fake GitLab's root group; the seeder writes under an existing group
	Groups     []Group
	Projects   []Project
	Labels     []Label
	Cadence    string
	Iterations []Iteration
	People     []Person
	Epics      []Epic
	Issues     []Issue
	Links      []Link
}

// Group is a group below the root, at any depth: its parent comes first in Dataset.Groups.
// GitLab group names allow letters, digits, emoji, "_", ".", "(", ")", "-" and spaces: no "&".
type Group struct {
	Slug string // path under the root ("api", or "api/partenaires" for a nested group)
	Name string
}

// Project lives in a group.
type Project struct {
	Group string // Group.Slug
	Slug  string
	Name  string
}

// Path is the project's path under the root ("identite/sso").
func (p Project) Path() string { return p.Group + "/" + p.Slug }

type Label struct {
	Title string
	Color string // "#rrggbb"
}

// Iteration of the cadence; dates are inclusive.
type Iteration struct {
	Title     string
	Sequence  int
	StartDate string
	DueDate   string
}

// Person is an assignee. Usernames start with "demo-" so that they never match a real account.
type Person struct {
	Key      string // initials, as the items refer to it
	Name     string
	Username string
}

// Epic lives in a group. Key is its reference in the mockup ("&18"); titles are unique.
type Epic struct {
	Key   string
	Group string // Group.Slug
	Title string
	// First and Last are the indexes of the iterations it spans, -1 when it has no dates. A
	// GitLab whose iterations differ (automatic cadence) dates it from its own iterations.
	First, Last int
	StartDate   string // Iterations[First].StartDate, "" when unset
	DueDate     string
	Labels      []string
}

// Issue lives in a project, in an iteration of the cadence or none.
type Issue struct {
	Key       string // "#110"
	Project   string // Project.Path()
	Title     string
	Iteration int    // index in Iterations, -1 for none
	Parent    string // epic key, "" for none
	Closed    bool
	Assignee  string // Person.Key, "" for none
	Labels    []string
}

// Link kinds.
const (
	Blocks  = "blocks"
	Relates = "relates"
)

// Link between two items, by key. GitLab stores one link and lists it on both sides; the fake
// GitLab may list it on one side only (FromSide, ToSide) to exercise the backend's
// normalization. The seeder creates each link once.
type Link struct {
	Kind     string
	From, To string
	FromSide bool // listed by From (Blocks, or Related for Relates)
	ToSide   bool // listed by To (BlockedBy, or Related)
}

// New builds the demo data around now: ten two-week iterations, "Itération 15" starting on the
// Monday on or before now, with a one-week holiday gap between Itération 17 and 18. On top of
// the mockup it holds an epic dated by its children (&24), an epic with neither dates nor
// children (&25) and an open issue that blocks an epic without an iteration (#132).
func New(now time.Time) *Dataset {
	y, m, d := now.Date()
	today := time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
	monday := today.AddDate(0, 0, -((int(today.Weekday()) + 6) % 7))
	its := make([]Iteration, 0, 10)
	for i := range 10 {
		start := monday.AddDate(0, 0, (i-3)*14)
		if i >= 6 {
			start = start.AddDate(0, 0, 7)
		}
		n := 12 + i
		its = append(its, Iteration{
			Title:     fmt.Sprintf("Itération %d", n),
			Sequence:  n,
			StartDate: start.Format(DateLayout),
			DueDate:   start.AddDate(0, 0, 13).Format(DateLayout),
		})
	}

	ds := &Dataset{
		RootName: "Atlas",
		Groups: []Group{
			{"identite", "Identité et sécurité"},
			{"experience", "Expérience produit"},
			{"api", "API et intégrations"},
			{"data", "Data"},
			// Nested: lanes follow the group tree (ADR-32). Unchecked by default, so its
			// items show in the API et intégrations lane.
			{"api/partenaires", "Partenaires"},
		},
		Projects: []Project{
			{"identite", "sso", "SSO"},
			{"experience", "web", "Web"},
			{"experience", "mobile", "Mobile"},
			{"api", "webhooks", "Webhooks"},
			{"api", "export", "Export"},
			{"data", "pipeline", "Pipeline"},
		},
		Labels: []Label{
			{"frontend", "#428bca"}, {"backend", "#6699cc"}, {"API", "#009966"}, {"bug", "#dc143c"},
			{"sécurité", "#ed9121"}, {"UX", "#d10069"}, {"data", "#8fbc8f"}, {"mobile", "#5843ad"},
			{"priorité::haute", "#9e1c1c"},
		},
		Cadence:    "Sprints produit",
		Iterations: its,
		People: []Person{
			{"AL", "Amélie Laurent", "demo-alaurent"},
			{"MB", "Malik Benali", "demo-mbenali"},
			{"CD", "Chloé Dubois", "demo-cdubois"},
			{"TR", "Thomas Roux", "demo-troux"},
			{"SN", "Sofia Nguyen", "demo-snguyen"},
			{"JP", "Julien Petit", "demo-jpetit"},
		},
	}

	// epic spans iterations first..last (indexes, -1: no date).
	epic := func(key, group, title string, first, last int, labels ...string) {
		e := Epic{Key: key, Group: group, Title: title, First: first, Last: last, Labels: labels}
		if first >= 0 {
			e.StartDate = its[first].StartDate
		}
		if last >= 0 {
			e.DueDate = its[last].DueDate
		}
		ds.Epics = append(ds.Epics, e)
	}
	issue := func(key, project, title string, it int, parent string, closed bool, who string, labels ...string) {
		ds.Issues = append(ds.Issues, Issue{
			Key: key, Project: project, Title: title, Iteration: it, Parent: parent,
			Closed: closed, Assignee: who, Labels: labels,
		})
	}

	epic("&12", "identite", "Authentification SSO", 2, 4, "sécurité", "backend")
	epic("&13", "identite", "Gestion fine des droits", 5, 7, "sécurité", "backend")
	epic("&16", "identite", "Journal d'audit", 7, 9, "sécurité")
	epic("&15", "experience", "Refonte du tableau de bord", 3, 5, "frontend", "UX")
	epic("&17", "experience", "Mode hors ligne mobile", 6, 8, "mobile", "frontend")
	epic("&19", "api", "Webhooks sortants", 0, 3, "API", "backend")
	epic("&18", "api", "API d'export des données", 4, 6, "API", "backend")
	epic("&22", "api/partenaires", "Portail développeur", 7, 9, "API", "UX")
	epic("&21", "data", "Pipeline analytique", 5, 7, "data", "backend")
	epic("&23", "data", "Modèles prédictifs", 8, 9, "data")
	// Extra cases: dates inherited from children, and no date nor child at all.
	epic("&24", "experience", "Notifications push", -1, -1, "mobile")
	epic("&25", "experience", "Accessibilité RGAA", -1, -1, "UX", "frontend")

	const open, closed = false, true
	sso, webhooks, export := "identite/sso", "api/webhooks", "api/export"
	web, mobile, pipeline := "experience/web", "experience/mobile", "data/pipeline"
	// Issues that block an epic (shown).
	issue("#104", sso, "Corriger la déconnexion intempestive", 3, "&12", open, "TR", "bug", "priorité::haute", "backend")
	issue("#114", sso, "Audit de sécurité du SSO", 4, "&12", open, "TR", "sécurité")
	issue("#140", webhooks, "Contrat d’interface des webhooks", 1, "&19", closed, "SN", "API")
	issue("#107", export, "API d'agrégation des métriques", 4, "&18", open, "SN", "backend", "API")
	issue("#110", export, "Endpoint d’export CSV / JSON", 5, "&18", open, "SN", "backend", "API")
	issue("#113", web, "Lenteur au chargement du tableau", 5, "&15", open, "MB", "bug", "priorité::haute", "frontend")
	issue("#125", mobile, "Quota de stockage local", 6, "&17", open, "CD", "mobile", "backend")
	issue("#131", pipeline, "Montée de version Kafka", 2, "&21", closed, "JP", "data", "backend")
	issue("#130", pipeline, "Schéma d'événements v2", 6, "&21", open, "JP", "data")
	issue("#132", pipeline, "Purge des données personnelles", -1, "&23", open, "AL", "data", "sécurité")
	// Issues that block no epic (ignored by the board, but they still date their parent epic).
	issue("#101", sso, "Configurer le fournisseur SAML", 2, "&12", closed, "AL", "backend", "sécurité")
	issue("#103", sso, "Gestion des sessions et refresh token", 3, "&12", open, "AL", "backend", "sécurité")
	issue("#106", web, "Widgets configurables", 4, "&15", open, "MB", "frontend")
	issue("#108", web, "Persistance des préférences utilisateur", 5, "&15", open, "AL", "backend")
	issue("#109", export, "Spécification OpenAPI de l'export", 4, "&18", open, "SN", "API")
	issue("#112", export, "Documentation développeur de l'export", 6, "&18", open, "CD", "API")
	issue("#120", pipeline, "Ingestion des événements produit", 5, "&21", open, "JP", "data", "backend")
	issue("#126", mobile, "Service d'envoi des notifications", 7, "&24", open, "CD", "mobile", "backend")
	issue("#127", mobile, "Préférences de notification", 8, "&24", open, "MB", "mobile")

	blocks := func(a, b string, fromSide, toSide bool) {
		ds.Links = append(ds.Links, Link{Kind: Blocks, From: a, To: b, FromSide: fromSide, ToSide: toSide})
	}
	relates := func(a, b string, both bool) {
		ds.Links = append(ds.Links, Link{Kind: Relates, From: a, To: b, FromSide: true, ToSide: both})
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
	return ds
}

// Person returns the person with key; ok is false when there is none.
func (d *Dataset) Person(key string) (Person, bool) {
	for _, p := range d.People {
		if p.Key == key {
			return p, true
		}
	}
	return Person{}, false
}

// Label returns the label titled title; ok is false when there is none.
func (d *Dataset) Label(title string) (Label, bool) {
	for _, l := range d.Labels {
		if l.Title == title {
			return l, true
		}
	}
	return Label{}, false
}

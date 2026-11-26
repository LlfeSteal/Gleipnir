package board

import (
	"fmt"
	"strconv"
	"time"
)

// demoURL is a reserved domain (RFC 2606): a link never leads to a real site.
const demoURL = "https://gitlab.example.com"

// DemoRaw returns the mockup's sample dataset, as a test fixture: the demo itself is served by
// the fake GitLab (gitlab-mock/dataset.go), which holds the same data in GraphQL form.
// Iterations are placed around now so that "Itération 15" is always the current one. On top of the mockup it holds an epic dated by
// its children (&24), an epic with neither dates nor children (&25) and an open issue that
// blocks an epic without an iteration (#132). Some links are listed on both sides, as GitLab
// does, to exercise the normalization.
func DemoRaw(now time.Time) *Raw {
	const (
		identite = "plateforme/atlas/identite"
		xp       = "plateforme/atlas/experience"
		api      = "plateforme/atlas/api"
		data     = "plateforme/atlas/data"
	)

	// Ten two-week iterations, Itération 15 starting on the Monday on or before now, with a
	// one-week holiday gap between Itération 17 and 18 (as in the mockup).
	y, m, d := now.Date()
	today := time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
	monday := today.AddDate(0, 0, -((int(today.Weekday()) + 6) % 7))
	its := make([]RawIteration, 0, 10)
	for i := 0; i < 10; i++ {
		start := monday.AddDate(0, 0, (i-3)*14)
		if i >= 6 {
			start = start.AddDate(0, 0, 7)
		}
		n := 12 + i
		its = append(its, RawIteration{
			ID:        fmt.Sprintf("gid://gitlab/Iteration/%d", 300+n),
			CadenceID: "gid://gitlab/Iterations::Cadence/1",
			Title:     fmt.Sprintf("Itération %d", n),
			Sequence:  n,
			StartDate: start.Format(dateLayout),
			DueDate:   start.AddDate(0, 0, 13).Format(dateLayout),
			WebURL:    fmt.Sprintf("%s/groups/plateforme/atlas/-/cadences/1/iterations/%d", demoURL, 300+n),
		})
	}

	labels := map[string]Label{}
	for _, l := range []Label{
		{"frontend", "#428bca"}, {"backend", "#6699cc"}, {"API", "#009966"}, {"bug", "#dc143c"},
		{"sécurité", "#ed9121"}, {"UX", "#d10069"}, {"data", "#8fbc8f"}, {"mobile", "#5843ad"},
		{"priorité::haute", "#9e1c1c"},
	} {
		labels[l.Title] = l
	}
	people := map[string]*Person{
		"AL": {Name: "Amélie Laurent", Username: "alaurent"},
		"MB": {Name: "Malik Benali", Username: "mbenali"},
		"CD": {Name: "Chloé Dubois", Username: "cdubois"},
		"TR": {Name: "Thomas Roux", Username: "troux"},
		"SN": {Name: "Sofia Nguyen", Username: "snguyen"},
		"JP": {Name: "Julien Petit", Username: "jpetit"},
	}
	epicID := func(iid int) string { return fmt.Sprintf("gid://gitlab/WorkItem/%d", 500+iid) }
	issueID := func(iid int) string { return fmt.Sprintf("gid://gitlab/WorkItem/%d", 1000+iid) }
	labelList := func(titles ...string) []Label {
		ls := make([]Label, 0, len(titles))
		for _, t := range titles {
			ls = append(ls, labels[t])
		}
		return ls
	}

	var items []RawItem
	index := map[string]int{}
	// epic adds an epic spanning iterations first..last (mockup indexes, -1: no date).
	epic := func(iid int, group, title string, first, last int, lbls ...string) {
		e := RawItem{
			ID: epicID(iid), IID: fmt.Sprint(iid), Kind: KindEpic, Title: title, State: StateOpen,
			NamespacePath: group,
			WebURL:        fmt.Sprintf("%s/groups/%s/-/epics/%d", demoURL, group, iid),
			Labels:        labelList(lbls...),
		}
		if first >= 0 {
			e.StartDate = its[first].StartDate
		}
		if last >= 0 {
			e.DueDate = its[last].DueDate
		}
		index[e.ID] = len(items)
		items = append(items, e)
	}
	// issue adds an issue of project in iteration it (-1: none), child of epic parent.
	issue := func(iid int, project, title string, it, parent int, state, who string, lbls ...string) {
		is := RawItem{
			ID: issueID(iid), IID: fmt.Sprint(iid), Kind: KindIssue, Title: title, State: state,
			NamespacePath: project,
			WebURL:        fmt.Sprintf("%s/%s/-/issues/%d", demoURL, project, iid),
			Labels:        labelList(lbls...),
			Assignee:      people[who],
		}
		if it >= 0 {
			is.IterationID = its[it].ID
		}
		if parent > 0 {
			is.ParentID = epicID(parent)
		}
		index[is.ID] = len(items)
		items = append(items, is)
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

	sso, webhooks, export := identite+"/sso", api+"/webhooks", api+"/export"
	web, mobile, pipeline := xp+"/web", xp+"/mobile", data+"/pipeline"
	// Issues that block an epic.
	issue(104, sso, "Corriger la déconnexion intempestive", 3, 12, StateOpen, "TR", "bug", "priorité::haute", "backend")
	issue(114, sso, "Audit de sécurité du SSO", 4, 12, StateOpen, "TR", "sécurité")
	issue(140, webhooks, "Contrat d’interface des webhooks", 1, 19, StateClosed, "SN", "API")
	issue(107, export, "API d'agrégation des métriques", 4, 18, StateOpen, "SN", "backend", "API")
	issue(110, export, "Endpoint d’export CSV / JSON", 5, 18, StateOpen, "SN", "backend", "API")
	issue(113, web, "Lenteur au chargement du tableau", 5, 15, StateOpen, "MB", "bug", "priorité::haute", "frontend")
	issue(125, mobile, "Quota de stockage local", 6, 17, StateOpen, "CD", "mobile", "backend")
	issue(131, pipeline, "Montée de version Kafka", 2, 21, StateClosed, "JP", "data", "backend")
	issue(130, pipeline, "Schéma d'événements v2", 6, 21, StateOpen, "JP", "data")
	issue(132, pipeline, "Purge des données personnelles", -1, 23, StateOpen, "AL", "data", "sécurité")
	// Issues that block no epic: shown in a lane set to « Toutes », and they date their parent epic.
	issue(101, sso, "Configurer le fournisseur SAML", 2, 12, StateClosed, "AL", "backend", "sécurité")
	issue(103, sso, "Gestion des sessions et refresh token", 3, 12, StateOpen, "AL", "backend", "sécurité")
	issue(106, web, "Widgets configurables", 4, 15, StateOpen, "MB", "frontend")
	issue(108, web, "Persistance des préférences utilisateur", 5, 15, StateOpen, "AL", "backend")
	issue(109, export, "Spécification OpenAPI de l'export", 4, 18, StateOpen, "SN", "API")
	issue(112, export, "Documentation développeur de l'export", 6, 18, StateOpen, "CD", "API")
	issue(120, pipeline, "Ingestion des événements produit", 5, 21, StateOpen, "JP", "data", "backend")
	issue(126, mobile, "Service d'envoi des notifications", 7, 24, StateOpen, "CD", "mobile", "backend")
	issue(127, mobile, "Préférences de notification", 8, 24, StateOpen, "MB", "mobile")

	ref := func(r string) string {
		n, _ := strconv.Atoi(r[1:])
		if r[0] == '&' {
			return epicID(n)
		}
		return issueID(n)
	}
	// blocks records "a blocks b" on the blocker's side (Blocks), the blocked side
	// (BlockedBy) or both, as GitLab does.
	blocks := func(a, b string, blockerSide, blockedSide bool) {
		ia, ib := index[ref(a)], index[ref(b)]
		if blockerSide {
			items[ia].Blocks = append(items[ia].Blocks, ref(b))
		}
		if blockedSide {
			items[ib].BlockedBy = append(items[ib].BlockedBy, ref(a))
		}
	}
	relates := func(a, b string, both bool) {
		ia, ib := index[ref(a)], index[ref(b)]
		items[ia].Related = append(items[ia].Related, ref(b))
		if both {
			items[ib].Related = append(items[ib].Related, ref(a))
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
	// Issue → epic.
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
	// Issue ↔ issue, between issues that block an epic or not.
	relates("#107", "#110", true)
	relates("#103", "#104", true)
	blocks("#109", "#110", true, true)
	// A link to an item outside the synced data, dropped.
	items[index[ref("&22")]].Related = append(items[index[ref("&22")]].Related, "gid://gitlab/WorkItem/9999")

	return &Raw{
		GitLabURL: demoURL,
		RootGroup: Group{ID: "gid://gitlab/Group/100", Path: "plateforme/atlas", Name: "Atlas"},
		Groups: []Group{
			{ID: "gid://gitlab/Group/101", Path: identite, Name: "Identité & sécurité"},
			{ID: "gid://gitlab/Group/102", Path: xp, Name: "Expérience produit"},
			{ID: "gid://gitlab/Group/103", Path: api, Name: "API & intégrations"},
			{ID: "gid://gitlab/Group/104", Path: data, Name: "Data"},
		},
		Cadences:   []RawCadence{{ID: "gid://gitlab/Iterations::Cadence/1", Title: "Sprints produit", Active: true}},
		Iterations: its,
		Items:      items,
	}
}

package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"

	"gitlab-mock/dataset"
)

// seeder writes the demo dataset under an existing group. Every step finds what a previous run
// created (by path or title) and only creates what is missing or fixes what drifted: dates
// move with today, so that the current iteration stays the dataset's. It never deletes.
type seeder struct {
	c     *client
	apply bool // false: dry-run, reads only
	auto  bool // automatic cadences: GitLab generates the iterations
	root  string
	ds    *dataset.Dataset
	out   io.Writer

	created, updated int

	admin    bool
	rootID   int
	groupIDs map[string]int    // Group.Slug → REST id
	types    map[string]string // work item type name → GID
	labelIDs map[string]string // title → GID
	userIDs  map[string]string // Person.Key → GID
	cadences []*cadence        // the root group's, then the team's (ADR-38)
	items    map[string]string // dataset key → work item GID
	existing map[string]*workItem
	linked   map[string]map[string]bool // work item GID → linked GIDs
}

type iteration struct {
	ID, StartDate, DueDate string
}

// cadence is a cadence of the dataset, as the seeder writes it.
type cadence struct {
	title string
	group string // full path of the group holding it
	want  []dataset.Iteration
	id    string      // GID; dryRunID when it is still to be created
	auto  bool        // automatic: GitLab generates its iterations
	iters []iteration // per index of want; ID "" when missing
}

// workItem is a work item already in GitLab, as the seeder compares it.
type workItem struct {
	ID, State, StartDate, DueDate, Iteration, Parent string
	Labels, Assignees                                map[string]bool
}

const dryRunID = "dry-run"

// change reports a write and tells whether to make it (false in dry-run).
func (s *seeder) change(create bool, format string, args ...any) bool {
	if create {
		s.created++
	} else {
		s.updated++
	}
	prefix := ""
	if !s.apply {
		prefix = "[dry-run] "
	}
	fmt.Fprintf(s.out, prefix+format+"\n", args...)
	return s.apply
}

func (s *seeder) run(ctx context.Context) error {
	s.groupIDs, s.types, s.labelIDs, s.userIDs = map[string]int{}, map[string]string{}, map[string]string{}, map[string]string{}
	s.items, s.existing, s.linked = map[string]string{}, map[string]*workItem{}, map[string]map[string]bool{}
	for _, step := range []func(context.Context) error{
		s.checkTarget, s.seedGroups, s.seedProjects, s.seedLabels, s.seedUsers,
		s.seedCadences, s.readWorkItems, s.seedEpics, s.seedIssues, s.seedLinks,
	} {
		if err := step(ctx); err != nil {
			return err
		}
	}
	mode := "done"
	if !s.apply {
		mode = "dry-run done, nothing written (rerun with -apply)"
	}
	fmt.Fprintf(s.out, "%s: %d to create, %d to update\n", mode, s.created, s.updated)
	return nil
}

// checkTarget reads who the token is, the root group and the work item types.
func (s *seeder) checkTarget(ctx context.Context) error {
	var me struct {
		Username string `json:"username"`
		IsAdmin  bool   `json:"is_admin"`
	}
	if err := s.c.rest(ctx, http.MethodGet, "/user", nil, &me); err != nil {
		return fmt.Errorf("reading the token's user: %w", err)
	}
	s.admin = me.IsAdmin
	var root struct {
		ID int `json:"id"`
	}
	if err := s.c.rest(ctx, http.MethodGet, "/groups/"+url.PathEscape(s.root), nil, &root); err != nil {
		if err == errNotFound {
			return fmt.Errorf("SEED_GROUP %q not found or not visible to the token: create it first", s.root)
		}
		return err
	}
	s.rootID = root.ID
	var data struct {
		Namespace *struct {
			WorkItemTypes struct {
				Nodes []struct{ ID, Name string }
			} `json:"workItemTypes"`
		} `json:"namespace"`
	}
	if err := s.c.graphql(ctx, workItemTypesQuery, map[string]any{"fullPath": s.root}, &data); err != nil {
		return err
	}
	if data.Namespace != nil {
		for _, t := range data.Namespace.WorkItemTypes.Nodes {
			s.types[t.Name] = t.ID
		}
	}
	if s.types["Epic"] == "" || s.types["Issue"] == "" {
		return fmt.Errorf("the Epic and Issue work item types are not available in %s: the instance needs GitLab Premium or Ultimate", s.root)
	}
	admin := ""
	if me.IsAdmin {
		admin = ", admin"
	}
	fmt.Fprintf(s.out, "target: %s, group %s, as %s%s\n", s.c.base, s.root, me.Username, admin)
	return nil
}

func (s *seeder) seedGroups(ctx context.Context) error {
	for _, g := range s.ds.Groups {
		path := s.root + "/" + g.Slug
		var got struct {
			ID   int    `json:"id"`
			Name string `json:"name"`
		}
		err := s.c.rest(ctx, http.MethodGet, "/groups/"+url.PathEscape(path), nil, &got)
		switch {
		case err == errNotFound:
			if s.change(true, "create group %s (%s)", path, g.Name) {
				// A nested group goes under its parent, created just before it.
				parentID, slug := s.rootID, g.Slug
				if i := strings.LastIndex(g.Slug, "/"); i >= 0 {
					parentID, slug = s.groupIDs[g.Slug[:i]], g.Slug[i+1:]
				}
				body := map[string]any{"name": g.Name, "path": slug, "parent_id": parentID}
				if err := s.c.rest(ctx, http.MethodPost, "/groups", body, &got); err != nil {
					return fmt.Errorf("creating group %s: %w", path, err)
				}
			}
		case err != nil:
			return err
		case got.Name != g.Name:
			if s.change(false, "rename group %s to %q", path, g.Name) {
				if err := s.c.rest(ctx, http.MethodPut, "/groups/"+strconv.Itoa(got.ID), map[string]any{"name": g.Name}, nil); err != nil {
					return fmt.Errorf("renaming group %s: %w", path, err)
				}
			}
		}
		s.groupIDs[g.Slug] = got.ID
	}
	return nil
}

func (s *seeder) seedProjects(ctx context.Context) error {
	for _, p := range s.ds.Projects {
		path := s.root + "/" + p.Path()
		err := s.c.rest(ctx, http.MethodGet, "/projects/"+url.PathEscape(path), nil, nil)
		switch {
		case err == errNotFound:
			if s.change(true, "create project %s", path) {
				body := map[string]any{"name": p.Name, "path": p.Slug, "namespace_id": s.groupIDs[p.Group]}
				if err := s.c.rest(ctx, http.MethodPost, "/projects", body, nil); err != nil {
					return fmt.Errorf("creating project %s: %w", path, err)
				}
			}
		case err != nil:
			return err
		}
	}
	return nil
}

func (s *seeder) seedLabels(ctx context.Context) error {
	type label struct{ ID, Title, Color string }
	have := map[string]label{}
	err := s.paginate(ctx, labelsQuery, nil, func(raw map[string]any) pageInfo {
		var conn struct {
			PageInfo pageInfo `json:"pageInfo"`
			Nodes    []label  `json:"nodes"`
		}
		decode(raw["labels"], &conn)
		for _, l := range conn.Nodes {
			have[l.Title] = l
		}
		return conn.PageInfo
	})
	if err != nil {
		return err
	}
	for _, l := range s.ds.Labels {
		got, ok := have[l.Title]
		switch {
		case !ok:
			got.ID = dryRunID
			if s.change(true, "create label %q", l.Title) {
				var data struct {
					LabelCreate struct {
						Label  struct{ ID string }
						Errors []string
					} `json:"labelCreate"`
				}
				input := map[string]any{"groupPath": s.root, "title": l.Title, "color": l.Color}
				if err := s.c.graphql(ctx, labelCreateMutation, map[string]any{"input": input}, &data); err != nil {
					return err
				}
				if err := payloadErrors("creating label "+l.Title, data.LabelCreate.Errors); err != nil {
					return err
				}
				got.ID = data.LabelCreate.Label.ID
			}
		case !strings.EqualFold(got.Color, l.Color):
			if s.change(false, "recolor label %q to %s", l.Title, l.Color) {
				path := fmt.Sprintf("/groups/%d/labels/%s", s.rootID, lastSegment(got.ID))
				if err := s.c.rest(ctx, http.MethodPut, path, map[string]any{"new_color": l.Color}, nil); err != nil {
					return fmt.Errorf("recoloring label %s: %w", l.Title, err)
				}
			}
		}
		s.labelIDs[l.Title] = got.ID
	}
	return nil
}

// seedUsers finds the demo people, creates the missing ones when the token is admin, and makes
// them Reporters of the root group so that they can be assigned. Without admin rights, the
// items of a missing person stay unassigned.
func (s *seeder) seedUsers(ctx context.Context) error {
	for _, p := range s.ds.People {
		var found []struct {
			ID int `json:"id"`
		}
		if err := s.c.rest(ctx, http.MethodGet, "/users?username="+url.QueryEscape(p.Username), nil, &found); err != nil {
			return err
		}
		id := 0
		switch {
		case len(found) > 0:
			id = found[0].ID
		case !s.admin:
			fmt.Fprintf(s.out, "warning: user %s does not exist and the token is not admin: %s's items stay unassigned\n", p.Username, p.Name)
			continue
		default:
			s.userIDs[p.Key] = dryRunID
			if !s.change(true, "create user %s (%s)", p.Username, p.Name) {
				continue
			}
			var user struct {
				ID int `json:"id"`
			}
			body := map[string]any{
				"username": p.Username, "name": p.Name, "email": p.Username + "@gitlab.example.com",
				"password": randomPassword(), "skip_confirmation": true,
			}
			if err := s.c.rest(ctx, http.MethodPost, "/users", body, &user); err != nil {
				return fmt.Errorf("creating user %s: %w", p.Username, err)
			}
			id = user.ID
		}
		s.userIDs[p.Key] = fmt.Sprintf("gid://gitlab/User/%d", id)
		err := s.c.rest(ctx, http.MethodGet, fmt.Sprintf("/groups/%d/members/%d", s.rootID, id), nil, nil)
		if err == errNotFound {
			if s.change(true, "add %s to %s as Reporter", p.Username, s.root) {
				body := map[string]any{"user_id": id, "access_level": 20}
				err = s.c.rest(ctx, http.MethodPost, fmt.Sprintf("/groups/%d/members", s.rootID), body, nil)
				if err == errConflict {
					err = nil
				}
			} else {
				err = nil
			}
		}
		if err != nil {
			return fmt.Errorf("membership of %s: %w", p.Username, err)
		}
	}
	return nil
}

// seedCadences creates the root group's cadence and the team's, in its subgroup (ADR-38), then
// their iterations.
func (s *seeder) seedCadences(ctx context.Context) error {
	s.cadences = []*cadence{
		{title: s.ds.Cadence, group: s.root, want: s.ds.Iterations, auto: s.auto},
		{title: s.ds.Team.Title, group: dataset.Under(s.root, s.ds.Team.Group), want: s.ds.TeamIterations(), auto: s.auto},
	}
	for _, c := range s.cadences {
		if err := s.seedCadence(ctx, c); err != nil {
			return err
		}
		if err := s.seedIterations(ctx, c); err != nil {
			return err
		}
	}
	return nil
}

func (s *seeder) seedCadence(ctx context.Context, cad *cadence) error {
	var data struct {
		Group *struct {
			IterationCadences struct {
				Nodes []struct {
					ID, Title string
					Automatic bool
				}
			} `json:"iterationCadences"`
		} `json:"group"`
	}
	if err := s.c.graphql(ctx, cadencesQuery, map[string]any{"fullPath": cad.group, "title": cad.title}, &data); err != nil {
		return err
	}
	if data.Group != nil {
		for _, c := range data.Group.IterationCadences.Nodes {
			if strings.TrimSpace(c.Title) == cad.title {
				if c.Automatic != cad.auto {
					fmt.Fprintf(s.out, "note: cadence %q exists with automatic=%v: kept as is\n", c.Title, c.Automatic)
				}
				cad.id, cad.auto = c.ID, c.Automatic
				return nil
			}
		}
	}
	cad.id = dryRunID
	kind := "manual"
	input := map[string]any{"groupPath": cad.group, "title": cad.title, "active": true, "automatic": cad.auto}
	if cad.auto {
		kind = "automatic"
		input["startDate"] = cad.want[0].StartDate
		input["durationInWeeks"] = 2
		input["iterationsInAdvance"] = len(cad.want)
	}
	if !s.change(true, "create %s cadence %q in %s", kind, cad.title, cad.group) {
		return nil
	}
	var created struct {
		IterationCadenceCreate struct {
			IterationCadence struct{ ID string } `json:"iterationCadence"`
			Errors           []string
		} `json:"iterationCadenceCreate"`
	}
	if err := s.c.graphql(ctx, cadenceCreateMutation, map[string]any{"input": input}, &created); err != nil {
		return err
	}
	if err := payloadErrors("creating the cadence", created.IterationCadenceCreate.Errors); err != nil {
		return err
	}
	cad.id = created.IterationCadenceCreate.IterationCadence.ID
	return nil
}

// seedIterations creates a cadence's iterations when it is manual and moves the existing ones
// to today's dates, in an order where they never overlap. With an automatic cadence, GitLab
// owns the iterations: the seeder only maps them, in date order.
func (s *seeder) seedIterations(ctx context.Context, cad *cadence) error {
	var have []struct{ ID, Title, StartDate, DueDate string }
	if cad.id != dryRunID {
		err := s.paginate(ctx, iterationsQuery, map[string]any{"fullPath": cad.group, "cadenceId": cad.id}, func(raw map[string]any) pageInfo {
			var conn struct {
				PageInfo pageInfo `json:"pageInfo"`
				Nodes    []struct{ ID, Title, StartDate, DueDate string }
			}
			decode(raw["iterations"], &conn)
			have = append(have, conn.Nodes...)
			return conn.PageInfo
		})
		if err != nil {
			return err
		}
	}
	cad.iters = make([]iteration, len(cad.want))

	if cad.auto {
		sort.SliceStable(have, func(i, j int) bool { return have[i].StartDate < have[j].StartDate })
		for i := range cad.iters {
			if i < len(have) {
				cad.iters[i] = iteration{have[i].ID, day(have[i].StartDate), day(have[i].DueDate)}
			}
		}
		if len(have) < len(cad.iters) {
			fmt.Fprintf(s.out, "note: the automatic cadence %q has %d of %d iterations yet: GitLab creates them in the background, rerun later\n", cad.title, len(have), len(cad.iters))
		}
		return nil
	}

	byTitle := map[string]int{}
	for i, h := range have {
		byTitle[h.Title] = i
	}
	type move struct {
		index      int
		id, before string
	}
	var forward, backward []move
	for i, want := range cad.want {
		h, ok := byTitle[want.Title]
		if !ok {
			continue
		}
		got := have[h]
		cad.iters[i] = iteration{got.ID, want.StartDate, want.DueDate}
		switch start := day(got.StartDate); {
		case want.StartDate > start:
			forward = append(forward, move{i, got.ID, start})
		case want.StartDate < start || want.DueDate != day(got.DueDate):
			backward = append(backward, move{i, got.ID, start})
		}
	}
	// Moving later, the last one first; moving earlier, the first one first.
	sort.Slice(forward, func(a, b int) bool { return forward[a].index > forward[b].index })
	for _, m := range append(forward, backward...) {
		want := cad.want[m.index]
		if !s.change(false, "move iteration %q to %s – %s", want.Title, want.StartDate, want.DueDate) {
			continue
		}
		input := map[string]any{"groupPath": cad.group, "id": m.id, "startDate": want.StartDate, "dueDate": want.DueDate}
		if err := s.mutate(ctx, iterationUpdateMutation, "updateIteration", input, nil); err != nil {
			return fmt.Errorf("moving iteration %s: %w", want.Title, err)
		}
	}
	for i, want := range cad.want {
		if cad.iters[i].ID != "" {
			continue
		}
		cad.iters[i] = iteration{dryRunID, want.StartDate, want.DueDate}
		if !s.change(true, "create iteration %q, %s – %s", want.Title, want.StartDate, want.DueDate) {
			continue
		}
		input := map[string]any{
			"groupPath": cad.group, "iterationsCadenceId": cad.id,
			"title": want.Title, "startDate": want.StartDate, "dueDate": want.DueDate,
		}
		var id string
		if err := s.mutate(ctx, iterationCreateMutation, "iterationCreate", input, &id); err != nil {
			return fmt.Errorf("creating iteration %s: %w", want.Title, err)
		}
		cad.iters[i].ID = id
	}
	return nil
}

// readWorkItems reads the epics and issues already under the root, with their links.
func (s *seeder) readWorkItems(ctx context.Context) error {
	return s.paginate(ctx, workItemsQuery, nil, func(raw map[string]any) pageInfo {
		var conn struct {
			PageInfo pageInfo `json:"pageInfo"`
			Nodes    []struct {
				ID, Title, State string
				Namespace        struct{ FullPath string } `json:"namespace"`
				Widgets          []struct {
					Typename           string `json:"__typename"`
					StartDate, DueDate *string
					Iteration, Parent  *struct{ ID string }
					Labels, Assignees  *struct{ Nodes []struct{ ID string } }
					LinkedItems        *struct {
						Nodes []struct{ WorkItem *struct{ ID string } }
					} `json:"linkedItems"`
				}
			}
		}
		decode(raw["workItems"], &conn)
		for _, n := range conn.Nodes {
			w := &workItem{ID: n.ID, State: n.State, Labels: map[string]bool{}, Assignees: map[string]bool{}}
			links := map[string]bool{}
			for _, wg := range n.Widgets {
				switch wg.Typename {
				case "WorkItemWidgetStartAndDueDate":
					w.StartDate, w.DueDate = day(deref(wg.StartDate)), day(deref(wg.DueDate))
				case "WorkItemWidgetIteration":
					if wg.Iteration != nil {
						w.Iteration = wg.Iteration.ID
					}
				case "WorkItemWidgetHierarchy":
					if wg.Parent != nil {
						w.Parent = wg.Parent.ID
					}
				case "WorkItemWidgetLabels":
					for _, l := range wg.Labels.Nodes {
						w.Labels[l.ID] = true
					}
				case "WorkItemWidgetAssignees":
					for _, a := range wg.Assignees.Nodes {
						w.Assignees[a.ID] = true
					}
				case "WorkItemWidgetLinkedItems":
					for _, l := range wg.LinkedItems.Nodes {
						if l.WorkItem != nil {
							links[l.WorkItem.ID] = true
						}
					}
				}
			}
			s.existing[n.Namespace.FullPath+"\x00"+n.Title] = w
			s.linked[n.ID] = links
		}
		return conn.PageInfo
	})
}

func (s *seeder) seedEpics(ctx context.Context) error {
	for _, e := range s.ds.Epics {
		ns := dataset.Under(s.root, e.Group)
		start, due := "", ""
		if its := s.cadences[0].iters; e.First >= 0 && its[e.First].StartDate != "" && its[e.Last].DueDate != "" {
			start, due = its[e.First].StartDate, its[e.Last].DueDate
		}
		labels := s.labels(e.Labels)
		dates := map[string]any{"isFixed": true, "startDate": optional(start), "dueDate": optional(due)}
		what := fmt.Sprintf("epic %s %q", e.Key, e.Title)

		got, ok := s.existing[ns+"\x00"+e.Title]
		if !ok {
			s.items[e.Key] = dryRunID
			if !s.change(true, "create %s in %s", what, ns) {
				continue
			}
			input := map[string]any{
				"namespacePath": ns, "title": e.Title, "workItemTypeId": s.types["Epic"],
				"labelsWidget": map[string]any{"labelIds": labels},
			}
			if start != "" {
				input["startAndDueDateWidget"] = dates
			}
			id, err := s.createWorkItem(ctx, what, input)
			if err != nil {
				return err
			}
			s.items[e.Key] = id
			continue
		}
		s.items[e.Key] = got.ID
		input, diffs := map[string]any{"id": got.ID}, []string{}
		if got.StartDate != start || got.DueDate != due {
			input["startAndDueDateWidget"] = dates
			diffs = append(diffs, fmt.Sprintf("dates %s – %s", orNone(start), orNone(due)))
		}
		s.diffCommon(got, labels, "OPEN", input, &diffs)
		if err := s.updateWorkItem(ctx, what, input, diffs); err != nil {
			return err
		}
	}
	return nil
}

func (s *seeder) seedIssues(ctx context.Context) error {
	for _, is := range s.ds.Issues {
		ns := s.root + "/" + is.Project
		iter, parent, assignee := "", s.items[is.Parent], s.userIDs[is.Assignee]
		switch {
		case is.Team:
			iter = s.cadences[1].iters[is.Iteration-s.ds.Team.First].ID
		case is.Iteration >= 0:
			iter = s.cadences[0].iters[is.Iteration].ID
		}
		state := "OPEN"
		if is.Closed {
			state = "CLOSED"
		}
		labels := s.labels(is.Labels)
		what := fmt.Sprintf("issue %s %q", is.Key, is.Title)

		got, ok := s.existing[ns+"\x00"+is.Title]
		if !ok {
			s.items[is.Key] = dryRunID
			if !s.change(true, "create %s in %s", what, ns) {
				continue
			}
			input := map[string]any{
				"namespacePath": ns, "title": is.Title, "workItemTypeId": s.types["Issue"],
				"labelsWidget": map[string]any{"labelIds": labels},
			}
			if iter != "" {
				input["iterationWidget"] = map[string]any{"iterationId": iter}
			}
			if parent != "" {
				input["hierarchyWidget"] = map[string]any{"parentId": parent}
			}
			if assignee != "" {
				input["assigneesWidget"] = map[string]any{"assigneeIds": []string{assignee}}
			}
			id, err := s.createWorkItem(ctx, what, input)
			if err != nil {
				return err
			}
			s.items[is.Key] = id
			if is.Closed {
				if err := s.mutate(ctx, workItemUpdateMutation, "workItemUpdate", map[string]any{"id": id, "stateEvent": "CLOSE"}, nil); err != nil {
					return fmt.Errorf("closing %s: %w", what, err)
				}
			}
			continue
		}
		s.items[is.Key] = got.ID
		input, diffs := map[string]any{"id": got.ID}, []string{}
		if got.Iteration != iter {
			input["iterationWidget"] = map[string]any{"iterationId": optional(iter)}
			diffs = append(diffs, "iteration")
		}
		if parent != "" && got.Parent != parent {
			input["hierarchyWidget"] = map[string]any{"parentId": parent}
			diffs = append(diffs, "parent "+is.Parent)
		}
		if assignee != "" && !got.Assignees[assignee] {
			input["assigneesWidget"] = map[string]any{"assigneeIds": []string{assignee}}
			diffs = append(diffs, "assignee")
		}
		s.diffCommon(got, labels, state, input, &diffs)
		if err := s.updateWorkItem(ctx, what, input, diffs); err != nil {
			return err
		}
	}
	return nil
}

// diffCommon adds the missing labels and the state change to an update.
func (s *seeder) diffCommon(got *workItem, labels []string, state string, input map[string]any, diffs *[]string) {
	var missing []string
	for _, l := range labels {
		if !got.Labels[l] {
			missing = append(missing, l)
		}
	}
	if len(missing) > 0 {
		input["labelsWidget"] = map[string]any{"addLabelIds": missing}
		*diffs = append(*diffs, "labels")
	}
	if got.State != state {
		event := "CLOSE"
		if state == "OPEN" {
			event = "REOPEN"
		}
		input["stateEvent"] = event
		*diffs = append(*diffs, strings.ToLower(event))
	}
}

func (s *seeder) createWorkItem(ctx context.Context, what string, input map[string]any) (string, error) {
	var id string
	if err := s.mutate(ctx, workItemCreateMutation, "workItemCreate", input, &id); err != nil {
		return "", fmt.Errorf("creating %s: %w", what, err)
	}
	return id, nil
}

func (s *seeder) updateWorkItem(ctx context.Context, what string, input map[string]any, diffs []string) error {
	if len(diffs) == 0 || !s.change(false, "update %s: %s", what, strings.Join(diffs, ", ")) {
		return nil
	}
	if err := s.mutate(ctx, workItemUpdateMutation, "workItemUpdate", input, nil); err != nil {
		return fmt.Errorf("updating %s: %w", what, err)
	}
	return nil
}

// seedLinks adds the links missing between the items; GitLab lists a link on both sides, so a
// pair linked either way counts.
func (s *seeder) seedLinks(ctx context.Context) error {
	for _, l := range s.ds.Links {
		from, to := s.items[l.From], s.items[l.To]
		if from != dryRunID && to != dryRunID && (s.linked[from][to] || s.linked[to][from]) {
			continue
		}
		kind := "RELATED"
		if l.Kind == dataset.Blocks {
			kind = "BLOCKS"
		}
		if !s.change(true, "link %s %s %s", l.From, strings.ToLower(kind), l.To) {
			continue
		}
		input := map[string]any{"id": from, "linkType": kind, "workItemsIds": []string{to}}
		if err := s.mutate(ctx, linkAddMutation, "workItemAddLinkedItems", input, nil); err != nil {
			return fmt.Errorf("linking %s to %s: %w", l.From, l.To, err)
		}
	}
	return nil
}

// mutate runs a mutation whose payload is field; id receives the GID of its object, if any.
func (s *seeder) mutate(ctx context.Context, mutation, field string, input map[string]any, id *string) error {
	var data map[string]struct {
		Errors    []string `json:"errors"`
		WorkItem  *struct{ ID string }
		Iteration *struct{ ID string }
	}
	if err := s.c.graphql(ctx, mutation, map[string]any{"input": input}, &data); err != nil {
		return err
	}
	payload := data[field]
	if err := payloadErrors(field, payload.Errors); err != nil {
		return err
	}
	if id != nil {
		switch {
		case payload.WorkItem != nil:
			*id = payload.WorkItem.ID
		case payload.Iteration != nil:
			*id = payload.Iteration.ID
		}
	}
	return nil
}

type pageInfo struct {
	HasNextPage bool   `json:"hasNextPage"`
	EndCursor   string `json:"endCursor"`
}

// paginate runs a query on the root group, or on vars["fullPath"] when given, page by page;
// collect reads the group's fields.
func (s *seeder) paginate(ctx context.Context, query string, vars map[string]any, collect func(map[string]any) pageInfo) error {
	variables := map[string]any{"fullPath": s.root}
	for k, v := range vars {
		variables[k] = v
	}
	var after *string
	for page := 0; page < 1000; page++ {
		variables["after"] = after
		var data struct {
			Group map[string]any `json:"group"`
		}
		if err := s.c.graphql(ctx, query, variables, &data); err != nil {
			return err
		}
		if data.Group == nil {
			return fmt.Errorf("%s: group %s not found", operation(query), variables["fullPath"])
		}
		info := collect(data.Group)
		if !info.HasNextPage || info.EndCursor == "" {
			return nil
		}
		next := info.EndCursor
		after = &next
	}
	return fmt.Errorf("%s: more than 1000 pages", operation(query))
}

// labels returns the GIDs of the labels titled titles.
func (s *seeder) labels(titles []string) []string {
	ids := make([]string, 0, len(titles))
	for _, t := range titles {
		ids = append(ids, s.labelIDs[t])
	}
	return ids
}

// decode converts a decoded JSON value into out.
func decode(v any, out any) {
	b, _ := json.Marshal(v)
	_ = json.Unmarshal(b, out)
}

// randomPassword satisfies GitLab's password rules; nobody logs in with it.
func randomPassword() string {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b) + "aA1!"
}

func lastSegment(gid string) string { return gid[strings.LastIndex(gid, "/")+1:] }

// day keeps the date part: dates typed Time may come back as timestamps.
func day(s string) string {
	if len(s) > 10 {
		return s[:10]
	}
	return s
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func optional(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func orNone(s string) string {
	if s == "" {
		return "none"
	}
	return s
}

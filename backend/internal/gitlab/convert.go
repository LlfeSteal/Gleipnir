package gitlab

import (
	"fmt"
	"strings"

	"gleipnir/internal/board"
)

// chooseCadence picks the board's cadence. configured (a title, case-insensitive, or an ID:
// the full GID or its number) must exist. Otherwise: the first cadence with an iteration
// running today (current lists their IDs), else the first active one, else the first.
func chooseCadence(cadences []cadenceNode, configured string, current []string) (cadenceNode, error) {
	if len(cadences) == 0 {
		return cadenceNode{}, ErrNoCadence
	}
	if configured != "" {
		for _, c := range cadences {
			// Titles may carry stray spaces in GitLab ("AI Engineering ").
			if strings.EqualFold(strings.TrimSpace(c.Title), configured) ||
				c.ID == configured || lastSegment(c.ID) == configured {
				return c, nil
			}
		}
		return cadenceNode{}, fmt.Errorf("%w: %q", ErrCadenceNotFound, configured)
	}
	running := make(map[string]bool, len(current))
	for _, id := range current {
		running[id] = true
	}
	for _, c := range cadences {
		if running[c.ID] {
			return c, nil
		}
	}
	for _, c := range cadences {
		if c.Active {
			return c, nil
		}
	}
	return cadences[0], nil
}

// lastSegment returns the number of a GID ("gid://gitlab/Iterations::Cadence/42" → "42").
func lastSegment(gid string) string {
	return gid[strings.LastIndex(gid, "/")+1:]
}

func convertIteration(n iterationNode) board.RawIteration {
	it := board.RawIteration{
		ID:        n.ID,
		Sequence:  n.Sequence,
		StartDate: day(n.StartDate),
		DueDate:   day(n.DueDate),
		WebURL:    n.WebURL,
	}
	if n.Title != nil {
		it.Title = *n.Title
	}
	return it
}

var kinds = map[string]string{"Epic": board.KindEpic, "Issue": board.KindIssue}

// convertItem maps a work item to a board item; ok is false for the types the board doesn't
// show (Task, Objective…).
func convertItem(n workItemNode) (item board.RawItem, ok bool) {
	kind, ok := kinds[n.WorkItemType.Name]
	if !ok {
		return board.RawItem{}, false
	}
	item = board.RawItem{
		ID:     n.ID,
		IID:    n.IID,
		Kind:   kind,
		Title:  n.Title,
		State:  strings.ToLower(n.State),
		WebURL: n.WebURL,
	}
	if n.Namespace != nil {
		item.NamespacePath = n.Namespace.FullPath
	}
	for _, w := range n.Widgets {
		switch w.Typename {
		case "WorkItemWidgetStartAndDueDate":
			item.StartDate = day(deref(w.StartDate))
			item.DueDate = day(deref(w.DueDate))
		case "WorkItemWidgetIteration":
			if w.Iteration != nil {
				item.IterationID = w.Iteration.ID
			}
		case "WorkItemWidgetHierarchy":
			if w.Parent != nil {
				item.ParentID = w.Parent.ID
			}
		case "WorkItemWidgetLabels":
			if w.Labels != nil {
				for _, l := range w.Labels.Nodes {
					item.Labels = append(item.Labels, board.Label{Title: l.Title, Color: l.Color})
				}
			}
		case "WorkItemWidgetAssignees":
			if w.Assignees != nil && len(w.Assignees.Nodes) > 0 {
				a := w.Assignees.Nodes[0]
				item.Assignee = &board.Person{Name: a.Name, Username: a.Username}
			}
		case "WorkItemWidgetLinkedItems":
			item.Blocks = linkedIDs(w.Blocks)
			item.BlockedBy = linkedIDs(w.BlockedBy)
			item.Related = linkedIDs(w.Related)
		}
	}
	return item, true
}

func linkedIDs(conn *linkedConn) []string {
	if conn == nil {
		return nil
	}
	var ids []string
	for _, n := range conn.Nodes {
		if n.WorkItem != nil && n.WorkItem.ID != "" {
			ids = append(ids, n.WorkItem.ID)
		}
	}
	return ids
}

// day keeps the date part: Iteration dates are typed Time, so an instance may send a
// timestamp ("2026-11-23T00:00:00Z") where gitlab.com sends "2026-11-23".
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

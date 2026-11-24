package main

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestDatasetShapes(t *testing.T) {
	d := newDataset(now)
	ids := map[string]bool{}
	for _, it := range d.items {
		if ids[it.ID] {
			t.Errorf("duplicate work item %s", it.ID)
		}
		ids[it.ID] = true
		if !strings.HasPrefix(it.ID, "gid://gitlab/WorkItem/") || it.IID == "" || it.Title == "" {
			t.Errorf("incomplete item %+v", it)
		}
		if it.State != "OPEN" && it.State != "CLOSED" {
			t.Errorf("%s: state %q", it.ID, it.State)
		}
		if !strings.HasPrefix(it.WebURL, webBase+"/") {
			t.Errorf("%s: webUrl %q must stay on the reserved domain", it.ID, it.WebURL)
		}
		// An epic lives in a group, an issue in a project (AGENTS.md, GraphQL pitfalls).
		switch it.WorkItemType.Name {
		case "Epic":
			if !strings.HasPrefix(it.Namespace.ID, "gid://gitlab/Group/") || !d.knows(it.Namespace.FullPath) {
				t.Errorf("epic %s: namespace %+v", it.ID, it.Namespace)
			}
		case "Issue":
			if !strings.HasPrefix(it.Namespace.ID, "gid://gitlab/Namespaces::ProjectNamespace/") || d.knows(it.Namespace.FullPath) {
				t.Errorf("issue %s: namespace %+v", it.ID, it.Namespace)
			}
		default:
			t.Errorf("%s: type %q", it.ID, it.WorkItemType.Name)
		}
		for _, w := range it.Widgets {
			if _, ok := w["__typename"].(string); !ok {
				t.Errorf("%s: widget without __typename: %v", it.ID, w)
			}
		}
	}
	if len(d.items) != 31 {
		t.Fatalf("got %d items, want 12 epics + 19 issues", len(d.items))
	}
}

// TestDatasetJSON checks the widgets serialize as the backend decodes them: null for an
// unset date, iteration or parent.
func TestDatasetJSON(t *testing.T) {
	d := newDataset(now)
	find := func(id string) string {
		for _, it := range d.items {
			if it.ID == id {
				b, _ := json.Marshal(it)
				return string(b)
			}
		}
		t.Fatalf("%s not found", id)
		return ""
	}
	cases := map[string]struct{ id, want string }{
		"epic without dates":   {"gid://gitlab/WorkItem/525", `"dueDate":null,"startDate":null`},
		"issue without sprint": {"gid://gitlab/WorkItem/1132", `"iteration":null`},
		"issue in a sprint":    {"gid://gitlab/WorkItem/1104", `"iteration":{"id":"gid://gitlab/Iteration/315"}`},
		"epic without parent":  {"gid://gitlab/WorkItem/512", `"parent":null`},
		"issue with parent":    {"gid://gitlab/WorkItem/1104", `"parent":{"id":"gid://gitlab/WorkItem/512"}`},
		"assignee":             {"gid://gitlab/WorkItem/1104", `"assignees":{"nodes":[{"name":"Thomas Roux","username":"troux"}]}`},
		"type name":            {"gid://gitlab/WorkItem/525", `"workItemType":{"name":"Epic"}`},
		"link out of group":    {"gid://gitlab/WorkItem/522", `"gid://gitlab/WorkItem/9999"`},
		"blocked by both":      {"gid://gitlab/WorkItem/513", `"blockedBy":{"nodes":[{"workItem":{"id":"gid://gitlab/WorkItem/512"}}`},
	}
	for name, c := range cases {
		if got := find(c.id); !strings.Contains(got, c.want) {
			t.Errorf("%s: %s lacks %s", name, got, c.want)
		}
	}
}

// Itération 15 holds today whatever the weekday, also on a Sunday (end of the week).
func TestCurrentIterationEveryDay(t *testing.T) {
	for day := 0; day < 14; day++ {
		today := time.Date(2026, 11, 16+day, 23, 0, 0, 0, time.UTC)
		d := newDataset(today)
		s := today.Format(dateLayout)
		it := d.iterations[3]
		if *it.Title != "Itération 15" || it.StartDate > s || s > it.DueDate {
			t.Errorf("%s: Itération 15 runs %s – %s", s, it.StartDate, it.DueDate)
		}
	}
}

func TestOptional(t *testing.T) {
	if optional("") != nil || optional("x") != "x" || optionalRef("") != nil || optionalRef("a") != (idRef{ID: "a"}) {
		t.Fatal("optional values")
	}
	if g, ok := newDataset(now).group("nope"); ok || g != (groupNode{}) {
		t.Fatal("unknown group")
	}
}

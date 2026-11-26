package gitlab

import (
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"gleipnir/internal/board"
)

func TestConfiguredCadence(t *testing.T) {
	cadences := []cadenceNode{
		{ID: "gid://gitlab/Iterations::Cadence/1", Title: "Old", Active: false},
		{ID: "gid://gitlab/Iterations::Cadence/2", Title: "Team A ", Active: true},
		{ID: "gid://gitlab/Iterations::Cadence/3", Title: "Team B", Active: true},
	}
	tests := []struct {
		name       string
		cadences   []cadenceNode
		configured string
		wantID     string
		wantErr    error
	}{
		{"by title, case-insensitive, trimmed", cadences, "team a", "gid://gitlab/Iterations::Cadence/2", nil},
		{"by full id", cadences, "gid://gitlab/Iterations::Cadence/3", "gid://gitlab/Iterations::Cadence/3", nil},
		{"by numeric id", cadences, "1", "gid://gitlab/Iterations::Cadence/1", nil},
		{"not found", cadences, "Team C", "", ErrCadenceNotFound},
		// The default active cadences are Build's business (ADR-38).
		{"unset", cadences, "", "", nil},
		{"none", nil, "", "", ErrNoCadence},
		{"none, configured", nil, "Team A", "", ErrNoCadence},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := configuredCadence(tt.cadences, tt.configured)
			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Fatalf("err = %v, want %v", err, tt.wantErr)
				}
				return
			}
			if err != nil || got != tt.wantID {
				t.Errorf("configuredCadence = %q, %v; want %s", got, err, tt.wantID)
			}
		})
	}
}

// A work item as gitlab.com returns it (shape captured from gitlab-org/ruby).
const issueJSON = `{
  "id": "gid://gitlab/WorkItem/110", "iid": "110", "title": "Fix login", "state": "CLOSED",
  "webUrl": "https://gitlab.com/root/a/app/-/work_items/110",
  "namespace": {"id": "gid://gitlab/Namespaces::ProjectNamespace/7", "fullPath": "root/a/app"},
  "workItemType": {"name": "Issue"},
  "widgets": [
    {"__typename": "WorkItemWidgetAssignees", "assignees": {"nodes": [
      {"name": "Ada Lovelace", "username": "ada"}, {"name": "Bob", "username": "bob"}]}},
    {"__typename": "WorkItemWidgetHierarchy", "parent": {"id": "gid://gitlab/WorkItem/18"}},
    {"__typename": "WorkItemWidgetIteration", "iteration": {"id": "gid://gitlab/Iteration/20"}},
    {"__typename": "WorkItemWidgetLabels", "labels": {"nodes": [
      {"title": "bug", "color": "#dc143c"}, {"title": "backend", "color": "#D10069"}]}},
    {"__typename": "WorkItemWidgetLinkedItems",
      "blocks": {"nodes": [{"workItem": {"id": "gid://gitlab/WorkItem/18"}}, {"workItem": null}]},
      "blockedBy": {"nodes": [{"workItem": {"id": "gid://gitlab/WorkItem/111"}}]},
      "related": {"nodes": [{"workItem": {"id": "gid://gitlab/WorkItem/112"}}]}},
    {"__typename": "WorkItemWidgetStartAndDueDate", "startDate": "2026-11-16", "dueDate": null}
  ]
}`

func decodeNode(t *testing.T, s string) workItemNode {
	t.Helper()
	var n workItemNode
	if err := json.Unmarshal([]byte(s), &n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestConvertIssue(t *testing.T) {
	got, ok := convertItem(decodeNode(t, issueJSON))
	if !ok {
		t.Fatal("issue skipped")
	}
	want := board.RawItem{
		ID: "gid://gitlab/WorkItem/110", IID: "110", Kind: board.KindIssue, Title: "Fix login",
		State: board.StateClosed, NamespacePath: "root/a/app", WebURL: "https://gitlab.com/root/a/app/-/work_items/110",
		StartDate: "2026-11-16", DueDate: "",
		IterationID: "gid://gitlab/Iteration/20", ParentID: "gid://gitlab/WorkItem/18",
		Labels:    []board.Label{{Title: "bug", Color: "#dc143c"}, {Title: "backend", Color: "#D10069"}},
		Assignee:  &board.Person{Name: "Ada Lovelace", Username: "ada"},
		Blocks:    []string{"gid://gitlab/WorkItem/18"},
		BlockedBy: []string{"gid://gitlab/WorkItem/111"},
		Related:   []string{"gid://gitlab/WorkItem/112"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("convertItem =\n%+v\nwant\n%+v", got, want)
	}
}

func TestConvertEpicAndSkippedTypes(t *testing.T) {
	epic, ok := convertItem(decodeNode(t, `{"id":"gid://gitlab/WorkItem/18","iid":"18","title":"Login","state":"OPEN",
		"webUrl":"https://gitlab.com/groups/root/a/-/work_items/18",
		"namespace":{"id":"gid://gitlab/Group/9","fullPath":"root/a"},"workItemType":{"name":"Epic"},
		"widgets":[{"__typename":"WorkItemWidgetAssignees","assignees":{"nodes":[]}},
		{"__typename":"WorkItemWidgetHierarchy","parent":null},
		{"__typename":"WorkItemWidgetStartAndDueDate","startDate":"2026-11-02","dueDate":"2026-12-13"}]}`))
	if !ok || epic.Kind != board.KindEpic || epic.State != board.StateOpen || epic.NamespacePath != "root/a" ||
		epic.StartDate != "2026-11-02" || epic.DueDate != "2026-12-13" || epic.Assignee != nil || epic.ParentID != "" ||
		epic.IterationID != "" || epic.Blocks != nil {
		t.Errorf("epic = %+v (ok %v)", epic, ok)
	}
	for _, typ := range []string{"Task", "Objective", "Key Result", "Incident"} {
		if _, ok := convertItem(decodeNode(t, `{"id":"x","workItemType":{"name":"`+typ+`"}}`)); ok {
			t.Errorf("%s not skipped", typ)
		}
	}
}

func TestConvertIteration(t *testing.T) {
	title := "Sprint 3"
	got := convertIteration(iterationNode{ID: "gid://gitlab/Iteration/3", Title: &title, Sequence: 3,
		StartDate: "2026-11-02T00:00:00Z", DueDate: "2026-11-15", WebURL: "w"})
	want := board.RawIteration{ID: "gid://gitlab/Iteration/3", Title: "Sprint 3", Sequence: 3,
		StartDate: "2026-11-02", DueDate: "2026-11-15", WebURL: "w"}
	if got != want {
		t.Errorf("convertIteration = %+v, want %+v", got, want)
	}
	if got := convertIteration(iterationNode{ID: "i"}); got.Title != "" {
		t.Errorf("null title = %q, want empty", got.Title)
	}
}

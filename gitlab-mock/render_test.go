package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestDatasetShapes(t *testing.T) {
	d := newDataset(now, layout{})
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
	if len(d.items) != 32 {
		t.Fatalf("got %d items, want 13 epics + 19 issues", len(d.items))
	}
}

// TestDatasetJSON checks the widgets serialize as the backend decodes them: null for an
// unset date, iteration or parent.
func TestDatasetJSON(t *testing.T) {
	d := newDataset(now, layout{})
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
		"assignee":             {"gid://gitlab/WorkItem/1104", `"assignees":{"nodes":[{"name":"Thomas Roux","username":"demo-troux"}]}`},
		"type name":            {"gid://gitlab/WorkItem/525", `"workItemType":{"name":"Epic"}`},
		"link out of group":    {"gid://gitlab/WorkItem/522", `"gid://gitlab/WorkItem/9999"`},
		"epic of the root":     {"gid://gitlab/WorkItem/526", `"namespace":{"id":"gid://gitlab/Group/40","fullPath":"plateforme/atlas"}`},
		"blocked by both":      {"gid://gitlab/WorkItem/513", `"blockedBy":{"nodes":[{"workItem":{"id":"gid://gitlab/WorkItem/512"}}`},
	}
	for name, c := range cases {
		if got := find(c.id); !strings.Contains(got, c.want) {
			t.Errorf("%s: %s lacks %s", name, got, c.want)
		}
	}
}

func TestOptional(t *testing.T) {
	if optional("") != nil || optional("x") != "x" || optionalRef("") != nil || optionalRef("a") != (idRef{ID: "a"}) {
		t.Fatal("optional values")
	}
	if g, ok := newDataset(now, layout{}).group("nope"); ok || g != (groupNode{}) {
		t.Fatal("unknown group")
	}
}

// The GitLab numbering restarts at 1 in each group and project, as a GitLab filled by the
// seeder numbers them, under the chosen root.
func TestGitLabLayout(t *testing.T) {
	d := newDataset(now, layout{root: "demo/gleipnir", rootName: "Gleipnir", gitlabIIDs: true})
	if d.root != (groupNode{ID: "gid://gitlab/Group/40", FullPath: "demo/gleipnir", Name: "Gleipnir"}) || !d.knows("demo/gleipnir/api") {
		t.Fatalf("root %+v", d.root)
	}
	iids := map[string][]string{}
	for _, it := range d.items {
		iids[it.Namespace.FullPath] = append(iids[it.Namespace.FullPath], it.IID)
		if !strings.HasSuffix(it.WebURL, "/-/work_items/"+it.IID) {
			t.Errorf("%s: webUrl %s", it.ID, it.WebURL)
		}
	}
	want := map[string]string{
		"demo/gleipnir/identite":      "1,2,3",
		"demo/gleipnir/experience":    "1,2,3,4",
		"demo/gleipnir/identite/sso":  "1,2,3,4",
		"demo/gleipnir/data/pipeline": "1,2,3,4",
	}
	for ns, w := range want {
		if got := strings.Join(iids[ns], ","); got != w {
			t.Errorf("%s: IIDs %s, want %s", ns, got, w)
		}
	}
	// The GIDs stay those of the mockup: only the references change.
	if mock := newDataset(now, layout{}); mock.items[0].ID != d.items[0].ID || mock.items[0].IID == d.items[0].IID {
		t.Fatalf("GID %s / %s, IID %s / %s", mock.items[0].ID, d.items[0].ID, mock.items[0].IID, d.items[0].IID)
	}
}

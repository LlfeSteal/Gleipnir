package dataset

import (
	"regexp"
	"strings"
	"testing"
	"time"
)

var now = time.Date(2026, 11, 25, 10, 0, 0, 0, time.UTC)

// GitLab's group and project name rule (Gitlab::Regex.group_name_regex): letters, digits,
// emoji, "_", ".", "(", ")", "-" and spaces, starting with a letter, digit, emoji or "_".
var gitlabName = regexp.MustCompile(`^[\p{L}\p{N}_][\p{L}\p{N}_.() \-]*$`)

// GitLab paths: letters, digits, "_", "-" and ".", not starting or ending with a special one.
var gitlabPath = regexp.MustCompile(`^[a-z0-9]([a-z0-9_.-]*[a-z0-9])?$`)

// TestStorableInGitLab checks every constraint a real GitLab puts on the data, so that the
// seeder can write exactly what the fake GitLab serves.
func TestStorableInGitLab(t *testing.T) {
	d := New(now)
	groups := map[string]bool{}
	for _, g := range d.Groups {
		// A nested group: each segment is a GitLab path, and its parent comes first.
		segments := strings.Split(g.Slug, "/")
		valid := gitlabName.MatchString(g.Name)
		for _, s := range segments {
			valid = valid && gitlabPath.MatchString(s)
		}
		if parent := strings.Join(segments[:len(segments)-1], "/"); parent != "" && !groups[parent] {
			valid = false
		}
		if !valid {
			t.Errorf("group %+v: GitLab refuses this name or path, or its parent comes later", g)
		}
		groups[g.Slug] = true
	}
	if !gitlabName.MatchString(d.RootName) {
		t.Errorf("root name %q", d.RootName)
	}
	projects := map[string]string{} // path → group
	for _, p := range d.Projects {
		if !gitlabName.MatchString(p.Name) || !gitlabPath.MatchString(p.Slug) || !groups[p.Group] {
			t.Errorf("project %+v", p)
		}
		projects[p.Path()] = p.Group
	}
	for _, p := range d.People {
		if !strings.HasPrefix(p.Username, "demo-") {
			t.Errorf("%s: usernames start with demo- so as never to match a real account", p.Username)
		}
	}
	labels := map[string]bool{}
	for _, l := range d.Labels {
		if !regexp.MustCompile(`^#[0-9a-f]{6}$`).MatchString(l.Color) {
			t.Errorf("label %+v: color", l)
		}
		labels[l.Title] = true
	}

	titles := map[string]bool{}
	keys := map[string]string{} // key → group of the epic, "" for an issue
	checkLabels := func(key string, ls []string) {
		for _, l := range ls {
			if !labels[l] {
				t.Errorf("%s: unknown label %q", key, l)
			}
		}
	}
	for _, e := range d.Epics {
		if titles[e.Title] || keys[e.Key] != "" || !strings.HasPrefix(e.Key, "&") || !groups[e.Group] {
			t.Errorf("epic %+v: duplicate title or key, or unknown group", e)
		}
		titles[e.Title], keys[e.Key] = true, e.Group
		if (e.First < 0) != (e.Last < 0) || e.First > e.Last || e.Last >= len(d.Iterations) {
			t.Errorf("epic %s: iterations %d – %d", e.Key, e.First, e.Last)
		}
		if e.First >= 0 && (e.StartDate != d.Iterations[e.First].StartDate || e.DueDate != d.Iterations[e.Last].DueDate) ||
			e.First < 0 && (e.StartDate != "" || e.DueDate != "") {
			t.Errorf("epic %s: dates %q – %q do not match its iterations", e.Key, e.StartDate, e.DueDate)
		}
		checkLabels(e.Key, e.Labels)
	}
	for _, is := range d.Issues {
		if titles[is.Title] || !strings.HasPrefix(is.Key, "#") {
			t.Errorf("issue %+v: duplicate title or bad key", is)
		}
		titles[is.Title] = true
		if _, dup := keys[is.Key]; dup {
			t.Errorf("duplicate key %s", is.Key)
		}
		keys[is.Key] = ""
		group, ok := projects[is.Project]
		if !ok {
			t.Errorf("issue %s: unknown project %q", is.Key, is.Project)
		}
		// GitLab only lets an epic of the project's group (or an ancestor) parent an issue.
		if is.Parent != "" && keys[is.Parent] != group {
			t.Errorf("issue %s: parent %s is not an epic of group %s", is.Key, is.Parent, group)
		}
		if is.Iteration < -1 || is.Iteration >= len(d.Iterations) {
			t.Errorf("issue %s: iteration %d", is.Key, is.Iteration)
		}
		if _, ok := d.Person(is.Assignee); is.Assignee != "" && !ok {
			t.Errorf("issue %s: unknown assignee %s", is.Key, is.Assignee)
		}
		checkLabels(is.Key, is.Labels)
	}

	pairs := map[string]bool{}
	for _, l := range d.Links {
		_, from := keys[l.From]
		_, to := keys[l.To]
		if !from || !to || l.From == l.To || (l.Kind != Blocks && l.Kind != Relates) || !(l.FromSide || l.ToSide) {
			t.Errorf("link %+v", l)
		}
		// GitLab stores one link per pair: the seeder creates each once.
		a, b := l.From, l.To
		if b < a {
			a, b = b, a
		}
		if pairs[a+b] {
			t.Errorf("link %+v: a second link between the same items", l)
		}
		pairs[a+b] = true
	}

	for i, it := range d.Iterations {
		if it.StartDate > it.DueDate || (i > 0 && it.StartDate <= d.Iterations[i-1].DueDate) {
			t.Errorf("iteration %s overlaps or is out of order", it.Title)
		}
	}
	if len(d.Epics) != 12 || len(d.Issues) != 19 || len(d.Links) != 24 {
		t.Fatalf("got %d epics, %d issues, %d links", len(d.Epics), len(d.Issues), len(d.Links))
	}
}

// Itération 15 holds today whatever the weekday, also on a Sunday (end of the week).
func TestCurrentIterationEveryDay(t *testing.T) {
	for day := range 14 {
		today := time.Date(2026, 11, 16+day, 23, 0, 0, 0, time.UTC)
		it := New(today).Iterations[3]
		s := today.Format(DateLayout)
		if it.Title != "Itération 15" || it.StartDate > s || s > it.DueDate {
			t.Errorf("%s: Itération 15 runs %s – %s", s, it.StartDate, it.DueDate)
		}
	}
}

func TestLookups(t *testing.T) {
	d := New(now)
	if p, ok := d.Person("SN"); !ok || p.Name != "Sofia Nguyen" {
		t.Fatalf("Person(SN) = %+v %v", p, ok)
	}
	if _, ok := d.Person("ZZ"); ok {
		t.Fatal("unknown person")
	}
	if l, ok := d.Label("bug"); !ok || l.Color != "#dc143c" {
		t.Fatalf("Label(bug) = %+v %v", l, ok)
	}
	if _, ok := d.Label("nope"); ok {
		t.Fatal("unknown label")
	}
	if p := (Project{Group: "api", Slug: "export"}).Path(); p != "api/export" {
		t.Fatalf("Path = %q", p)
	}
}

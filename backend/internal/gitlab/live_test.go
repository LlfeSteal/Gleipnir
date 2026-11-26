//go:build live

package gitlab

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"gleipnir/internal/board"
)

// TestLiveFetch runs every query against a real GitLab:
//
//	GITLAB_URL=https://gitlab.com GITLAB_GROUP=gitlab-org/ruby go test -tags live -run Live -v ./internal/gitlab/
//
// GITLAB_TOKEN and GITLAB_CADENCE are optional (gitlab.com answers anonymous queries on
// public groups).
func TestLiveFetch(t *testing.T) {
	url, group := os.Getenv("GITLAB_URL"), os.Getenv("GITLAB_GROUP")
	if url == "" || group == "" {
		t.Skip("GITLAB_URL and GITLAB_GROUP are not set")
	}
	c := New(url, os.Getenv("GITLAB_TOKEN"), group, os.Getenv("GITLAB_CADENCE"))
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	start := time.Now()
	raw, err := c.Fetch(ctx)
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	kinds := map[string]int{}
	var links, iterated, parented, labelled, assigned int
	for _, it := range raw.Items {
		kinds[it.Kind]++
		links += len(it.Blocks) + len(it.BlockedBy) + len(it.Related)
		if it.IterationID != "" {
			iterated++
		}
		if it.ParentID != "" {
			parented++
		}
		if len(it.Labels) > 0 {
			labelled++
		}
		if it.Assignee != nil {
			assigned++
		}
	}
	t.Logf("%s in %s: root %+v, %d groups, %d cadences, %d iterations, items %v, %d links, %d in an iteration, %d with a parent, %d labelled, %d assigned",
		group, time.Since(start).Round(time.Millisecond), raw.RootGroup, len(raw.Groups), len(raw.Cadences),
		len(raw.Iterations), kinds, links, iterated, parented, labelled, assigned)
	if raw.RootGroup.Path == "" || len(raw.Cadences) == 0 || len(raw.Iterations) == 0 {
		t.Errorf("incomplete data: %+v", raw.RootGroup)
	}
	// The frontend names groups by their id in the URL of a view (ADR-31).
	for _, g := range append([]board.Group{raw.RootGroup}, raw.Groups...) {
		if !strings.HasPrefix(g.ID, "gid://gitlab/Group/") {
			t.Errorf("group %s without a GID: %q", g.Path, g.ID)
		}
	}

	// Scoped refresh (Synchroniser): the same query on a subgroup, or on the root when it has none.
	scope := raw.RootGroup.Path
	if len(raw.Groups) > 0 {
		scope = raw.Groups[0].Path
	}
	start = time.Now()
	items, err := c.FetchItems(ctx, []string{scope})
	if err != nil {
		t.Fatalf("FetchItems(%s): %v", scope, err)
	}
	t.Logf("FetchItems(%s) in %s: %d items", scope, time.Since(start).Round(time.Millisecond), len(items))
	for _, it := range items {
		if g := board.ItemGroup(it); !board.InScope(g, []string{scope}) {
			t.Errorf("item %s of group %q is outside the scope %q", it.ID, g, scope)
		}
	}
}

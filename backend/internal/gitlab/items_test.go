package gitlab

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"reflect"
	"sort"
	"sync"
	"testing"
	"time"
)

// workItemsPage answers a WorkItems request with one epic per given ID, in the namespace of
// the requested group.
func workItemsPage(r gqlRequest, ids ...int) string {
	path, _ := r.Variables["fullPath"].(string)
	nodes := ""
	for i, id := range ids {
		if i > 0 {
			nodes += ","
		}
		nodes += fmt.Sprintf(`{"id":"gid://gitlab/WorkItem/%d","iid":"%d","title":"E","state":"OPEN","webUrl":"u",`+
			`"namespace":{"id":"gid://gitlab/Group/9","fullPath":%q},"workItemType":{"name":"Epic"},"widgets":[]}`, id, id, path)
	}
	return group(`"workItems":{` + lastPage + `,"nodes":[` + nodes + `]}`)
}

func TestFetchItemsWalksEachSubtree(t *testing.T) {
	byGroup := map[string][]int{"root/a": {1, 2}, "root/b": {3, 2}} // 2 is met twice
	f, c := newFake(t, map[string]func(gqlRequest) (int, string){
		"WorkItems": func(r gqlRequest) (int, string) {
			return http.StatusOK, workItemsPage(r, byGroup[r.Variables["fullPath"].(string)]...)
		},
	})
	items, err := c.FetchItems(context.Background(), []string{"root/a", "root/b"})
	if err != nil {
		t.Fatalf("FetchItems: %v", err)
	}
	var ids []string
	for _, it := range items {
		ids = append(ids, it.ID)
	}
	want := []string{"gid://gitlab/WorkItem/1", "gid://gitlab/WorkItem/2", "gid://gitlab/WorkItem/3"}
	if !reflect.DeepEqual(ids, want) {
		t.Errorf("items = %v, want %v (in group order, deduplicated)", ids, want)
	}
	if items[2].NamespacePath != "root/b" {
		t.Errorf("item 3 namespace = %q", items[2].NamespacePath)
	}

	reqs := f.requestsFor("")
	var paths []string
	for _, r := range reqs {
		if r.Op != "WorkItems" {
			t.Errorf("unexpected %s request: a scoped fetch only reads work items", r.Op)
		}
		paths = append(paths, r.Variables["fullPath"].(string))
	}
	sort.Strings(paths)
	if !reflect.DeepEqual(paths, []string{"root/a", "root/b"}) {
		t.Errorf("fullPaths = %v", paths)
	}
}

func TestFetchItemsEmpty(t *testing.T) {
	f, c := newFake(t, nil)
	items, err := c.FetchItems(context.Background(), nil)
	if err != nil || items == nil || len(items) != 0 {
		t.Errorf("FetchItems(nil) = %v, %v; want [], nil", items, err)
	}
	if n := len(f.requestsFor("")); n != 0 {
		t.Errorf("%d requests, want none", n)
	}
}

func TestFetchItemsCapsConcurrentWalks(t *testing.T) {
	var mu sync.Mutex
	running, peak := 0, 0
	_, c := newFake(t, map[string]func(gqlRequest) (int, string){
		"WorkItems": func(r gqlRequest) (int, string) {
			mu.Lock()
			running++
			peak = max(peak, running)
			mu.Unlock()
			time.Sleep(20 * time.Millisecond)
			mu.Lock()
			running--
			mu.Unlock()
			return http.StatusOK, workItemsPage(r)
		},
	})
	c.maxWalks = 2
	groups := []string{"root/a", "root/b", "root/c", "root/d", "root/e"}
	if _, err := c.FetchItems(context.Background(), groups); err != nil {
		t.Fatalf("FetchItems: %v", err)
	}
	if peak != 2 {
		t.Errorf("peak concurrent walks = %d, want 2", peak)
	}
}

func TestFetchItemsFirstErrorWins(t *testing.T) {
	_, c := newFake(t, map[string]func(gqlRequest) (int, string){
		"WorkItems": func(r gqlRequest) (int, string) {
			if r.Variables["fullPath"] == "root/gone" {
				return http.StatusOK, `{"data":{"group":null}}`
			}
			return http.StatusOK, workItemsPage(r, 1)
		},
	})
	c.maxWalks = 1 // the others wait for a slot, then see the cancelled context
	_, err := c.FetchItems(context.Background(), []string{"root/gone", "root/a", "root/b"})
	if !errors.Is(err, ErrGroupNotFound) {
		t.Fatalf("err = %v, want ErrGroupNotFound", err)
	}
}

func TestFetchItemsCancelledWhileWaitingForASlot(t *testing.T) {
	release := make(chan struct{})
	_, c := newFake(t, map[string]func(gqlRequest) (int, string){
		"WorkItems": func(r gqlRequest) (int, string) {
			<-release
			return http.StatusOK, workItemsPage(r)
		},
	})
	c.maxWalks = 1
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := c.FetchItems(ctx, []string{"root/a", "root/b"})
		done <- err
	}()
	time.Sleep(20 * time.Millisecond)
	cancel()
	close(release)
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
}

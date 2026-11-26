package cache

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"gleipnir/internal/board"
)

// countingEncoder wraps encodeIDs and counts the encodings by cadence choice.
type countingEncoder struct {
	mu    sync.Mutex
	calls map[string]int
}

func (c *countingEncoder) encode(raw *board.Raw, synced map[string]time.Time, cadences []string) ([]byte, error) {
	c.mu.Lock()
	c.calls[fmt.Sprint(cadences)]++
	c.mu.Unlock()
	return encodeIDs(raw, synced, cadences)
}

func (c *countingEncoder) count(cadences []string) int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.calls[fmt.Sprint(cadences)]
}

func viewBody(t *testing.T, s *Store, cadences ...string) string {
	t.Helper()
	snap, state, err := s.Get(context.Background(), cadences)
	if err != nil || state != Hit {
		t.Fatalf("Get(%v): %v, %v", cadences, state, err)
	}
	return string(snap.Body)
}

// ADR-38: a choice of cadences is encoded once per commit; unknown cadences are ignored, and
// with none known, the default board is served.
func TestViewsByCadences(t *testing.T) {
	s, src, clock := loaded(t)
	enc := &countingEncoder{calls: map[string]int{}}
	s.encode = enc.encode

	if got := viewBody(t, s, "c2", "nope", "c1", "c2"); got != "[c1,c2]A1,B1,X1" {
		t.Errorf("view = %q", got)
	}
	if got := viewBody(t, s, " c1", "c2 "); got != "[c1,c2]A1,B1,X1" || enc.count([]string{"c1", "c2"}) != 1 {
		t.Errorf("second view = %q, %d encodings", got, enc.count([]string{"c1", "c2"}))
	}
	if got := viewBody(t, s, "nope", ""); got != "A1,B1,X1" {
		t.Errorf("only unknown cadences: %q, want the default board", got)
	}
	if got := viewBody(t, s); got != "A1,B1,X1" || enc.count(nil) != 0 {
		t.Errorf("no cadence: %q, %d encodings", got, enc.count(nil))
	}

	// A full sync drops the views: the next request encodes the new data.
	src.mu.Lock()
	src.full = func(context.Context) (*board.Raw, error) { return testRaw("2"), nil }
	src.items = func(context.Context, []string) ([]board.RawItem, error) {
		return []board.RawItem{epic("B3", "r/b")}, nil
	}
	src.mu.Unlock()
	clock.Add(time.Hour)
	s.mu.Lock()
	c := s.startFull()
	s.mu.Unlock()
	<-c.done
	if got := viewBody(t, s, "c1", "c2"); got != "[c1,c2]A2,B2,X2" || enc.count([]string{"c1", "c2"}) != 2 {
		t.Errorf("after a sync: %q, %d encodings", got, enc.count([]string{"c1", "c2"}))
	}

	// A scoped refresh serves the choice too.
	clock.Add(time.Minute)
	snap, state, err := s.Refresh(context.Background(), []string{"r/b"}, []string{"c2"})
	if err != nil || state != Miss || string(snap.Body) != "[c2]A2,B3,X2" {
		t.Errorf("refresh: %q, %v, %v", snap.Body, state, err)
	}
	// Read less than MinRefresh ago: from the cache, with the choice.
	snap, state, err = s.Refresh(context.Background(), []string{"r/b"}, []string{"c1"})
	if err != nil || state != Hit || string(snap.Body) != "[c1]A2,B3,X2" {
		t.Errorf("throttled refresh: %q, %v, %v", snap.Body, state, err)
	}
}

// Before the first sync, a request with cadences waits for it, then gets its choice.
func TestViewOnAColdCache(t *testing.T) {
	src := &fakeSource{full: func(context.Context) (*board.Raw, error) { return testRaw("1"), nil }}
	s, _ := newStore(src)
	snap, state, err := s.Get(context.Background(), []string{"c1"})
	if err != nil || state != Miss || string(snap.Body) != "[c1]A1,B1,X1" {
		t.Errorf("cold view: %q, %v, %v", snap.Body, state, err)
	}

	src.full = func(context.Context) (*board.Raw, error) { return nil, errors.New("gitlab down") }
	s, _ = newStore(src)
	if _, _, err := s.Get(context.Background(), []string{"c1"}); err == nil || err.Error() != "gitlab down" {
		t.Errorf("cold view, failing sync: %v", err)
	}
}

// The views are capped: past maxViews, they are all dropped, then encoded again on demand.
func TestViewsAreCapped(t *testing.T) {
	s, _, _ := loaded(t)
	raw := *s.raw
	for i := 0; i <= maxViews; i++ {
		raw.Cadences = append(raw.Cadences, board.RawCadence{ID: fmt.Sprintf("x%d", i)})
	}
	s.raw = &raw
	for i := 0; i <= maxViews; i++ {
		viewBody(t, s, fmt.Sprintf("x%d", i))
	}
	s.mu.Lock()
	n := len(s.views)
	s.mu.Unlock()
	if n != 1 {
		t.Errorf("%d views kept, want 1 (dropped at the cap, then the last one)", n)
	}
}

// A view encoded from data a commit has replaced since is served, but not kept.
func TestStaleViewNotKept(t *testing.T) {
	s, _, _ := loaded(t)
	s.encode = func(raw *board.Raw, synced map[string]time.Time, cadences []string) ([]byte, error) {
		if cadences != nil {
			s.mu.Lock()
			s.gen++ // a commit happened meanwhile
			s.mu.Unlock()
		}
		return encodeIDs(raw, synced, cadences)
	}
	if got := viewBody(t, s, "c1"); got != "[c1]A1,B1,X1" {
		t.Errorf("view = %q", got)
	}
	s.mu.Lock()
	n := len(s.views)
	s.mu.Unlock()
	if n != 0 {
		t.Errorf("%d views kept, want 0", n)
	}
}

func TestViewEncodingErrors(t *testing.T) {
	s, _, _ := loaded(t)
	s.encode = func(_ *board.Raw, _ map[string]time.Time, cadences []string) ([]byte, error) {
		if cadences[0] == "c1" {
			panic("encoder bug")
		}
		return nil, errors.New("cannot encode")
	}
	if _, _, err := s.Get(context.Background(), []string{"c1"}); err == nil || err.Error() != "encoding the board panicked: encoder bug" {
		t.Errorf("panic: %v", err)
	}
	if _, _, err := s.Get(context.Background(), []string{"c2"}); err == nil || err.Error() != "cannot encode" {
		t.Errorf("error: %v", err)
	}
}

// Concurrent choices while full syncs commit (run with -race).
func TestConcurrentViews(t *testing.T) {
	s, src, clock := loaded(t)
	src.mu.Lock()
	src.full = func(context.Context) (*board.Raw, error) { return testRaw("2"), nil }
	src.mu.Unlock()
	var wg sync.WaitGroup
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			choice := [][]string{{"c1"}, {"c2"}, {"c1", "c2"}, nil}[i%4]
			for j := 0; j < 20; j++ {
				if _, _, err := s.Get(context.Background(), choice); err != nil {
					t.Errorf("Get: %v", err)
				}
			}
		}(i)
	}
	for i := 0; i < 5; i++ {
		clock.Add(time.Hour)
		s.mu.Lock()
		c := s.startFull()
		s.mu.Unlock()
		<-c.done
	}
	wg.Wait()
}

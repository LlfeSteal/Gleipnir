package cache

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"reflect"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"gleipnir/internal/board"
)

// fakeClock lets the tests age the data.
type fakeClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *fakeClock) Add(d time.Duration) {
	c.mu.Lock()
	c.now = c.now.Add(d)
	c.mu.Unlock()
}

var t0 = time.Date(2026, 10, 15, 12, 0, 0, 0, time.UTC)

// fakeSource answers with full and items, which the tests replace; it counts the calls.
type fakeSource struct {
	mu     sync.Mutex
	full   func(ctx context.Context) (*board.Raw, error)
	items  func(ctx context.Context, groups []string) ([]board.RawItem, error)
	fulls  int
	scopes [][]string
}

func (f *fakeSource) Fetch(ctx context.Context) (*board.Raw, error) {
	f.mu.Lock()
	f.fulls++
	fn := f.full
	f.mu.Unlock()
	return fn(ctx)
}

func (f *fakeSource) FetchItems(ctx context.Context, groups []string) ([]board.RawItem, error) {
	f.mu.Lock()
	f.scopes = append(f.scopes, groups)
	fn := f.items
	f.mu.Unlock()
	return fn(ctx, groups)
}

func (f *fakeSource) counts() (int, int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.fulls, len(f.scopes)
}

func epic(id, group string) board.RawItem {
	return board.RawItem{ID: id, Kind: board.KindEpic, NamespacePath: group}
}

// testRaw: root r with r/a (and its child r/a/x) and r/b, one epic per group, IDs suffixed.
func testRaw(suffix string) *board.Raw {
	return &board.Raw{
		RootGroup: board.Group{Path: "r"},
		Groups:    []board.Group{{Path: "r/a"}, {Path: "r/a/x"}, {Path: "r/b"}},
		Cadences:  []board.RawCadence{{ID: "c1"}, {ID: "c2"}},
		Items:     []board.RawItem{epic("A"+suffix, "r/a"), epic("X"+suffix, "r/a/x"), epic("B"+suffix, "r/b")},
	}
}

// encodeIDs encodes the sorted item IDs: enough to tell which read each item comes from. The
// active cadences, when given, come first, in brackets.
func encodeIDs(raw *board.Raw, _ map[string]time.Time, cadences []string) ([]byte, error) {
	ids := []string{}
	for _, it := range raw.Items {
		ids = append(ids, it.ID)
	}
	sort.Strings(ids)
	prefix := ""
	if cadences != nil {
		prefix = "[" + strings.Join(cadences, ",") + "]"
	}
	return []byte(prefix + strings.Join(ids, ",")), nil
}

func newStore(src *fakeSource) (*Store, *fakeClock) {
	clock := &fakeClock{now: t0}
	s := New(src, encodeIDs, Options{
		Interval:     time.Hour,
		FetchTimeout: time.Minute,
		MinRefresh:   10 * time.Second,
		Now:          clock.Now,
		Logger:       slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	return s, clock
}

// loaded returns a store holding testRaw("1"), read at t0.
func loaded(t *testing.T) (*Store, *fakeSource, *fakeClock) {
	t.Helper()
	src := &fakeSource{full: func(context.Context) (*board.Raw, error) { return testRaw("1"), nil }}
	s, clock := newStore(src)
	if _, state, err := s.Get(context.Background(), nil); err != nil || state != Miss {
		t.Fatalf("first Get: %v, %v", state, err)
	}
	return s, src, clock
}

func body(t *testing.T, snap Snapshot, _ State, err error) string {
	t.Helper()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	return string(snap.Body)
}

func getBody(t *testing.T, s *Store) string {
	t.Helper()
	snap, state, err := s.Get(context.Background(), nil)
	return body(t, snap, state, err)
}

func refreshBody(t *testing.T, s *Store, groups []string) string {
	t.Helper()
	snap, state, err := s.Refresh(context.Background(), groups, nil)
	return body(t, snap, state, err)
}

func (s *Store) syncedCopy() map[string]time.Time {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := map[string]time.Time{}
	for k, v := range s.synced {
		out[k] = v
	}
	return out
}

func TestNewDefaults(t *testing.T) {
	for _, opts := range []Options{{}, {Interval: -1, FetchTimeout: -1, MinRefresh: -1}} {
		s := New(&fakeSource{}, encodeIDs, opts)
		if s.interval != 5*time.Minute || s.fetchTimeout != 10*time.Minute || s.minRefresh != 10*time.Second {
			t.Errorf("durations = %v %v %v", s.interval, s.fetchTimeout, s.minRefresh)
		}
		if s.now == nil || s.log != slog.Default() {
			t.Errorf("now %v, log %v: want time.Now and slog.Default", s.now != nil, s.log)
		}
	}
}

func TestColdGetsShareOneFullSync(t *testing.T) {
	release := make(chan struct{})
	src := &fakeSource{full: func(context.Context) (*board.Raw, error) { <-release; return testRaw("1"), nil }}
	s, _ := newStore(src)

	var wg sync.WaitGroup
	bodies := make([]string, 8)
	for i := range bodies {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			snap, state, err := s.Get(context.Background(), nil)
			if err != nil || state != Miss {
				t.Errorf("Get: %v, %v", state, err)
			}
			bodies[i] = string(snap.Body)
		}(i)
	}
	time.Sleep(20 * time.Millisecond)
	close(release)
	wg.Wait()
	if fulls, _ := src.counts(); fulls != 1 {
		t.Errorf("%d full syncs, want 1", fulls)
	}
	for _, b := range bodies {
		if b != "A1,B1,X1" {
			t.Errorf("body = %q", b)
		}
	}
}

func TestGetServesTheCacheDuringASync(t *testing.T) {
	s, src, clock := loaded(t)
	release := make(chan struct{})
	src.mu.Lock()
	src.full = func(context.Context) (*board.Raw, error) { <-release; return testRaw("2"), nil }
	src.mu.Unlock()

	clock.Add(time.Hour)
	s.mu.Lock()
	c := s.startFull()
	s.mu.Unlock()

	snap, state, err := s.Get(context.Background(), nil)
	if got := body(t, snap, state, err); got != "A1,B1,X1" || state != Hit {
		t.Fatalf("during the sync: %q %s, want the cached board (HIT)", got, state)
	}
	if !snap.FetchedAt.Equal(t0) {
		t.Errorf("FetchedAt = %v, want %v", snap.FetchedAt, t0)
	}
	close(release)
	<-c.done
	snap, state, err = s.Get(context.Background(), nil)
	if got := body(t, snap, state, err); got != "A2,B2,X2" || state != Hit {
		t.Errorf("after the sync: %q %s", got, state)
	}
	if !snap.FetchedAt.Equal(t0.Add(time.Hour)) {
		t.Errorf("FetchedAt = %v", snap.FetchedAt)
	}
}

func TestFullSyncErrorsAreNotCached(t *testing.T) {
	var fail = true
	src := &fakeSource{full: func(context.Context) (*board.Raw, error) {
		if fail {
			return nil, errors.New("gitlab down")
		}
		return testRaw("1"), nil
	}}
	s, _ := newStore(src)
	if _, _, err := s.Get(context.Background(), nil); err == nil || err.Error() != "gitlab down" {
		t.Fatalf("err = %v", err)
	}
	fail = false
	if got := getBody(t, s); got != "A1,B1,X1" {
		t.Errorf("retry: %q", got)
	}
}

func TestFailedSyncKeepsTheBoard(t *testing.T) {
	s, src, _ := loaded(t)
	src.mu.Lock()
	src.full = func(context.Context) (*board.Raw, error) { return nil, nil } // no data, no error
	src.mu.Unlock()
	s.mu.Lock()
	c := s.startFull()
	s.mu.Unlock()
	<-c.done
	if c.err == nil || !strings.Contains(c.err.Error(), "no data") {
		t.Errorf("err = %v", c.err)
	}
	if got := getBody(t, s); got != "A1,B1,X1" {
		t.Errorf("board = %q, want the previous one", got)
	}
}

func TestGetGivesUpWithTheRequest(t *testing.T) {
	release := make(chan struct{})
	src := &fakeSource{full: func(context.Context) (*board.Raw, error) { <-release; return testRaw("1"), nil }}
	s, _ := newStore(src)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, _, err := s.Get(ctx, nil); !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v", err)
	}
	close(release) // the sync goes on and fills the cache
	if got := getBody(t, s); got != "A1,B1,X1" {
		t.Errorf("body = %q", got)
	}
}

func TestRunSyncsPeriodically(t *testing.T) {
	src := &fakeSource{full: func(context.Context) (*board.Raw, error) { return testRaw("1"), nil }}
	s, _ := newStore(src)
	s.interval = 5 * time.Millisecond
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { s.Run(ctx); close(done) }()
	deadline := time.Now().Add(2 * time.Second)
	for {
		if fulls, _ := src.counts(); fulls >= 3 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("Run did not sync three times")
		}
		time.Sleep(time.Millisecond)
	}
	cancel()
	<-done
}

func TestRunStopsDuringASync(t *testing.T) {
	release := make(chan struct{})
	defer close(release)
	src := &fakeSource{full: func(context.Context) (*board.Raw, error) { <-release; return testRaw("1"), nil }}
	s, _ := newStore(src)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { s.Run(ctx); close(done) }()
	time.Sleep(10 * time.Millisecond)
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("Run did not stop")
	}
}

func TestRefreshMergesTheScope(t *testing.T) {
	s, src, clock := loaded(t)
	src.mu.Lock()
	src.items = func(_ context.Context, groups []string) ([]board.RawItem, error) {
		clock.Add(3 * time.Second) // the read takes a while
		return []board.RawItem{epic("A2", "r/a"), epic("X2", "r/a/x")}, nil
	}
	src.mu.Unlock()
	clock.Add(time.Minute)

	// r/a/x is covered by r/a; unknown groups are dropped.
	snap, state, err := s.Refresh(context.Background(), []string{"r/a/x", "r/a", "nope"}, nil)
	if got := body(t, snap, state, err); got != "A2,B1,X2" || state != Miss {
		t.Fatalf("Refresh = %q %s", got, state)
	}
	if !reflect.DeepEqual(src.scopes, [][]string{{"r/a"}}) {
		t.Errorf("scopes read = %v", src.scopes)
	}
	refreshed := t0.Add(time.Minute)
	want := map[string]time.Time{"r": t0, "r/a": refreshed, "r/a/x": refreshed, "r/b": t0}
	if got := s.syncedCopy(); !reflect.DeepEqual(got, want) {
		t.Errorf("synced = %v, want %v", got, want)
	}
	if !snap.FetchedAt.Equal(t0) {
		t.Errorf("FetchedAt = %v, want the oldest group (%v)", snap.FetchedAt, t0)
	}
}

func TestRefreshInvalidScope(t *testing.T) {
	s, src, _ := loaded(t)
	for _, groups := range [][]string{nil, {}, {"nope", ""}} {
		if _, _, err := s.Refresh(context.Background(), groups, nil); !errors.Is(err, ErrInvalidScope) {
			t.Errorf("Refresh(%v) err = %v, want ErrInvalidScope", groups, err)
		}
	}
	if _, scoped := src.counts(); scoped != 0 {
		t.Errorf("%d scoped reads, want none", scoped)
	}
}

func TestRefreshWithoutDataWaitsForTheFullSync(t *testing.T) {
	src := &fakeSource{full: func(context.Context) (*board.Raw, error) { return testRaw("1"), nil }}
	s, _ := newStore(src)
	snap, state, err := s.Refresh(context.Background(), []string{"r/a"}, nil)
	if got := body(t, snap, state, err); got != "A1,B1,X1" || state != Miss {
		t.Errorf("Refresh = %q %s", got, state)
	}
	if fulls, scoped := src.counts(); fulls != 1 || scoped != 0 {
		t.Errorf("fulls %d, scoped %d", fulls, scoped)
	}
}

func TestRefreshThrottle(t *testing.T) {
	s, src, clock := loaded(t)
	src.mu.Lock()
	src.items = func(context.Context, []string) ([]board.RawItem, error) {
		clock.Add(30 * time.Second) // longer than MinRefresh: the throttle counts from the end
		return []board.RawItem{epic("A2", "r/a"), epic("X2", "r/a/x")}, nil
	}
	src.mu.Unlock()

	// Just read by the full sync.
	clock.Add(5 * time.Second)
	if _, state, err := s.Refresh(context.Background(), []string{"r/a"}, nil); err != nil || state != Hit {
		t.Fatalf("right after the full sync: %s %v, want HIT", state, err)
	}
	clock.Add(5 * time.Second)
	if _, state, _ := s.Refresh(context.Background(), []string{"r/a"}, nil); state != Miss {
		t.Fatalf("10 s after: %s, want MISS", state)
	}
	clock.Add(9 * time.Second)
	if _, state, _ := s.Refresh(context.Background(), []string{"r/a/x"}, nil); state != Hit {
		t.Errorf("a subgroup read 9 s ago: %s, want HIT", state)
	}
	// r/b was read 49 s ago: the whole scope is read again.
	if _, state, _ := s.Refresh(context.Background(), []string{"r/a", "r/b"}, nil); state != Miss {
		t.Errorf("partly fresh scope: %s, want MISS", state)
	}
	if _, scoped := src.counts(); scoped != 2 {
		t.Errorf("%d scoped reads, want 2", scoped)
	}
}

func TestConcurrentRefreshesOfAScopeShareOneRead(t *testing.T) {
	s, src, clock := loaded(t)
	release := make(chan struct{})
	src.mu.Lock()
	src.items = func(context.Context, []string) ([]board.RawItem, error) {
		<-release
		return []board.RawItem{epic("B2", "r/b")}, nil
	}
	src.mu.Unlock()
	clock.Add(time.Minute)

	var wg sync.WaitGroup
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if got := refreshBody(t, s, []string{"r/b"}); got != "A1,B2,X1" {
				t.Errorf("body = %q", got)
			}
		}()
	}
	time.Sleep(20 * time.Millisecond)
	close(release)
	wg.Wait()
	if _, scoped := src.counts(); scoped != 1 {
		t.Errorf("%d scoped reads, want 1", scoped)
	}
}

func TestRefreshErrorKeepsTheBoard(t *testing.T) {
	s, src, clock := loaded(t)
	src.mu.Lock()
	src.items = func(context.Context, []string) ([]board.RawItem, error) { return nil, errors.New("boom") }
	src.mu.Unlock()
	clock.Add(time.Minute)
	if _, _, err := s.Refresh(context.Background(), []string{"r/a"}, nil); err == nil || err.Error() != "boom" {
		t.Fatalf("err = %v", err)
	}
	if got := getBody(t, s); got != "A1,B1,X1" {
		t.Errorf("board = %q", got)
	}
	// Not throttled: the failed read did not count.
	if _, state, _ := s.Refresh(context.Background(), []string{"r/a"}, nil); state != Miss {
		t.Errorf("retry: %s", state)
	}
}

func TestRefreshGivesUpWithTheRequest(t *testing.T) {
	s, src, clock := loaded(t)
	release := make(chan struct{})
	src.mu.Lock()
	src.items = func(context.Context, []string) ([]board.RawItem, error) {
		<-release
		return []board.RawItem{epic("B2", "r/b")}, nil
	}
	src.mu.Unlock()
	clock.Add(time.Minute)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, _, err := s.Refresh(ctx, []string{"r/b"}, nil); !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v", err)
	}
	close(release)
	deadline := time.Now().Add(time.Second)
	for got := ""; got != "A1,B2,X1"; {
		if time.Now().After(deadline) {
			t.Fatalf("the read did not go on: %q", got)
		}
		time.Sleep(time.Millisecond)
		got = getBody(t, s)
	}
}

// A full sync that started before a scoped refresh ends after it: the refreshed groups keep
// the newer items.
func TestFullSyncKeepsNewerScopes(t *testing.T) {
	s, src, clock := loaded(t)
	release := make(chan struct{})
	src.mu.Lock()
	src.full = func(context.Context) (*board.Raw, error) {
		<-release
		raw := testRaw("3")
		raw.Groups = append(raw.Groups, board.Group{Path: "r/c"}) // new group
		raw.Items = append(raw.Items, epic("C3", "r/c"))
		return raw, nil
	}
	src.items = func(context.Context, []string) ([]board.RawItem, error) {
		return []board.RawItem{epic("A2", "r/a"), epic("X2", "r/a/x")}, nil
	}
	src.mu.Unlock()

	clock.Add(time.Hour)
	fullStart := clock.Now()
	s.mu.Lock()
	c := s.startFull()
	s.mu.Unlock()
	time.Sleep(10 * time.Millisecond) // the full sync has taken its start time

	clock.Add(time.Minute)
	if got := refreshBody(t, s, []string{"r/a"}); got != "A2,B1,X2" {
		t.Fatalf("after the refresh: %q", got)
	}
	close(release)
	<-c.done
	if got := getBody(t, s); got != "A2,B3,C3,X2" {
		t.Errorf("after the full sync: %q, want r/a from the refresh, the rest from the sync", got)
	}
	refreshed := fullStart.Add(time.Minute)
	want := map[string]time.Time{"r": fullStart, "r/a": refreshed, "r/a/x": refreshed, "r/b": fullStart, "r/c": fullStart}
	if got := s.syncedCopy(); !reflect.DeepEqual(got, want) {
		t.Errorf("synced = %v, want %v", got, want)
	}
}

// A scoped refresh that ends after a newer full sync doesn't overwrite it.
func TestRefreshDoesNotOverwriteANewerSync(t *testing.T) {
	s, src, clock := loaded(t)
	release := make(chan struct{})
	src.mu.Lock()
	src.items = func(context.Context, []string) ([]board.RawItem, error) {
		<-release
		return []board.RawItem{epic("A2", "r/a"), epic("X2", "r/a/x")}, nil
	}
	src.full = func(context.Context) (*board.Raw, error) { return testRaw("3"), nil }
	src.mu.Unlock()

	clock.Add(time.Hour)
	done := make(chan string)
	go func() { done <- refreshBody(t, s, []string{"r/a"}) }()
	time.Sleep(10 * time.Millisecond)

	clock.Add(time.Minute)
	s.mu.Lock()
	c := s.startFull()
	s.mu.Unlock()
	<-c.done
	close(release)
	if got := <-done; got != "A3,B3,X3" {
		t.Errorf("after the late refresh: %q, want the full sync's items", got)
	}
}

func TestPanicsBecomeErrors(t *testing.T) {
	src := &fakeSource{full: func(context.Context) (*board.Raw, error) { panic("source bug") }}
	s, _ := newStore(src)
	if _, _, err := s.Get(context.Background(), nil); err == nil || !strings.Contains(err.Error(), "source bug") {
		t.Fatalf("err = %v", err)
	}

	src.mu.Lock()
	src.full = func(context.Context) (*board.Raw, error) { return testRaw("1"), nil }
	src.mu.Unlock()
	s.encode = func(*board.Raw, map[string]time.Time, []string) ([]byte, error) { panic("encoder bug") }
	if _, _, err := s.Get(context.Background(), nil); err == nil || !strings.Contains(err.Error(), "encoder bug") {
		t.Fatalf("err = %v", err)
	}
	// The lock was released: the store still works.
	s.encode = encodeIDs
	if got := getBody(t, s); got != "A1,B1,X1" {
		t.Errorf("body = %q", got)
	}
}

func TestEncodeErrorKeepsTheBoard(t *testing.T) {
	s, src, clock := loaded(t)
	src.mu.Lock()
	src.items = func(context.Context, []string) ([]board.RawItem, error) {
		return []board.RawItem{epic("B2", "r/b")}, nil
	}
	src.mu.Unlock()
	s.encode = func(*board.Raw, map[string]time.Time, []string) ([]byte, error) {
		return nil, errors.New("cannot encode")
	}
	clock.Add(time.Minute)
	if _, _, err := s.Refresh(context.Background(), []string{"r/b"}, nil); err == nil || err.Error() != "cannot encode" {
		t.Fatalf("err = %v", err)
	}
	s.encode = encodeIDs
	if got := getBody(t, s); got != "A1,B1,X1" {
		t.Errorf("board = %q", got)
	}
	if got := s.syncedCopy()["r/b"]; !got.Equal(t0) {
		t.Errorf("r/b synced = %v, want unchanged", got)
	}
}

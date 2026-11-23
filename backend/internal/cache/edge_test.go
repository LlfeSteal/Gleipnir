package cache

import (
	"context"
	"errors"
	"log/slog"
	"testing"
	"time"
)

func TestNewDefaults(t *testing.T) {
	cases := []struct {
		name string
		opts Options
		want [4]time.Duration // fresh, keep, fetchTimeout, minRefresh
	}{
		{"zero values", Options{}, [4]time.Duration{5 * time.Minute, 24 * time.Hour, 10 * time.Minute, 10 * time.Second}},
		{"negative values", Options{Fresh: -1, Keep: -1, FetchTimeout: -1, MinRefresh: -1},
			[4]time.Duration{5 * time.Minute, 24 * time.Hour, 10 * time.Minute, 10 * time.Second}},
		{"keep shorter than fresh is raised to fresh", Options{Fresh: 2 * time.Hour, Keep: time.Hour, FetchTimeout: time.Second, MinRefresh: time.Second},
			[4]time.Duration{2 * time.Hour, 2 * time.Hour, time.Second, time.Second}},
		{"keep equal to fresh is kept", Options{Fresh: time.Hour, Keep: time.Hour},
			[4]time.Duration{time.Hour, time.Hour, 10 * time.Minute, 10 * time.Second}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			s := New(c.opts)
			if got := [4]time.Duration{s.fresh, s.keep, s.fetchTimeout, s.minRefresh}; got != c.want {
				t.Fatalf("durations = %v, want %v", got, c.want)
			}
			if s.now == nil || s.log != slog.Default() {
				t.Fatalf("now set: %v, log %v: want time.Now and slog.Default", s.now != nil, s.log)
			}
			if since := time.Since(s.now()); since < 0 || since > time.Minute {
				t.Fatalf("now is not the real clock: %v", s.now())
			}
		})
	}
}

// An entry is dropped once it is exactly keep old, not a moment before.
func TestPurgeBoundary(t *testing.T) {
	s, clock := newStore()
	release := make(chan struct{})
	close(release)
	fetch, _ := counter(release)
	mustGet(t, s, false, fetch)
	clock.Add(24*time.Hour - time.Nanosecond)
	if body, state := mustGet(t, s, false, fetch); body != "v1" || state != Stale {
		t.Fatalf("just under keep: %s %s, want v1 STALE", body, state)
	}
	waitFor(t, s.idle)
	// The stale refresh stored v2 at the current time; age it by exactly keep.
	clock.Add(24 * time.Hour)
	if body, state := mustGet(t, s, false, fetch); body != "v3" || state != Miss {
		t.Fatalf("exactly keep: %s %s, want v3 MISS", body, state)
	}
}

// The failure time of a key that never succeeded is forgotten after keep, like the entries.
func TestPurgeForgetsOldFailures(t *testing.T) {
	s, clock := newStore()
	failing := func(context.Context) (Data, error) { return Data{}, errors.New("gitlab down") }
	if _, _, err := s.Get(context.Background(), "k", false, failing); err == nil {
		t.Fatal("want the fetch error")
	}
	failures := func() int {
		s.mu.Lock()
		defer s.mu.Unlock()
		return len(s.failedAt)
	}
	if n := failures(); n != 1 {
		t.Fatalf("%d failures recorded, want 1", n)
	}
	clock.Add(time.Hour)
	s.Get(context.Background(), "other", false, func(context.Context) (Data, error) { return Data{Body: []byte("x")}, nil })
	if n := failures(); n != 1 {
		t.Fatalf("a recent failure was forgotten: %d", n)
	}
	clock.Add(24 * time.Hour)
	s.Get(context.Background(), "other", false, func(context.Context) (Data, error) { return Data{Body: []byte("x")}, nil })
	if n := failures(); n != 0 {
		t.Fatalf("an old failure is kept: %d", n)
	}
}

// Package cache keeps the encoded API responses in memory and makes sure GitLab is walked
// at most once at a time per key, whatever the number of requests (adapted from Nornir).
package cache

import (
	"context"
	"fmt"
	"log/slog"
	"runtime/debug"
	"sync"
	"time"
)

// State tells how a response was served (the X-Cache header).
type State string

const (
	Hit   State = "HIT"   // fresh cached data
	Stale State = "STALE" // cached data older than the fresh period, refreshing in the background
	Miss  State = "MISS"  // fetched for this request
)

// Data is an encoded response and the headers to serve with it (nil when none).
type Data struct {
	Body   []byte
	Header map[string]string
}

// Entry is an encoded response and the time its data was fetched.
type Entry struct {
	Data
	FetchedAt time.Time
}

// FetchFunc fetches and encodes the data of a key. It runs detached from the request that
// started it, under its own timeout.
type FetchFunc func(ctx context.Context) (Data, error)

// Options configures a Store. Zero values get the defaults below.
type Options struct {
	Fresh        time.Duration // served as HIT up to this age (default 5m)
	Keep         time.Duration // served as STALE (and refreshed) up to this age, dropped after (default 24h)
	FetchTimeout time.Duration // a fetch is cancelled after this (default 10m)
	// MinRefresh throttles the GitLab walks requests can trigger (default 10s): a forced
	// refresh of data younger than this is served from the cache, and a stale entry whose
	// last refresh failed less than this ago is served without a new attempt. Without it,
	// a client spamming ?refresh=1 (or GitLab failing) would keep the instance walking GitLab.
	MinRefresh time.Duration
	Now        func() time.Time
	Logger     *slog.Logger
}

// Store is safe for concurrent use.
type Store struct {
	fresh        time.Duration
	keep         time.Duration
	fetchTimeout time.Duration
	minRefresh   time.Duration
	now          func() time.Time
	log          *slog.Logger

	mu       sync.Mutex
	entries  map[string]*Entry
	inflight map[string]*call
	failedAt map[string]time.Time // last failed fetch of a key, cleared by a success
}

type call struct {
	done  chan struct{}
	entry *Entry
	err   error
}

func New(opts Options) *Store {
	s := &Store{
		fresh:        opts.Fresh,
		keep:         opts.Keep,
		fetchTimeout: opts.FetchTimeout,
		minRefresh:   opts.MinRefresh,
		now:          opts.Now,
		log:          opts.Logger,
		entries:      map[string]*Entry{},
		inflight:     map[string]*call{},
		failedAt:     map[string]time.Time{},
	}
	if s.fresh <= 0 {
		s.fresh = 5 * time.Minute
	}
	if s.keep <= 0 {
		s.keep = 24 * time.Hour
	}
	if s.keep < s.fresh {
		s.keep = s.fresh
	}
	if s.fetchTimeout <= 0 {
		s.fetchTimeout = 10 * time.Minute
	}
	if s.minRefresh <= 0 {
		s.minRefresh = 10 * time.Second
	}
	if s.now == nil {
		s.now = time.Now
	}
	if s.log == nil {
		s.log = slog.Default()
	}
	return s
}

// Get returns the data of key:
//   - fresh cached data right away (HIT);
//   - older cached data right away (STALE), while a refresh runs in the background;
//   - otherwise, or with refresh, it waits for a fetch (MISS).
//
// Concurrent requests for a key share a single fetch. The fetch doesn't depend on ctx: when
// the caller gives up (closed tab, proxy timeout), it goes on and its result is cached.
// Errors are not cached: the next request without cached data tries again. MinRefresh
// throttles refresh and the background refresh after a failure (see Options).
func (s *Store) Get(ctx context.Context, key string, refresh bool, fetch FetchFunc) (*Entry, State, error) {
	s.mu.Lock()
	s.purge()
	now := s.now()
	entry := s.entries[key]
	if entry != nil && refresh && now.Sub(entry.FetchedAt) < s.minRefresh {
		refresh = false // just fetched: served as is
	}
	if entry != nil && !refresh {
		if now.Sub(entry.FetchedAt) < s.fresh {
			s.mu.Unlock()
			return entry, Hit, nil
		}
		if failed, ok := s.failedAt[key]; !ok || now.Sub(failed) >= s.minRefresh {
			s.start(key, fetch)
		}
		s.mu.Unlock()
		return entry, Stale, nil
	}
	c := s.start(key, fetch)
	s.mu.Unlock()

	select {
	case <-c.done:
		return c.entry, Miss, c.err
	case <-ctx.Done():
		return nil, Miss, ctx.Err()
	}
}

// Prefetch starts a fetch of key in the background (unless one is running) and returns
// without waiting.
func (s *Store) Prefetch(key string, fetch FetchFunc) {
	s.mu.Lock()
	s.start(key, fetch)
	s.mu.Unlock()
}

// start returns the running fetch of key, or starts one. Called with s.mu held.
func (s *Store) start(key string, fetch FetchFunc) *call {
	if c := s.inflight[key]; c != nil {
		return c
	}
	c := &call{done: make(chan struct{})}
	s.inflight[key] = c
	go func() {
		started := s.now()
		data, err := s.run(key, fetch)
		s.mu.Lock()
		if err == nil {
			c.entry = &Entry{Data: data, FetchedAt: s.now()}
			s.entries[key] = c.entry
			delete(s.failedAt, key)
		} else {
			c.err = err
			s.failedAt[key] = s.now()
		}
		delete(s.inflight, key)
		s.mu.Unlock()
		close(c.done)
		if err != nil {
			s.log.Warn("cache: fetch failed", "key", key, "duration", s.now().Sub(started).Round(time.Millisecond), "err", err)
		}
	}()
	return c
}

// run calls fetch under the fetch timeout. A panic becomes an error: the fetch runs in its
// own goroutine, where no HTTP middleware would recover it and the whole server would die.
func (s *Store) run(key string, fetch FetchFunc) (data Data, err error) {
	ctx, cancel := context.WithTimeout(context.Background(), s.fetchTimeout)
	defer cancel()
	defer func() {
		if p := recover(); p != nil {
			s.log.Error("cache: fetch panicked", "key", key, "panic", p, "stack", string(debug.Stack()))
			data, err = Data{}, fmt.Errorf("fetching %s panicked: %v", key, p)
		}
	}()
	return fetch(ctx)
}

// purge drops the entries older than keep. Called with s.mu held.
func (s *Store) purge() {
	for key, entry := range s.entries {
		if s.now().Sub(entry.FetchedAt) >= s.keep {
			delete(s.entries, key)
		}
	}
	for key, at := range s.failedAt {
		if s.now().Sub(at) >= s.keep {
			delete(s.failedAt, key)
		}
	}
}

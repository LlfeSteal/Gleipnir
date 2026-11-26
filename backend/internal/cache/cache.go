// Package cache keeps the board in memory. A full sync reads the whole group at startup, then
// again every Interval, in the background: the cached board is served meanwhile. Synchroniser
// asks for a scoped refresh, which only reads the subtrees of the groups the user filters on
// and merges them in. Each group remembers when its items were read (ADR-24).
package cache

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"runtime/debug"
	"sort"
	"strings"
	"sync"
	"time"

	"gleipnir/internal/board"
)

// State tells how a response was served (the X-Cache header).
type State string

const (
	Hit  State = "HIT"  // cached data, served at once
	Miss State = "MISS" // read from GitLab for this request
)

// ErrInvalidScope: a scoped refresh names no known group.
var ErrInvalidScope = errors.New("no known group in the refresh scope")

// Source reads GitLab.
type Source interface {
	// Fetch reads everything: groups, cadence, iterations and work items.
	Fetch(ctx context.Context) (*board.Raw, error)
	// FetchItems reads the work items of the subtrees of groups.
	FetchItems(ctx context.Context, groups []string) ([]board.RawItem, error)
}

// EncodeFunc builds and encodes the board of raw with the active cadences (nil: the default,
// ADR-38). synced gives when each group's items were read; it must not be kept.
type EncodeFunc func(raw *board.Raw, synced map[string]time.Time, cadences []string) ([]byte, error)

// maxViews caps the boards encoded for a choice of cadences, kept until the next commit.
const maxViews = 16

// Snapshot is the encoded board, and the oldest read time of its groups.
type Snapshot struct {
	Body      []byte
	FetchedAt time.Time
}

// Options configures a Store. Zero values get the defaults below.
type Options struct {
	Interval     time.Duration // between the end of a full sync and the start of the next (default 5m)
	FetchTimeout time.Duration // a read of GitLab is cancelled after this (default 10m)
	// MinRefresh throttles the GitLab walks requests can trigger (default 10s, ADR-20): a
	// scoped refresh of groups all read less than this ago is served from the cache.
	MinRefresh time.Duration
	Now        func() time.Time
	Logger     *slog.Logger
}

// Store is safe for concurrent use.
type Store struct {
	source       Source
	encode       EncodeFunc
	interval     time.Duration
	fetchTimeout time.Duration
	minRefresh   time.Duration
	now          func() time.Time
	log          *slog.Logger

	mu     sync.Mutex
	raw    *board.Raw           // nil until the first full sync succeeds
	synced map[string]time.Time // group path → start of the read its items come from
	doneAt map[string]time.Time // group path → end of that read (MinRefresh counts from it)
	snap   Snapshot             // the board with the default cadences
	views  map[string][]byte    // the board for other choices of cadences, by viewKey
	gen    int                  // bumped on each commit: a view encoded from older data is not kept
	full   *call                // running full sync
	scoped map[string]*call     // running scoped refreshes, by normalized scope
}

type call struct {
	done chan struct{}
	snap Snapshot
	err  error
}

func New(source Source, encode EncodeFunc, opts Options) *Store {
	s := &Store{
		source:       source,
		encode:       encode,
		interval:     opts.Interval,
		fetchTimeout: opts.FetchTimeout,
		minRefresh:   opts.MinRefresh,
		now:          opts.Now,
		log:          opts.Logger,
		synced:       map[string]time.Time{},
		doneAt:       map[string]time.Time{},
		scoped:       map[string]*call{},
		views:        map[string][]byte{},
	}
	if s.interval <= 0 {
		s.interval = 5 * time.Minute
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

// Run syncs everything now, then Interval after the end of each sync, until ctx is done. A
// failed sync keeps the cached board served; the next request without data tries again.
func (s *Store) Run(ctx context.Context) {
	for {
		s.mu.Lock()
		c := s.startFull()
		s.mu.Unlock()
		select {
		case <-c.done:
		case <-ctx.Done():
			return
		}
		timer := time.NewTimer(s.interval)
		select {
		case <-timer.C:
		case <-ctx.Done():
			timer.Stop()
			return
		}
	}
}

// Get serves the cached board (HIT) with the active cadences (nil: the default, ADR-38).
// Before the first successful sync, it waits for the running full sync, or starts one
// (MISS). The sync goes on when ctx is done.
func (s *Store) Get(ctx context.Context, cadences []string) (Snapshot, State, error) {
	s.mu.Lock()
	if s.raw != nil {
		return s.view(cadences, Hit) // unlocks
	}
	c := s.startFull()
	s.mu.Unlock()
	return s.waitView(ctx, c, cadences)
}

// Refresh reads the subtrees of groups again, merges them into the board and serves it
// (MISS). Unknown groups are ignored, and none left is ErrInvalidScope. Groups all read less
// than MinRefresh ago are served from the cache (HIT). Concurrent refreshes of the same scope
// share one read, which goes on when ctx is done. Without data yet, it waits for the full sync.
// The board has the active cadences (nil: the default, ADR-38).
func (s *Store) Refresh(ctx context.Context, groups, cadences []string) (Snapshot, State, error) {
	s.mu.Lock()
	if s.raw == nil {
		s.mu.Unlock()
		return s.Get(ctx, cadences)
	}
	scope := board.NormalizeScope(groups, s.raw.RootGroup, s.raw.Groups)
	if len(scope) == 0 {
		s.mu.Unlock()
		return Snapshot{}, Miss, ErrInvalidScope
	}
	if s.readSince(scope, s.now().Add(-s.minRefresh)) { // ADR-20
		return s.view(cadences, Hit) // unlocks
	}
	key := strings.Join(scope, ",")
	c := s.scoped[key]
	if c == nil {
		c = s.startScoped(key, scope)
	}
	s.mu.Unlock()
	return s.waitView(ctx, c, cadences)
}

// waitView waits for c, then serves the board with the cadences (MISS): the data in place,
// at least as new as c's.
func (s *Store) waitView(ctx context.Context, c *call, cadences []string) (Snapshot, State, error) {
	select {
	case <-c.done:
		if c.err != nil {
			return Snapshot{}, Miss, c.err
		}
		s.mu.Lock()
		return s.view(cadences, Miss) // unlocks
	case <-ctx.Done():
		return Snapshot{}, Miss, ctx.Err()
	}
}

// view serves the board with the cadences: the default one when none of them is known,
// else a board encoded once per choice until the next commit. Called with s.mu held, which
// it releases: the encoding runs unlocked, on data a commit replaces but never modifies.
func (s *Store) view(cadences []string, state State) (Snapshot, State, error) {
	key, known := viewKey(s.raw, cadences)
	snap := s.snap
	if key == "" {
		s.mu.Unlock()
		return snap, state, nil
	}
	if body, ok := s.views[key]; ok {
		s.mu.Unlock()
		return Snapshot{Body: body, FetchedAt: snap.FetchedAt}, state, nil
	}
	raw, synced, gen := s.raw, s.synced, s.gen
	s.mu.Unlock()

	body, err := s.safeEncode(raw, synced, known)
	if err != nil {
		return Snapshot{}, state, err
	}
	s.mu.Lock()
	if s.gen == gen {
		if len(s.views) >= maxViews {
			clear(s.views)
		}
		s.views[key] = body
	}
	s.mu.Unlock()
	return Snapshot{Body: body, FetchedAt: snap.FetchedAt}, state, nil
}

// viewKey keeps the cadences raw knows, deduplicated and sorted; key is "" when none is left.
func viewKey(raw *board.Raw, cadences []string) (key string, known []string) {
	exists := make(map[string]bool, len(raw.Cadences))
	for _, c := range raw.Cadences {
		exists[c.ID] = true
	}
	seen := map[string]bool{}
	for _, id := range cadences {
		id = strings.TrimSpace(id)
		if exists[id] && !seen[id] {
			seen[id] = true
			known = append(known, id)
		}
	}
	sort.Strings(known)
	return strings.Join(known, ","), known
}

// startFull returns the running full sync, or starts one. Called with s.mu held.
func (s *Store) startFull() *call {
	if s.full != nil {
		return s.full
	}
	c := &call{done: make(chan struct{})}
	s.full = c
	go func() {
		started := s.now()
		var raw *board.Raw
		err := s.guard("full sync", func(ctx context.Context) (err error) {
			raw, err = s.source.Fetch(ctx)
			return err
		})
		if err == nil && raw == nil {
			err = errors.New("the source returned no data")
		}
		s.mu.Lock()
		if err == nil {
			err = s.applyFull(raw, started)
		}
		c.snap, c.err = s.snap, err
		s.full = nil
		s.mu.Unlock()
		close(c.done)
		s.logDone("full sync", nil, started, err)
	}()
	return c
}

// startScoped starts a scoped refresh. Called with s.mu held.
func (s *Store) startScoped(key string, scope []string) *call {
	c := &call{done: make(chan struct{})}
	s.scoped[key] = c
	go func() {
		started := s.now()
		var items []board.RawItem
		err := s.guard("scoped refresh", func(ctx context.Context) (err error) {
			items, err = s.source.FetchItems(ctx, scope)
			return err
		})
		s.mu.Lock()
		if err == nil {
			err = s.applyScope(scope, items, started)
		}
		c.snap, c.err = s.snap, err
		delete(s.scoped, key)
		s.mu.Unlock()
		close(c.done)
		s.logDone("scoped refresh", scope, started, err)
	}()
	return c
}

// applyFull merges a full read started at started. Groups read since by a scoped refresh are
// newer: they keep their items. Called with s.mu held.
func (s *Store) applyFull(raw *board.Raw, started time.Time) error {
	newer := map[string]bool{}
	for path, at := range s.synced {
		if at.After(started) {
			newer[path] = true
		}
	}
	next := board.MergeScope(s.raw, func(g string) bool { return !newer[g] }, raw.Items)
	items := next.Items
	*next = *raw
	next.Items = items

	synced := map[string]time.Time{}
	for _, path := range groupPaths(next) {
		if newer[path] {
			synced[path] = s.synced[path]
		} else {
			synced[path] = started
		}
	}
	return s.commit(next, synced)
}

// applyScope merges the items of scope read from started on. A group read since (by a full
// sync or another refresh) is newer: it keeps its items. Called with s.mu held.
func (s *Store) applyScope(scope []string, items []board.RawItem, started time.Time) error {
	inScope := func(g string) bool { return board.InScope(g, scope) && !s.synced[g].After(started) }
	next := board.MergeScope(s.raw, inScope, items)
	synced := make(map[string]time.Time, len(s.synced))
	for path, at := range s.synced {
		synced[path] = at
		if inScope(path) {
			synced[path] = started
		}
	}
	return s.commit(next, synced)
}

// safeEncode runs encode and turns a panic into an error.
func (s *Store) safeEncode(raw *board.Raw, synced map[string]time.Time, cadences []string) (body []byte, err error) {
	defer func() {
		if p := recover(); p != nil {
			s.log.Error("cache: encoding panicked", "panic", p, "stack", string(debug.Stack()))
			body, err = nil, fmt.Errorf("encoding the board panicked: %v", p)
		}
	}()
	return s.encode(raw, synced, cadences)
}

// commit encodes raw and makes it the served board; on error, the board in place stays.
// Called with s.mu held: bodies are stored in the order the data was merged.
func (s *Store) commit(raw *board.Raw, synced map[string]time.Time) error {
	body, err := s.safeEncode(raw, synced, nil)
	if err != nil {
		return err
	}
	var oldest time.Time
	for _, at := range synced {
		if oldest.IsZero() || at.Before(oldest) {
			oldest = at
		}
	}
	now := s.now()
	doneAt := make(map[string]time.Time, len(synced))
	for path, at := range synced {
		if prev, ok := s.synced[path]; ok && prev.Equal(at) {
			doneAt[path] = s.doneAt[path]
		} else {
			doneAt[path] = now
		}
	}
	s.raw, s.synced, s.doneAt = raw, synced, doneAt
	s.snap = Snapshot{Body: body, FetchedAt: oldest}
	s.gen++
	clear(s.views)
	return nil
}

// readSince tells whether every known group of the scope subtrees was read by a read that
// ended after t. Called with s.mu held.
func (s *Store) readSince(scope []string, t time.Time) bool {
	for _, path := range groupPaths(s.raw) {
		if board.InScope(path, scope) && !s.doneAt[path].After(t) {
			return false
		}
	}
	return true
}

// guard runs fn under the fetch timeout, detached from any request. A panic becomes an
// error: fn runs in its own goroutine, where no HTTP middleware would recover it and the
// whole server would die.
func (s *Store) guard(name string, fn func(context.Context) error) (err error) {
	ctx, cancel := context.WithTimeout(context.Background(), s.fetchTimeout)
	defer cancel()
	defer func() {
		if p := recover(); p != nil {
			s.log.Error("cache: "+name+" panicked", "panic", p, "stack", string(debug.Stack()))
			err = fmt.Errorf("%s panicked: %v", name, p)
		}
	}()
	return fn(ctx)
}

func (s *Store) logDone(name string, scope []string, started time.Time, err error) {
	attrs := []any{"duration", s.now().Sub(started).Round(time.Millisecond)}
	if scope != nil {
		attrs = append(attrs, "scope", strings.Join(scope, ","))
	}
	if err != nil {
		s.log.Warn("cache: "+name+" failed", append(attrs, "err", err)...)
		return
	}
	s.log.Info("cache: "+name+" done", attrs...)
}

// groupPaths lists the root group and its descendants.
func groupPaths(raw *board.Raw) []string {
	paths := make([]string, 0, len(raw.Groups)+1)
	paths = append(paths, raw.RootGroup.Path)
	for _, g := range raw.Groups {
		paths = append(paths, g.Path)
	}
	return paths
}

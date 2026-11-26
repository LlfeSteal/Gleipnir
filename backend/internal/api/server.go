// Package api serves the board over HTTP: GET /api/health and GET /api/board.
package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"runtime/debug"
	"strings"
	"time"

	"gleipnir/internal/board"
	"gleipnir/internal/cache"
)

// Source hands the raw board data to the server: the GitLab client.
type Source = cache.Source

// Options configures a Server. Only Source is required.
type Options struct {
	Source Source
	Build  func(*board.Raw, time.Time) *board.Board // default board.Build
	Now    func() time.Time                         // default time.Now
	// Cache: Interval is CACHE_TTL; Now and Logger default to the server's.
	Cache     cache.Options
	GitLabURL string
	Group     string
	// Token is never served: it is only scrubbed from the error messages, just in case.
	Token  string
	Logger *slog.Logger
}

// Server answers the API requests. Every visitor sees the same board, read with the one
// server-wide token.
type Server struct {
	build func(*board.Raw, time.Time) *board.Board
	now   func() time.Time
	cache *cache.Store
	log   *slog.Logger

	gitlabURL string
	group     string
	token     string
}

func NewServer(opts Options) *Server {
	s := &Server{
		build:     opts.Build,
		now:       opts.Now,
		log:       opts.Logger,
		gitlabURL: opts.GitLabURL,
		group:     opts.Group,
		token:     opts.Token,
	}
	if s.build == nil {
		s.build = board.Build
	}
	if s.now == nil {
		s.now = time.Now
	}
	if s.log == nil {
		s.log = slog.Default()
	}
	cacheOpts := opts.Cache
	if cacheOpts.Now == nil {
		cacheOpts.Now = s.now
	}
	if cacheOpts.Logger == nil {
		cacheOpts.Logger = s.log
	}
	s.cache = cache.New(sourceErrors{opts.Source}, s.encodeBoard, cacheOpts)
	return s
}

// Handler returns the routes wrapped in the header, logging and recover middlewares.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", s.handleHealth)
	mux.HandleFunc("GET /api/board", s.handleBoard)
	mux.HandleFunc("/", s.handleNotFound)
	return secureHeaders(s.logRequests(s.recoverPanics(mux)))
}

// Run syncs the board now, so the first visitor doesn't wait, then every CACHE_TTL, until
// ctx is done (see cache.Store.Run).
func (s *Server) Run(ctx context.Context) {
	s.cache.Run(ctx)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":    "ok",
		"gitlabUrl": s.gitlabURL,
		"group":     s.group,
	})
}

// handleBoard serves the cached board. ?refresh=1&groups=a,b first reads the subtrees of
// those groups again (Synchroniser): never the whole group, which only the periodic sync
// reads. X-Cache says how it was served, X-Fetched-At when its oldest group was read.
func (s *Server) handleBoard(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	var (
		snap  cache.Snapshot
		state cache.State
		err   error
	)
	if refresh := q.Get("refresh"); refresh == "1" || refresh == "true" {
		// GitLab paths can't hold a comma.
		snap, state, err = s.cache.Refresh(r.Context(), strings.Split(q.Get("groups"), ","))
	} else {
		snap, state, err = s.cache.Get(r.Context())
	}
	if err != nil {
		if r.Context().Err() != nil {
			return // the client is gone; the read goes on and fills the cache
		}
		s.writeError(w, err)
		return
	}
	h := w.Header()
	h.Set("Content-Type", "application/json; charset=utf-8")
	h.Set("Cache-Control", "no-store")
	h.Set("X-Cache", string(state))
	h.Set("X-Fetched-At", snap.FetchedAt.UTC().Format(time.RFC3339))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(snap.Body)
}

// handleNotFound answers every other path; a known path with another method gets a 405.
func (s *Server) handleNotFound(w http.ResponseWriter, r *http.Request) {
	switch r.URL.Path {
	case "/api/health", "/api/board":
		w.Header().Set("Allow", "GET, HEAD")
		writeJSON(w, http.StatusMethodNotAllowed, errorBody{
			Error: fmt.Sprintf("method %s not allowed on %s", r.Method, r.URL.Path),
			Code:  "method_not_allowed",
		})
		return
	}
	writeJSON(w, http.StatusNotFound, errorBody{Error: "no route for " + r.URL.Path, Code: "not_found"})
}

// encodeBoard builds the board and encodes it once for every request served from the
// cache. Each group carries the time its items were read.
func (s *Server) encodeBoard(raw *board.Raw, synced map[string]time.Time) ([]byte, error) {
	b, err := s.safeBuild(raw)
	if err != nil {
		return nil, err
	}
	for i := range b.Groups {
		if at, ok := synced[b.Groups[i].Path]; ok {
			at := at.UTC()
			b.Groups[i].SyncedAt = &at
		}
	}
	body, err := json.Marshal(b)
	if err != nil {
		return nil, fmt.Errorf("encoding the board: %w", err)
	}
	s.log.Info("board built",
		"iterations", len(b.Iterations), "epics", len(b.Epics), "issues", len(b.Issues),
		"links", len(b.Links), "kb", len(body)/1024)
	return body, nil
}

// sourceErrors marks the errors of the source (GitLab) as such: those are 502, unlike our
// own bugs.
type sourceErrors struct{ src Source }

func (s sourceErrors) Fetch(ctx context.Context) (*board.Raw, error) {
	raw, err := s.src.Fetch(ctx)
	if err != nil {
		return nil, &sourceError{err: err}
	}
	return raw, nil
}

func (s sourceErrors) FetchItems(ctx context.Context, groups []string) ([]board.RawItem, error) {
	items, err := s.src.FetchItems(ctx, groups)
	if err != nil {
		return nil, &sourceError{err: err}
	}
	return items, nil
}

// safeBuild runs Build and turns a panic into an error: a bug in the business rules must
// give a 500, not kill the server.
func (s *Server) safeBuild(raw *board.Raw) (b *board.Board, err error) {
	defer func() {
		if p := recover(); p != nil {
			s.log.Error("building the board panicked", "panic", p, "stack", string(debug.Stack()))
			b, err = nil, fmt.Errorf("building the board failed: %v", p)
		}
	}()
	b = s.build(raw, s.now())
	if b == nil {
		return nil, errors.New("building the board returned nothing")
	}
	return b, nil
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	body, err := json.Marshal(v)
	if err != nil {
		status = http.StatusInternalServerError
		body = []byte(`{"error":"encoding the response failed","code":"internal"}`)
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

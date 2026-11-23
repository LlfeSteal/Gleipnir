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
	"time"

	"gleipnir/internal/board"
	"gleipnir/internal/cache"
)

// Source hands the raw board data to the server: the GitLab client, or the demo dataset.
type Source interface {
	Fetch(ctx context.Context) (*board.Raw, error)
}

// SourceFunc adapts a function to Source.
type SourceFunc func(ctx context.Context) (*board.Raw, error)

func (f SourceFunc) Fetch(ctx context.Context) (*board.Raw, error) { return f(ctx) }

// Options configures a Server. Only Source is required.
type Options struct {
	Source Source
	Build  func(*board.Raw, time.Time) *board.Board // default board.Build
	Now    func() time.Time                         // default time.Now
	// Cache: Fresh is CACHE_TTL; Now and Logger default to the server's.
	Cache     cache.Options
	Demo      bool
	GitLabURL string
	Group     string
	// Token is never served: it is only scrubbed from the error messages, just in case.
	Token  string
	Logger *slog.Logger
}

// Server answers the API requests. Every visitor sees the same board, read with the one
// server-wide token, so there is a single cache key.
type Server struct {
	source Source
	build  func(*board.Raw, time.Time) *board.Board
	now    func() time.Time
	cache  *cache.Store
	log    *slog.Logger

	demo      bool
	gitlabURL string
	group     string
	token     string
}

const boardKey = "board"

func NewServer(opts Options) *Server {
	s := &Server{
		source:    opts.Source,
		build:     opts.Build,
		now:       opts.Now,
		log:       opts.Logger,
		demo:      opts.Demo,
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
	s.cache = cache.New(cacheOpts)
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

// Prefetch starts syncing the board in the background, so the first visitor doesn't wait.
func (s *Server) Prefetch() {
	s.cache.Prefetch(boardKey, s.fetchBoard)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":    "ok",
		"demo":      s.demo,
		"gitlabUrl": s.gitlabURL,
		"group":     s.group,
	})
}

// handleBoard serves the cached board (see cache.Store.Get). ?refresh=1 waits for a full
// sync. X-Cache says how it was served, X-Fetched-At when the data was fetched.
func (s *Server) handleBoard(w http.ResponseWriter, r *http.Request) {
	refresh := r.URL.Query().Get("refresh")
	entry, state, err := s.cache.Get(r.Context(), boardKey, refresh == "1" || refresh == "true", s.fetchBoard)
	if err != nil {
		if r.Context().Err() != nil {
			return // the client is gone; the fetch goes on and fills the cache
		}
		s.writeError(w, err)
		return
	}
	h := w.Header()
	for name, value := range entry.Header {
		h.Set(name, value)
	}
	h.Set("Content-Type", "application/json; charset=utf-8")
	h.Set("Cache-Control", "no-store")
	h.Set("X-Cache", string(state))
	h.Set("X-Fetched-At", entry.FetchedAt.UTC().Format(time.RFC3339))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(entry.Body)
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

// fetchBoard reads the source, builds the board and encodes it once for every request served
// from the cache. It runs detached from the request (see cache.FetchFunc).
func (s *Server) fetchBoard(ctx context.Context) (cache.Data, error) {
	started := time.Now()
	raw, err := s.source.Fetch(ctx)
	if err != nil {
		return cache.Data{}, &sourceError{err: err}
	}
	if raw == nil {
		return cache.Data{}, errors.New("the source returned no data")
	}
	b, err := s.safeBuild(raw)
	if err != nil {
		return cache.Data{}, err
	}
	body, err := json.Marshal(b)
	if err != nil {
		return cache.Data{}, fmt.Errorf("encoding the board: %w", err)
	}
	s.log.Info("board synced",
		"iterations", len(b.Iterations), "epics", len(b.Epics), "issues", len(b.Issues),
		"links", len(b.Links), "ignoredIssues", b.IgnoredIssues,
		"kb", len(body)/1024, "duration", time.Since(started).Round(time.Millisecond))
	return cache.Data{Body: body}, nil
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

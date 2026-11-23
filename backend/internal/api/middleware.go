package api

import (
	"log/slog"
	"net/http"
	"runtime/debug"
	"time"
)

// statusRecorder remembers the status written by a handler, for the request log.
type statusRecorder struct {
	http.ResponseWriter
	status int // 0 when nothing was written (the client went away)
}

func (r *statusRecorder) WriteHeader(status int) {
	if r.status == 0 {
		r.status = status
	}
	r.ResponseWriter.WriteHeader(status)
}

func (r *statusRecorder) Write(b []byte) (int, error) {
	if r.status == 0 {
		r.status = http.StatusOK
	}
	return r.ResponseWriter.Write(b)
}

func (r *statusRecorder) Unwrap() http.ResponseWriter { return r.ResponseWriter }

// secureHeaders sets the headers every API response carries, errors included. nosniff keeps
// a browser from running the JSON (which holds GitLab titles) as anything but JSON, when the
// backend is reached without the nginx in front.
func secureHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		next.ServeHTTP(w, r)
	})
}

// logRequests logs every request with its status and duration.
func (s *Server) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		rec := &statusRecorder{ResponseWriter: w}
		next.ServeHTTP(rec, r)
		level := slog.LevelInfo
		if r.URL.Path == "/api/health" && rec.status == http.StatusOK {
			level = slog.LevelDebug // the Docker healthcheck polls it every few seconds
		}
		s.log.Log(r.Context(), level, "request",
			"method", r.Method, "path", r.URL.Path, "status", rec.status,
			"duration", time.Since(started).Round(time.Millisecond))
	})
}

// recoverPanics turns a handler panic into a 500 JSON error instead of a dropped connection.
func (s *Server) recoverPanics(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			p := recover()
			if p == nil {
				return
			}
			if p == http.ErrAbortHandler {
				panic(p) // net/http's way to abort a response silently
			}
			s.log.Error("handler panicked", "method", r.Method, "path", r.URL.Path, "panic", p, "stack", string(debug.Stack()))
			if rec, ok := w.(*statusRecorder); ok && rec.status != 0 {
				return // the response has started: too late for an error body
			}
			writeJSON(w, http.StatusInternalServerError, errorBody{Error: "internal server error", Code: CodeInternal})
		}()
		next.ServeHTTP(w, r)
	})
}

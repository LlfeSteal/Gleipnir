package api

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"gleipnir/internal/board"
)

func TestSourceFuncAdaptsAFunction(t *testing.T) {
	want := &board.Raw{GitLabURL: "https://gitlab.test"}
	var src Source = SourceFunc(func(context.Context) (*board.Raw, error) { return want, nil })
	if got, err := src.Fetch(context.Background()); got != want || err != nil {
		t.Fatalf("Fetch = %v, %v", got, err)
	}
}

// Without Build, Now and Logger, the server uses board.Build, time.Now and slog.Default.
func TestNewServerDefaults(t *testing.T) {
	defer func(l *slog.Logger) { slog.SetDefault(l) }(slog.Default())
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	src := SourceFunc(func(context.Context) (*board.Raw, error) { return board.DemoRaw(time.Now()), nil })
	rec := get(NewServer(Options{Source: src}).Handler(), "/api/board")
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	fetched, err := time.Parse(time.RFC3339, rec.Header().Get("X-Fetched-At"))
	if err != nil || time.Since(fetched) > time.Minute {
		t.Fatalf("X-Fetched-At %q is not the real clock (%v)", rec.Header().Get("X-Fetched-At"), err)
	}
	if !strings.Contains(rec.Body.String(), `"epics":[{`) {
		t.Fatalf("the demo board was not built with board.Build: %.200s", rec.Body)
	}
}

func TestRefreshTrueForcesASync(t *testing.T) {
	src := &fakeSource{}
	_, h, clock := newTestServer(t, src, fakeBuild)
	get(h, "/api/board")
	clock.Add(time.Minute) // past MinRefresh, still fresh
	if v := boardVersion(t, get(h, "/api/board?refresh=true")); v != "v2" {
		t.Fatalf("refresh=true served %s, want a new sync", v)
	}
	if v := boardVersion(t, get(h, "/api/board?refresh=yes")); v != "v2" {
		t.Fatalf("refresh=yes is not a refresh: got %s", v)
	}
}

// A client that leaves during a sync gets nothing written; the sync still fills the cache.
func TestClientGoneDuringASyncWritesNothing(t *testing.T) {
	src := &fakeSource{release: make(chan struct{})}
	_, h, _ := newTestServer(t, src, fakeBuild)
	ctx, cancel := context.WithCancel(context.Background())
	rec := httptest.NewRecorder()
	served := make(chan struct{})
	go func() {
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/board", nil).WithContext(ctx))
		close(served)
	}()
	waitFor(t, func() bool { return atomic.LoadInt32(&src.calls) == 1 })
	cancel()
	<-served
	if rec.Body.Len() != 0 || rec.Header().Get("Content-Type") != "" {
		t.Fatalf("wrote a response to a gone client: %q %v", rec.Body, rec.Header())
	}
	close(src.release)
	waitFor(t, func() bool { return get(h, "/api/board").Header().Get("X-Cache") == "HIT" })
}

func TestNilRawIs500(t *testing.T) {
	src := SourceFunc(func(context.Context) (*board.Raw, error) { return nil, nil })
	_, h, _ := newTestServer(t, src, fakeBuild)
	rec := get(h, "/api/board")
	if rec.Code != http.StatusInternalServerError || decodeError(t, rec)["code"] != CodeInternal {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
}

func TestWriteJSONFallsBackWhenEncodingFails(t *testing.T) {
	rec := httptest.NewRecorder()
	writeJSON(rec, http.StatusOK, map[string]float64{"x": math.NaN()})
	if rec.Code != http.StatusInternalServerError || decodeError(t, rec)["code"] != CodeInternal {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	if rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("Cache-Control %q", rec.Header().Get("Cache-Control"))
	}
}

func TestStatusRecorder(t *testing.T) {
	t.Run("Write without WriteHeader records 200", func(t *testing.T) {
		rec := &statusRecorder{ResponseWriter: httptest.NewRecorder()}
		_, _ = rec.Write([]byte("x"))
		rec.WriteHeader(http.StatusTeapot) // too late: ignored, like net/http
		if rec.status != http.StatusOK {
			t.Fatalf("status %d", rec.status)
		}
	})
	t.Run("the first WriteHeader wins", func(t *testing.T) {
		rec := &statusRecorder{ResponseWriter: httptest.NewRecorder()}
		rec.WriteHeader(http.StatusNotFound)
		_, _ = rec.Write([]byte("x"))
		if rec.status != http.StatusNotFound {
			t.Fatalf("status %d", rec.status)
		}
	})
	t.Run("Unwrap gives http.ResponseController the real writer", func(t *testing.T) {
		inner := httptest.NewRecorder()
		rec := &statusRecorder{ResponseWriter: inner}
		if rec.Unwrap() != inner {
			t.Fatal("Unwrap does not return the wrapped writer")
		}
		if err := http.NewResponseController(rec).Flush(); err != nil || !inner.Flushed {
			t.Fatalf("Flush through the recorder: %v, flushed %v", err, inner.Flushed)
		}
	})
}

func TestRecoverPanicsAfterTheResponseStarted(t *testing.T) {
	var logs syncBuffer
	s := NewServer(Options{Source: &fakeSource{}, Build: fakeBuild, Logger: slog.New(slog.NewTextHandler(&logs, nil))})
	h := s.logRequests(s.recoverPanics(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, `{"partial":`)
		panic("bug mid-response")
	})))
	rec := get(h, "/api/anything")
	if rec.Code != http.StatusOK || rec.Body.String() != `{"partial":` {
		t.Fatalf("an error body was appended to a started response: %d %q", rec.Code, rec.Body)
	}
	if !strings.Contains(logs.String(), "handler panicked") {
		t.Fatalf("the panic is not logged:\n%s", logs.String())
	}
}

func TestRecoverPanicsLetsErrAbortHandlerThrough(t *testing.T) {
	s, _, _ := newTestServer(t, &fakeSource{}, fakeBuild)
	h := s.recoverPanics(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { panic(http.ErrAbortHandler) }))
	defer func() {
		if p := recover(); !errors.Is(p.(error), http.ErrAbortHandler) {
			t.Fatalf("recovered %v, want http.ErrAbortHandler", p)
		}
	}()
	get(h, "/api/anything")
	t.Fatal("http.ErrAbortHandler was swallowed")
}

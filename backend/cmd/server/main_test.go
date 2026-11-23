package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"gleipnir/internal/board"
	"gleipnir/internal/config"
	"gleipnir/internal/gitlab"
)

func TestNewSource(t *testing.T) {
	if _, ok := newSource(config.Config{Demo: true}).(demoSource); !ok {
		t.Fatal("demo mode must serve the demo dataset")
	}
	if _, ok := newSource(config.Config{GitLabURL: "https://gitlab.com", Group: "org"}).(*gitlab.Client); !ok {
		t.Fatal("without demo mode, the source is GitLab")
	}
}

func TestDemoSourceFetch(t *testing.T) {
	raw, err := demoSource{}.Fetch(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if raw == nil || len(raw.Iterations) == 0 || len(raw.Items) == 0 {
		t.Fatalf("the demo dataset is empty: %+v", raw)
	}
}

func TestDemoSourceFetchItems(t *testing.T) {
	items, err := demoSource{}.FetchItems(context.Background(), []string{"plateforme/atlas/api"})
	if err != nil || len(items) == 0 {
		t.Fatalf("FetchItems = %d items, %v", len(items), err)
	}
	for _, it := range items {
		if g := board.ItemGroup(it); g != "plateforme/atlas/api" {
			t.Errorf("item %s of group %s is outside the scope", it.ID, g)
		}
	}
	if items, _ := (demoSource{}).FetchItems(context.Background(), nil); len(items) != 0 {
		t.Errorf("an empty scope gave %d items", len(items))
	}
}

// env returns a getenv over vars.
func env(vars map[string]string) func(string) string {
	return func(key string) string { return vars[key] }
}

// syncBuffer is a log sink safe for the server's goroutines.
type syncBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *syncBuffer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}

func (s *syncBuffer) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.String()
}

func discard() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

// freePort returns a port nothing listens on (as of the call).
func freePort(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	return strconv.Itoa(l.Addr().(*net.TCPAddr).Port)
}

func TestRunRejectsAnInvalidConfiguration(t *testing.T) {
	cases := map[string]map[string]string{
		"no group outside demo mode": {},
		"port not a number":          {"GLEIPNIR_DEMO": "1", "PORT": "abc"},
		"port zero":                  {"GLEIPNIR_DEMO": "1", "PORT": "0"},
		"port above 65535":           {"GLEIPNIR_DEMO": "1", "PORT": "65536"},
		"demo not a boolean":         {"GLEIPNIR_DEMO": "maybe"},
	}
	for name, vars := range cases {
		t.Run(name, func(t *testing.T) {
			err := run(context.Background(), env(vars), discard())
			if err == nil || !strings.Contains(err.Error(), "invalid configuration") {
				t.Fatalf("want an invalid configuration error, got %v", err)
			}
		})
	}
}

// waitHealthy polls the health check until the server answers, and returns its body.
func waitHealthy(t *testing.T, port string) map[string]any {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		res, err := http.Get("http://127.0.0.1:" + port + "/api/health")
		if err == nil {
			defer res.Body.Close()
			var health map[string]any
			if err := json.NewDecoder(res.Body).Decode(&health); err != nil {
				t.Fatal(err)
			}
			return health
		}
		if time.Now().After(deadline) {
			t.Fatalf("the server never answered: %v", err)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

// wait returns what done yields, failing the test after 5 s.
func wait[T any](t *testing.T, done <-chan T) T {
	t.Helper()
	select {
	case v := <-done:
		return v
	case <-time.After(5 * time.Second):
		t.Fatal("the server did not stop after the context was cancelled")
		panic("unreachable")
	}
}

func TestRunServesThenStopsGracefully(t *testing.T) {
	port := freePort(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- run(ctx, env(map[string]string{"GLEIPNIR_DEMO": "1", "PORT": port}), discard()) }()

	if health := waitHealthy(t, port); health["status"] != "ok" || health["demo"] != true {
		t.Fatalf("health %v", health)
	}
	cancel()
	if err := wait(t, done); err != nil {
		t.Fatalf("a graceful shutdown returns nil, got %v", err)
	}
}

// SIGTERM (as sent by docker stop) shuts the server down; a connection still active after the
// shutdown timeout is closed rather than kept waiting.
func TestServeStopsOnSIGTERMAndClosesStalledConnections(t *testing.T) {
	defer func(d time.Duration) { shutdownTimeout = d }(shutdownTimeout)
	shutdownTimeout = 50 * time.Millisecond
	defer func(l *slog.Logger) { slog.SetDefault(l) }(slog.Default())

	port := freePort(t)
	var logs syncBuffer
	done := make(chan int, 1)
	go func() { done <- serve(env(map[string]string{"GLEIPNIR_DEMO": "1", "PORT": port}), &logs) }()
	waitHealthy(t, port) // serve now handles SIGTERM: sending it won't kill the test binary

	// A request whose headers never end keeps its connection active: Shutdown cannot drain it.
	conn, err := net.Dial("tcp", "127.0.0.1:"+port)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if _, err := io.WriteString(conn, "GET /api/health HTTP/1.1\r\nHost: x\r\n"); err != nil {
		t.Fatal(err)
	}
	time.Sleep(50 * time.Millisecond) // let the server read the partial request

	if err := syscall.Kill(os.Getpid(), syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	if code := wait(t, done); code != 0 {
		t.Fatalf("exit code %d, want 0\n%s", code, logs.String())
	}
	if out := logs.String(); !strings.Contains(out, "shutdown timed out") || !strings.Contains(out, "msg=stopped") {
		t.Fatalf("missing the forced close in the logs:\n%s", out)
	}
}

func TestServeExitsWithOneOnError(t *testing.T) {
	defer func(l *slog.Logger) { slog.SetDefault(l) }(slog.Default())
	var logs syncBuffer
	if code := serve(env(nil), &logs); code != 1 {
		t.Fatalf("exit code %d, want 1", code)
	}
	if out := logs.String(); !strings.Contains(out, "level=ERROR") || !strings.Contains(out, "GITLAB_GROUP") {
		t.Fatalf("the error is not logged:\n%s", out)
	}
}

func TestRunReturnsTheListenErrorAndLogsWarnings(t *testing.T) {
	busy, err := net.Listen("tcp", ":0")
	if err != nil {
		t.Fatal(err)
	}
	defer busy.Close()
	port := strconv.Itoa(busy.Addr().(*net.TCPAddr).Port)
	// The prefetch reaches this fake GitLab, which turns it away at once.
	gl := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer gl.Close()

	var logs syncBuffer
	logger := slog.New(slog.NewTextHandler(&logs, nil))
	vars := map[string]string{"GITLAB_URL": gl.URL, "GITLAB_GROUP": "org", "PORT": port}
	err = run(context.Background(), env(vars), logger)
	var opErr *net.OpError
	if !errors.As(err, &opErr) {
		t.Fatalf("want the listen error, got %v", err)
	}
	out := logs.String()
	for _, want := range []string{"level=WARN", "GITLAB_TOKEN is empty", "tokenSet=false"} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in the logs:\n%s", want, out)
		}
	}
}

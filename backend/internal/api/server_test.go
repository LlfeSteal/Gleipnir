package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"gleipnir/internal/board"
	"gleipnir/internal/cache"
	"gleipnir/internal/gitlab"
)

// fakeClock lets the tests age the cache.
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

// fakeSource counts its calls; it waits for release (when set) and answers err (when set).
// A full read holds one epic per group, "<group>#v<n>"; a scoped read one per scope group,
// "<group>#s<n>".
type fakeSource struct {
	calls     int32 // full reads
	itemCalls int32 // scoped reads
	release   chan struct{}
	nilRaw    bool
	mu        sync.Mutex
	err       error
	scopes    [][]string
}

func (f *fakeSource) Fetch(ctx context.Context) (*board.Raw, error) {
	n := atomic.AddInt32(&f.calls, 1)
	if f.release != nil {
		<-f.release
	}
	f.mu.Lock()
	err := f.err
	f.mu.Unlock()
	if err != nil || f.nilRaw {
		return nil, err
	}
	v := fmt.Sprintf("v%d", n)
	return &board.Raw{
		GitLabURL: "https://gitlab.test",
		RootGroup: board.Group{Path: "org", Name: v},
		Groups:    []board.Group{{Path: "org/a", Name: "A"}},
		Items:     []board.RawItem{testEpic("org", v), testEpic("org/a", v)},
	}, nil
}

func (f *fakeSource) FetchItems(ctx context.Context, groups []string) ([]board.RawItem, error) {
	n := atomic.AddInt32(&f.itemCalls, 1)
	f.mu.Lock()
	err := f.err
	f.scopes = append(f.scopes, groups)
	f.mu.Unlock()
	if err != nil {
		return nil, err
	}
	var items []board.RawItem
	for _, g := range groups {
		items = append(items, testEpic(g, fmt.Sprintf("s%d", n)))
	}
	return items, nil
}

func testEpic(group, version string) board.RawItem {
	return board.RawItem{ID: group + "#" + version, Kind: board.KindEpic, NamespacePath: group}
}

func (f *fakeSource) setErr(err error) {
	f.mu.Lock()
	f.err = err
	f.mu.Unlock()
}

// fakeBuild turns the raw data into a minimal board, keeping the root group name as a version.
func fakeBuild(raw *board.Raw, now time.Time) *board.Board {
	b := &board.Board{SyncedAt: now, GitLabURL: raw.GitLabURL, RootGroup: raw.RootGroup, Current: -1,
		Groups: append([]board.Group{raw.RootGroup}, raw.Groups...)}
	for _, it := range raw.Items {
		b.Epics = append(b.Epics, board.Epic{ID: it.ID})
	}
	return b
}

var t0 = time.Date(2026, 11, 23, 9, 30, 0, 0, time.FixedZone("CET", 3600))

func newTestServer(t *testing.T, src Source, build func(*board.Raw, time.Time) *board.Board) (*Server, http.Handler, *fakeClock) {
	t.Helper()
	clock := &fakeClock{now: t0}
	s := NewServer(Options{
		Source:    src,
		Build:     build,
		Now:       clock.Now,
		Cache:     cache.Options{Interval: 5 * time.Minute, FetchTimeout: time.Minute},
		GitLabURL: "https://gitlab.test",
		Group:     "org",
		Token:     "glpat-secret",
		Logger:    slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	return s, s.Handler(), clock
}

func get(h http.Handler, target string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, target, nil))
	return rec
}

// boardVersion decodes a board response and returns its version (the root group name).
func boardVersion(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	return decodeBoard(t, rec).RootGroup.Name
}

func decodeBoard(t *testing.T, rec *httptest.ResponseRecorder) board.Board {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	var b board.Board
	if err := json.Unmarshal(rec.Body.Bytes(), &b); err != nil {
		t.Fatalf("decoding %s: %v", rec.Body, err)
	}
	return b
}

func epicIDs(b board.Board) string {
	var ids []string
	for _, e := range b.Epics {
		ids = append(ids, e.ID)
	}
	return strings.Join(ids, " ")
}

func decodeError(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Fatalf("Content-Type %q", ct)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decoding %s: %v", rec.Body, err)
	}
	if len(body) != 2 || body["error"] == "" || body["code"] == "" {
		t.Fatalf("want {error, code}, got %s", rec.Body)
	}
	return body
}

func waitFor(t *testing.T, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for !ok() {
		if time.Now().After(deadline) {
			t.Fatal("condition not met in time")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestHealth(t *testing.T) {
	_, h, _ := newTestServer(t, &fakeSource{}, fakeBuild)
	rec := get(h, "/api/health")
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	want := map[string]any{"status": "ok", "gitlabUrl": "https://gitlab.test", "group": "org"}
	if fmt.Sprint(body) != fmt.Sprint(want) {
		t.Fatalf("got %v, want %v", body, want)
	}
	if strings.Contains(rec.Body.String(), "glpat-secret") {
		t.Fatal("token served")
	}
}

func TestBoardMissThenHit(t *testing.T) {
	src := &fakeSource{}
	_, h, clock := newTestServer(t, src, fakeBuild)

	rec := get(h, "/api/board")
	if v := boardVersion(t, rec); v != "v1" {
		t.Fatalf("first: %s", v)
	}
	if got := rec.Header().Get("X-Cache"); got != "MISS" {
		t.Fatalf("X-Cache %q, want MISS", got)
	}
	if got := rec.Header().Get("X-Fetched-At"); got != "2026-11-23T08:30:00Z" {
		t.Fatalf("X-Fetched-At %q, want RFC 3339 UTC", got)
	}
	if got := rec.Header().Get("Content-Type"); got != "application/json; charset=utf-8" {
		t.Fatalf("Content-Type %q", got)
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control %q", got)
	}
	b := decodeBoard(t, rec)
	if !b.SyncedAt.Equal(t0) {
		t.Fatalf("Build got now=%v, want the injected clock %v", b.SyncedAt, t0)
	}
	for _, g := range b.Groups {
		if g.SyncedAt == nil || !g.SyncedAt.Equal(t0) || g.SyncedAt.Location() != time.UTC {
			t.Errorf("group %s syncedAt = %v, want %v in UTC", g.Path, g.SyncedAt, t0)
		}
	}

	// Requests never start a sync once there is data: the periodic sync does (Run).
	clock.Add(time.Hour)
	rec = get(h, "/api/board")
	if v := boardVersion(t, rec); v != "v1" || rec.Header().Get("X-Cache") != "HIT" {
		t.Fatalf("an hour later: %s %s", v, rec.Header().Get("X-Cache"))
	}
	if got := rec.Header().Get("X-Fetched-At"); got != "2026-11-23T08:30:00Z" {
		t.Fatalf("X-Fetched-At %q must not move on a HIT", got)
	}
	if n := atomic.LoadInt32(&src.calls); n != 1 {
		t.Fatalf("source fetched %d times, want 1", n)
	}
}

func TestRefreshReadsTheScope(t *testing.T) {
	src := &fakeSource{}
	_, h, clock := newTestServer(t, src, fakeBuild)
	boardVersion(t, get(h, "/api/board"))
	// Right after a sync, refresh is ignored: spamming it must not walk GitLab.
	rec := get(h, "/api/board?refresh=1&groups=org/a")
	if ids := epicIDs(decodeBoard(t, rec)); ids != "org#v1 org/a#v1" || rec.Header().Get("X-Cache") != "HIT" {
		t.Fatalf("throttled refresh: %s %s", ids, rec.Header().Get("X-Cache"))
	}
	clock.Add(10 * time.Second)
	rec = get(h, "/api/board?refresh=1&groups=org/a,nope")
	b := decodeBoard(t, rec)
	if ids := epicIDs(b); ids != "org#v1 org/a#s1" || rec.Header().Get("X-Cache") != "MISS" {
		t.Fatalf("refresh: %s %s", ids, rec.Header().Get("X-Cache"))
	}
	if fmt.Sprint(src.scopes) != "[[org/a]]" {
		t.Errorf("scopes read = %v", src.scopes)
	}
	// The root group was not read again: the board is as old as it.
	if got := rec.Header().Get("X-Fetched-At"); got != "2026-11-23T08:30:00Z" {
		t.Errorf("X-Fetched-At %q, want the oldest group's", got)
	}
	if g := b.Groups[1]; g.Path != "org/a" || !g.SyncedAt.Equal(t0.Add(10*time.Second)) {
		t.Errorf("org/a = %+v", g)
	}
	if n := atomic.LoadInt32(&src.calls); n != 1 {
		t.Errorf("%d full reads, want 1", n)
	}
	rec = get(h, "/api/board")
	if ids := epicIDs(decodeBoard(t, rec)); ids != "org#v1 org/a#s1" || rec.Header().Get("X-Cache") != "HIT" {
		t.Fatalf("after refresh: %s %s", ids, rec.Header().Get("X-Cache"))
	}
}

func TestRefreshNeedsAKnownGroup(t *testing.T) {
	src := &fakeSource{}
	_, h, _ := newTestServer(t, src, fakeBuild)
	boardVersion(t, get(h, "/api/board"))
	for _, target := range []string{"/api/board?refresh=1", "/api/board?refresh=1&groups=", "/api/board?refresh=1&groups=nope,"} {
		rec := get(h, target)
		if rec.Code != http.StatusBadRequest || decodeError(t, rec)["code"] != CodeInvalidScope {
			t.Errorf("%s: status %d: %s", target, rec.Code, rec.Body)
		}
	}
	if n := atomic.LoadInt32(&src.itemCalls) + atomic.LoadInt32(&src.calls); n != 1 {
		t.Errorf("%d reads, want only the first full one", n)
	}
}

func TestScopedRefreshErrorIsMapped(t *testing.T) {
	src := &fakeSource{}
	_, h, clock := newTestServer(t, src, fakeBuild)
	boardVersion(t, get(h, "/api/board"))
	clock.Add(time.Minute)
	src.setErr(gitlab.ErrUnauthorized)
	rec := get(h, "/api/board?refresh=1&groups=org/a")
	if rec.Code != http.StatusUnauthorized || decodeError(t, rec)["code"] != CodeUnauthorized {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	src.setErr(errors.New("gitlab answered 500"))
	if rec := get(h, "/api/board?refresh=1&groups=org/a"); rec.Code != http.StatusBadGateway {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	// The board in place is still served.
	if v := boardVersion(t, get(h, "/api/board")); v != "v1" {
		t.Fatalf("board %s", v)
	}
}

func TestConcurrentRequestsShareOneFetch(t *testing.T) {
	src := &fakeSource{release: make(chan struct{})}
	_, h, _ := newTestServer(t, src, fakeBuild)

	var wg sync.WaitGroup
	recs := make([]*httptest.ResponseRecorder, 10)
	for i := range recs {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			target := "/api/board"
			if i%2 == 0 {
				target += "?refresh=1&groups=org/a" // no data yet: waits for the full sync
			}
			recs[i] = get(h, target)
		}(i)
	}
	waitFor(t, func() bool { return atomic.LoadInt32(&src.calls) == 1 })
	time.Sleep(50 * time.Millisecond) // let every request join
	close(src.release)
	wg.Wait()

	if n := atomic.LoadInt32(&src.calls); n != 1 {
		t.Fatalf("source fetched %d times, want 1", n)
	}
	if n := atomic.LoadInt32(&src.itemCalls); n != 0 {
		t.Fatalf("%d scoped reads, want none", n)
	}
	for _, rec := range recs {
		if v := boardVersion(t, rec); v != "v1" {
			t.Fatalf("got %s, want v1", v)
		}
	}
}

func TestRunWarmsTheCache(t *testing.T) {
	src := &fakeSource{}
	s, h, _ := newTestServer(t, src, fakeBuild)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go s.Run(ctx)
	waitFor(t, func() bool { return atomic.LoadInt32(&src.calls) == 1 })
	waitFor(t, func() bool { return get(h, "/api/board").Header().Get("X-Cache") == "HIT" })
	if n := atomic.LoadInt32(&src.calls); n != 1 {
		t.Fatalf("source fetched %d times, want 1", n)
	}
}

// timeoutErr is a net.Error, as a dial or read timeout would be.
type timeoutErr struct{}

func (timeoutErr) Error() string   { return "i/o timeout" }
func (timeoutErr) Timeout() bool   { return true }
func (timeoutErr) Temporary() bool { return true }

var _ net.Error = timeoutErr{}

func TestErrorMapping(t *testing.T) {
	cases := []struct {
		name   string
		err    error
		status int
		code   string
	}{
		{"unauthorized", fmt.Errorf("query: %w", gitlab.ErrUnauthorized), 401, "unauthorized"},
		{"group not found", gitlab.ErrGroupNotFound, 404, "group_not_found"},
		{"premium", fmt.Errorf("epics: %w", gitlab.ErrPremiumRequired), 502, "premium_required"},
		{"no cadence", gitlab.ErrNoCadence, 502, "cadence_not_found"},
		{"cadence not found", fmt.Errorf("%w: Sprints", gitlab.ErrCadenceNotFound), 502, "cadence_not_found"},
		{"deadline", fmt.Errorf("work items: %w", context.DeadlineExceeded), 502, "gitlab_unreachable"},
		{"net error", &net.OpError{Op: "dial", Net: "tcp", Err: timeoutErr{}}, 502, "gitlab_unreachable"},
		{"other gitlab failure", errors.New("gitlab answered 500"), 502, "gitlab_unreachable"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, h, _ := newTestServer(t, &fakeSource{err: c.err}, fakeBuild)
			rec := get(h, "/api/board")
			if rec.Code != c.status {
				t.Fatalf("status %d, want %d (%s)", rec.Code, c.status, rec.Body)
			}
			body := decodeError(t, rec)
			if body["code"] != c.code {
				t.Fatalf("code %v, want %s", body["code"], c.code)
			}
			if body["error"] != c.err.Error() {
				t.Fatalf("error %v, want the technical message %q", body["error"], c.err.Error())
			}
			if rec.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("errors must not be cached by the browser")
			}
		})
	}
}

func TestClassifyOwnErrors(t *testing.T) {
	// Outside the source, a deadline or a network error still means GitLab; anything else is ours.
	if _, code := classify(context.DeadlineExceeded); code != CodeGitLabUnreachable {
		t.Fatalf("deadline: %s", code)
	}
	if status, code := classify(errors.New("encoding the board")); status != 500 || code != CodeInternal {
		t.Fatalf("other: %d %s", status, code)
	}
}

func TestErrorsAreNotCached(t *testing.T) {
	src := &fakeSource{err: gitlab.ErrUnauthorized}
	_, h, _ := newTestServer(t, src, fakeBuild)
	if rec := get(h, "/api/board"); rec.Code != 401 {
		t.Fatalf("status %d", rec.Code)
	}
	src.setErr(nil)
	if v := boardVersion(t, get(h, "/api/board")); v != "v2" {
		t.Fatalf("got %s, want a new fetch", v)
	}
}

func TestTokenIsScrubbedFromErrors(t *testing.T) {
	_, h, _ := newTestServer(t, &fakeSource{err: errors.New("GET https://x?private_token=glpat-secret failed")}, fakeBuild)
	rec := get(h, "/api/board")
	if strings.Contains(rec.Body.String(), "glpat-secret") {
		t.Fatalf("token served: %s", rec.Body)
	}
}

func TestBuildPanicIs500(t *testing.T) {
	panicky := func(*board.Raw, time.Time) *board.Board { panic("index out of range") }
	_, h, _ := newTestServer(t, &fakeSource{}, panicky)
	rec := get(h, "/api/board")
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	if body := decodeError(t, rec); body["code"] != "internal" {
		t.Fatalf("code %v", body["code"])
	}
	// The server survived: the health check still answers.
	if rec := get(h, "/api/health"); rec.Code != http.StatusOK {
		t.Fatalf("health %d", rec.Code)
	}
}

func TestNilBoardIs500(t *testing.T) {
	_, h, _ := newTestServer(t, &fakeSource{}, func(*board.Raw, time.Time) *board.Board { return nil })
	if rec := get(h, "/api/board"); rec.Code != http.StatusInternalServerError || decodeError(t, rec)["code"] != "internal" {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
}

func TestHandlerPanicIs500(t *testing.T) {
	s, _, _ := newTestServer(t, &fakeSource{}, fakeBuild)
	h := s.logRequests(s.recoverPanics(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { panic("bug") })))
	rec := get(h, "/api/anything")
	if rec.Code != http.StatusInternalServerError || decodeError(t, rec)["code"] != "internal" {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
}

func TestUnknownRoutes(t *testing.T) {
	_, h, _ := newTestServer(t, &fakeSource{}, fakeBuild)
	for _, path := range []string{"/api/nope", "/api/board/extra", "/"} {
		rec := get(h, path)
		if rec.Code != http.StatusNotFound || decodeError(t, rec)["code"] != "not_found" {
			t.Fatalf("%s: status %d: %s", path, rec.Code, rec.Body)
		}
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/board", nil))
	if rec.Code != http.StatusMethodNotAllowed || decodeError(t, rec)["code"] != "method_not_allowed" {
		t.Fatalf("POST: status %d: %s", rec.Code, rec.Body)
	}
}

func TestBoardBodyIsTheBuiltBoard(t *testing.T) {
	_, h, _ := newTestServer(t, &fakeSource{}, fakeBuild)
	rec := get(h, "/api/board")
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"syncedAt", "gitlabUrl", "rootGroup", "cadence", "iterations", "current", "epics", "issues", "links", "criticalPath", "ignoredIssues"} {
		if _, ok := body[key]; !ok {
			t.Fatalf("missing %q in %s", key, rec.Body)
		}
	}
}

func TestRequestLog(t *testing.T) {
	var buf syncBuffer
	s := NewServer(Options{Source: &fakeSource{}, Build: fakeBuild, Logger: slog.New(slog.NewTextHandler(&buf, nil))})
	get(s.Handler(), "/api/health") // healthcheck polls: debug only
	if out := buf.String(); out != "" {
		t.Fatalf("a successful health check is logged at info: %s", out)
	}
	get(s.Handler(), "/api/nope")
	out := buf.String()
	for _, want := range []string{"msg=request", "method=GET", "path=/api/nope", "status=404", "duration="} {
		if !strings.Contains(out, want) {
			t.Fatalf("missing %q in %s", want, out)
		}
	}
}

type syncBuffer struct {
	mu sync.Mutex
	b  strings.Builder
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

func TestEveryResponseIsNosniff(t *testing.T) {
	src := &fakeSource{}
	_, h, _ := newTestServer(t, src, fakeBuild)
	for _, target := range []string{"/api/health", "/api/board", "/api/nope"} {
		if got := get(h, target).Header().Get("X-Content-Type-Options"); got != "nosniff" {
			t.Errorf("%s: X-Content-Type-Options = %q", target, got)
		}
	}
	src.setErr(gitlab.ErrUnauthorized)
	_, h, _ = newTestServer(t, src, fakeBuild)
	rec := get(h, "/api/board")
	if rec.Code != http.StatusUnauthorized || rec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Errorf("error: %d %q", rec.Code, rec.Header().Get("X-Content-Type-Options"))
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/board", nil))
	if rec.Code != http.StatusMethodNotAllowed || rec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Errorf("POST: %d %q", rec.Code, rec.Header().Get("X-Content-Type-Options"))
	}
}

func TestRateLimitIsGitLabUnreachable(t *testing.T) {
	src := &fakeSource{}
	src.setErr(errors.New("gitlab rate limited the requests (HTTP 429), retry in 1m0s"))
	_, h, _ := newTestServer(t, src, fakeBuild)
	rec := get(h, "/api/board")
	body := decodeError(t, rec)
	if rec.Code != http.StatusBadGateway || body["code"] != CodeGitLabUnreachable || !strings.Contains(body["error"].(string), "rate limited") {
		t.Errorf("got %d %v", rec.Code, body)
	}
}

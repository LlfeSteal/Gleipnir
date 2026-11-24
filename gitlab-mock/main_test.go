package main

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"
)

func env(vars map[string]string) func(string) string {
	return func(key string) string { return vars[key] }
}

func TestConfig(t *testing.T) {
	with := func(vars map[string]string) map[string]string {
		out := map[string]string{"GITLAB_MOCK_TOKEN": token}
		for k, v := range vars {
			out[k] = v
		}
		return out
	}
	cases := map[string]struct {
		vars map[string]string
		want config
		err  string
	}{
		"defaults": {with(nil), config{"8080", 10, token, layout{}}, ""},
		"set": {with(map[string]string{
			"PORT": " 9000 ", "PAGE_SIZE": "100", "GITLAB_MOCK_TOKEN": " t ",
			"GITLAB_MOCK_ROOT": "/demo/gleipnir/", "GITLAB_MOCK_ROOT_NAME": " Gleipnir ", "GITLAB_MOCK_NUMBERING": "gitlab",
		}), config{"9000", 100, "t", layout{"demo/gleipnir", "Gleipnir", true}}, ""},
		"mockup numbering":  {with(map[string]string{"GITLAB_MOCK_NUMBERING": "mockup"}), config{"8080", 10, token, layout{}}, ""},
		"bad numbering":     {with(map[string]string{"GITLAB_MOCK_NUMBERING": "random"}), config{}, "GITLAB_MOCK_NUMBERING"},
		"no token":          {map[string]string{}, config{}, "GITLAB_MOCK_TOKEN is required"},
		"blank token":       {map[string]string{"GITLAB_MOCK_TOKEN": "  "}, config{}, "GITLAB_MOCK_TOKEN is required"},
		"port not a number": {with(map[string]string{"PORT": "abc"}), config{}, "PORT"},
		"port zero":         {with(map[string]string{"PORT": "0"}), config{}, "PORT"},
		"port too high":     {with(map[string]string{"PORT": "65536"}), config{}, "PORT"},
		"page size zero":    {with(map[string]string{"PAGE_SIZE": "0"}), config{}, "PAGE_SIZE"},
		"page size above":   {with(map[string]string{"PAGE_SIZE": "101"}), config{}, "PAGE_SIZE"},
		"page size text":    {with(map[string]string{"PAGE_SIZE": "ten"}), config{}, "PAGE_SIZE"},
	}
	for name, c := range cases {
		cfg, err := loadConfig(env(c.vars))
		if c.err != "" {
			if err == nil || !strings.Contains(err.Error(), c.err) {
				t.Errorf("%s: got %v, want an error about %s", name, err, c.err)
			}
			continue
		}
		if err != nil || cfg != c.want {
			t.Errorf("%s: got %+v %v, want %+v", name, cfg, err, c.want)
		}
	}
}

func freePort(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	return strconv.Itoa(l.Addr().(*net.TCPAddr).Port)
}

func TestRunServesThenStops(t *testing.T) {
	port := freePort(t)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- run(ctx, env(map[string]string{"PORT": port, "GITLAB_MOCK_TOKEN": token}), slog.New(slog.NewTextHandler(io.Discard, nil)))
	}()
	deadline := time.Now().Add(5 * time.Second)
	for {
		res, err := http.Get("http://127.0.0.1:" + port + "/-/health")
		if err == nil {
			res.Body.Close()
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("not listening: %v", err)
		}
		time.Sleep(20 * time.Millisecond)
	}
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("run: %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("run did not stop")
	}
}

func TestRunFailsOnABusyPort(t *testing.T) {
	l, err := net.Listen("tcp", ":0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	port := strconv.Itoa(l.Addr().(*net.TCPAddr).Port)
	err = run(context.Background(), env(map[string]string{"PORT": port, "GITLAB_MOCK_TOKEN": token}), slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err == nil {
		t.Fatal("a busy port must fail")
	}
}

func TestServeRejectsAnInvalidConfiguration(t *testing.T) {
	var out bytes.Buffer
	if code := serve(env(map[string]string{"PORT": "nope"}), &out); code != 1 {
		t.Fatalf("exit code %d, want 1", code)
	}
	if !strings.Contains(out.String(), "invalid configuration") {
		t.Fatalf("logs: %s", out.String())
	}
}

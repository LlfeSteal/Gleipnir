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
	cases := map[string]struct {
		vars     map[string]string
		port     string
		pageSize int
		err      string
	}{
		"defaults":          {nil, "8080", 10, ""},
		"set":               {map[string]string{"PORT": " 9000 ", "PAGE_SIZE": "100"}, "9000", 100, ""},
		"port not a number": {map[string]string{"PORT": "abc"}, "", 0, "PORT"},
		"port zero":         {map[string]string{"PORT": "0"}, "", 0, "PORT"},
		"port too high":     {map[string]string{"PORT": "65536"}, "", 0, "PORT"},
		"page size zero":    {map[string]string{"PAGE_SIZE": "0"}, "", 0, "PAGE_SIZE"},
		"page size above":   {map[string]string{"PAGE_SIZE": "101"}, "", 0, "PAGE_SIZE"},
		"page size text":    {map[string]string{"PAGE_SIZE": "ten"}, "", 0, "PAGE_SIZE"},
	}
	for name, c := range cases {
		port, size, err := config(env(c.vars))
		if c.err != "" {
			if err == nil || !strings.Contains(err.Error(), c.err) {
				t.Errorf("%s: got %v, want an error about %s", name, err, c.err)
			}
			continue
		}
		if err != nil || port != c.port || size != c.pageSize {
			t.Errorf("%s: got %q %d %v", name, port, size, err)
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
		done <- run(ctx, env(map[string]string{"PORT": port}), slog.New(slog.NewTextHandler(io.Discard, nil)))
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
	err = run(context.Background(), env(map[string]string{"PORT": port}), slog.New(slog.NewTextHandler(io.Discard, nil)))
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

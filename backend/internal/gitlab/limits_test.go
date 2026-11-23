package gitlab

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// rawServer answers every GraphQL request with handler, and returns a client pointing to it.
func rawServer(t *testing.T, handler http.HandlerFunc) *Client {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	return New(srv.URL, "glpat-secret-token", "root", "")
}

func TestRateLimitIsAClearError(t *testing.T) {
	c := rawServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Retry-After", "60")
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte("Retry later"))
	})
	_, err := c.Fetch(context.Background())
	if err == nil || !strings.Contains(err.Error(), "rate limited") || !strings.Contains(err.Error(), "retry in 1m0s") {
		t.Fatalf("err = %v, want a rate limit error with the delay", err)
	}
	for _, sentinel := range []error{ErrUnauthorized, ErrGroupNotFound, ErrPremiumRequired} {
		if errors.Is(err, sentinel) {
			t.Errorf("a 429 must not be %v", sentinel)
		}
	}
}

func TestForbidden(t *testing.T) {
	tests := []struct {
		name  string
		body  string
		unAut bool
	}{
		{"insufficient scope", `{"error":"insufficient_scope","error_description":"The request requires higher privileges than provided by the access token."}`, true},
		{"other 403", `<html>blocked by a proxy</html>`, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := rawServer(t, func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusForbidden)
				_, _ = w.Write([]byte(tt.body))
			})
			_, err := c.Fetch(context.Background())
			if err == nil || errors.Is(err, ErrUnauthorized) != tt.unAut {
				t.Fatalf("err = %v, unauthorized want %v", err, tt.unAut)
			}
			if !tt.unAut && !strings.Contains(err.Error(), "HTTP 403") {
				t.Errorf("err = %v, want the status", err)
			}
		})
	}
}

func TestResponseSizeIsCapped(t *testing.T) {
	c := rawServer(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"data":{"group":{"fullPath":"` + strings.Repeat("x", 4096) + `"}}}`))
	})
	c.maxBody = 1024
	_, err := c.Fetch(context.Background())
	if err == nil || !strings.Contains(err.Error(), "larger than 1024 bytes") {
		t.Fatalf("err = %v, want a size error", err)
	}
}

func TestPaginationIsCapped(t *testing.T) {
	var n int32
	h := healthy()
	h["Groups"] = func(gqlRequest) (int, string) {
		// A fresh cursor every page: only the page cap stops it.
		return http.StatusOK, group(fmt.Sprintf(`"fullPath":"root","name":"Root","descendantGroups":{`+
			`"pageInfo":{"hasNextPage":true,"endCursor":"c%d"},"nodes":[]}`, atomic.AddInt32(&n, 1)))
	}
	_, c := newFake(t, h)
	c.maxPages = 5
	_, err := c.Fetch(context.Background())
	if err == nil || !strings.Contains(err.Error(), "more than 5 pages") {
		t.Fatalf("err = %v, want the page cap", err)
	}
	if got := atomic.LoadInt32(&n); got != 5 {
		t.Errorf("fetched %d pages, want 5", got)
	}
}

func TestFetchStopsWhenCancelled(t *testing.T) {
	block := make(chan struct{})
	c := rawServer(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body) // net/http notices a gone client once the body is read
		select {
		case <-block:
		case <-r.Context().Done():
		}
	})
	t.Cleanup(func() { close(block) }) // runs before the server's Close
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	started := time.Now()
	_, err := c.Fetch(ctx)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("err = %v, want context.DeadlineExceeded", err)
	}
	if d := time.Since(started); d > 2*time.Second {
		t.Errorf("Fetch took %v after the cancellation", d)
	}
}

func TestTokenNeverInErrors(t *testing.T) {
	statuses := []int{http.StatusBadRequest, http.StatusForbidden, http.StatusTooManyRequests, http.StatusInternalServerError, http.StatusOK}
	for _, status := range statuses {
		c := rawServer(t, func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(status)
			_, _ = w.Write([]byte(`{"errors":[{"message":"nope"}]}`))
		})
		if _, err := c.Fetch(context.Background()); err == nil || strings.Contains(err.Error(), "glpat-secret-token") {
			t.Errorf("HTTP %d: err = %v", status, err)
		}
	}
}

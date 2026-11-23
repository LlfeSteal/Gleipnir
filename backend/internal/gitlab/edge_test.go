package gitlab

import (
	"context"
	"encoding/json"
	"net/http"
	"reflect"
	"strings"
	"testing"
)

func TestRateLimitWithoutAUsableRetryAfter(t *testing.T) {
	for _, retryAfter := range []string{"", "0", "-5", "soon", "Wed, 21 Oct 2026 07:28:00 GMT"} {
		c := rawServer(t, func(w http.ResponseWriter, r *http.Request) {
			if retryAfter != "" {
				w.Header().Set("Retry-After", retryAfter)
			}
			w.WriteHeader(http.StatusTooManyRequests)
		})
		_, err := c.Fetch(context.Background())
		if err == nil || !strings.Contains(err.Error(), "rate limited") || strings.Contains(err.Error(), "retry in") {
			t.Errorf("Retry-After %q: err = %v, want a rate limit error without a delay", retryAfter, err)
		}
	}
}

func TestInvalidJSONIsAnError(t *testing.T) {
	c := rawServer(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`<html>maintenance</html>`))
	})
	_, err := c.Fetch(context.Background())
	if err == nil || !strings.Contains(err.Error(), "decoding gitlab response") {
		t.Fatalf("err = %v, want a decoding error", err)
	}
}

// A response cut short (the connection drops mid-body) fails the read.
func TestTruncatedBodyIsAnError(t *testing.T) {
	c := rawServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", "1000")
		_, _ = w.Write([]byte(`{"data":`))
	})
	_, err := c.Fetch(context.Background())
	if err == nil || !strings.Contains(err.Error(), "reading gitlab response") {
		t.Fatalf("err = %v, want a read error", err)
	}
}

func TestInvalidBaseURLIsAnError(t *testing.T) {
	_, err := New("http://bad host", "", "root", "").Fetch(context.Background())
	if err == nil {
		t.Fatal("want an error for an unparseable GitLab URL")
	}
}

func TestLinkedIDs(t *testing.T) {
	decode := func(s string) *linkedConn {
		var conn *linkedConn
		if err := json.Unmarshal([]byte(s), &conn); err != nil {
			t.Fatal(err)
		}
		return conn
	}
	cases := []struct {
		name, json string
		want       []string
	}{
		{"absent widget", `null`, nil},
		{"no links", `{"nodes":[]}`, nil},
		// An item the token cannot see comes back as null; an empty id is as unusable.
		{"invisible and empty ids skipped", `{"nodes":[{"workItem":null},{"workItem":{"id":""}},{"workItem":{"id":"gid://gitlab/WorkItem/1"}}]}`,
			[]string{"gid://gitlab/WorkItem/1"}},
		{"order kept", `{"nodes":[{"workItem":{"id":"b"}},{"workItem":{"id":"a"}}]}`, []string{"b", "a"}},
	}
	for _, c := range cases {
		if got := linkedIDs(decode(c.json)); !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s: linkedIDs = %v, want %v", c.name, got, c.want)
		}
	}
}

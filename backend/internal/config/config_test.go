package config

import (
	"bytes"
	"log/slog"
	"strings"
	"testing"
	"time"
)

func env(m map[string]string) func(string) string {
	return func(key string) string { return m[key] }
}

func TestDefaults(t *testing.T) {
	cfg, err := Load(env(map[string]string{"GITLAB_GROUP": "/my-org/team/", "GITLAB_TOKEN": "glpat-x"}))
	if err != nil {
		t.Fatal(err)
	}
	want := Config{
		GitLabURL: "https://gitlab.com",
		Token:     "glpat-x",
		Group:     "my-org/team",
		Port:      "8080",
		CacheTTL:  5 * time.Minute,
	}
	if cfg != want {
		t.Fatalf("got %+v, want %+v", cfg, want)
	}
	if w := cfg.Warnings(); len(w) != 0 {
		t.Fatalf("unexpected warnings %v", w)
	}
}

func TestEverySetting(t *testing.T) {
	cfg, err := Load(env(map[string]string{
		"GITLAB_URL":     "https://gitlab.example.com/",
		"GITLAB_TOKEN":   "t",
		"GITLAB_GROUP":   "org",
		"GITLAB_CADENCE": " Sprints ",
		"PORT":           "9000",
		"CACHE_TTL":      "90s",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.GitLabURL != "https://gitlab.example.com" || cfg.Cadence != "Sprints" || cfg.Port != "9000" ||
		cfg.CacheTTL != 90*time.Second {
		t.Fatalf("got %+v", cfg)
	}
}

// The demo mode is gone: an old demo configuration fails closed instead of starting against
// gitlab.com, and a leftover variable only warns.
func TestLegacyDemoVariable(t *testing.T) {
	_, err := Load(env(map[string]string{"GLEIPNIR_DEMO": "1"}))
	if err == nil || !strings.Contains(err.Error(), "GITLAB_GROUP is required") || !strings.Contains(err.Error(), "docker-compose.demo.yml") {
		t.Fatalf("got %v, want a missing group error pointing at the demo overlay", err)
	}
	cfg, err := Load(env(map[string]string{"GITLAB_GROUP": "org", "GITLAB_TOKEN": "t", "GLEIPNIR_DEMO": "1"}))
	if err != nil {
		t.Fatal(err)
	}
	if w := cfg.Warnings(); len(w) != 1 || !strings.Contains(w[0], "GLEIPNIR_DEMO is no longer supported") {
		t.Fatalf("got %v", w)
	}
	if _, err := Load(env(map[string]string{})); strings.Contains(err.Error(), "GLEIPNIR_DEMO") {
		t.Fatalf("no hint without the variable: %v", err)
	}
}

// A token sent over plain http to another machine travels in clear text.
func TestPlainHTTPWarns(t *testing.T) {
	cases := map[string]struct {
		url, token string
		warns      bool
	}{
		"https":                     {"https://gitlab.example.com", "t", false},
		"http with token":           {"http://gitlab.example.com", "t", true},
		"http on a compose service": {"http://gitlab-mock:8080", "t", true},
		"http without token":        {"http://gitlab-mock:8080", "", false},
		"localhost":                 {"http://localhost:8082", "t", false},
		"IPv4 loopback":             {"http://127.0.0.1:8082", "t", false},
		"IPv6 loopback":             {"http://[::1]:8082", "t", false},
		"private address":           {"http://10.0.0.5", "t", true},
	}
	for name, c := range cases {
		cfg, err := Load(env(map[string]string{"GITLAB_GROUP": "org", "GITLAB_URL": c.url, "GITLAB_TOKEN": c.token}))
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		warned := false
		for _, w := range cfg.Warnings() {
			warned = warned || strings.Contains(w, "plain http")
		}
		if warned != c.warns {
			t.Errorf("%s: plain http warning = %v, want %v", name, warned, c.warns)
		}
	}
}

func TestEmptyTokenWarns(t *testing.T) {
	cfg, err := Load(env(map[string]string{"GITLAB_GROUP": "org"}))
	if err != nil {
		t.Fatal(err)
	}
	if w := cfg.Warnings(); len(w) != 1 || !strings.Contains(w[0], "GITLAB_TOKEN") {
		t.Fatalf("got %v", w)
	}
}

func TestErrors(t *testing.T) {
	cases := []struct {
		name string
		env  map[string]string
		want string
	}{
		{"missing group", map[string]string{}, "GITLAB_GROUP is required"},
		{"blank group", map[string]string{"GITLAB_GROUP": " / "}, "GITLAB_GROUP is required"},
		{"bad url", map[string]string{"GITLAB_GROUP": "g", "GITLAB_URL": "gitlab.com"}, "GITLAB_URL"},
		{"bad port", map[string]string{"GITLAB_GROUP": "g", "PORT": "http"}, "PORT"},
		{"port out of range", map[string]string{"GITLAB_GROUP": "g", "PORT": "70000"}, "PORT"},
		{"bad ttl", map[string]string{"GITLAB_GROUP": "g", "CACHE_TTL": "5"}, "CACHE_TTL"},
		{"zero ttl", map[string]string{"GITLAB_GROUP": "g", "CACHE_TTL": "0s"}, "must be positive"},
		{"negative ttl", map[string]string{"GITLAB_GROUP": "g", "CACHE_TTL": "-1m"}, "must be positive"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := Load(env(c.env))
			if err == nil || !strings.Contains(err.Error(), c.want) {
				t.Fatalf("got %v, want an error containing %q", err, c.want)
			}
		})
	}
}

func TestLogValueHidesTheToken(t *testing.T) {
	cfg, err := Load(env(map[string]string{"GITLAB_GROUP": "org", "GITLAB_TOKEN": "glpat-secret"}))
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	slog.New(slog.NewTextHandler(&buf, nil)).Info("starting", "config", cfg)
	out := buf.String()
	if strings.Contains(out, "glpat-secret") {
		t.Fatalf("token logged: %s", out)
	}
	if !strings.Contains(out, "config.tokenSet=true") || !strings.Contains(out, "config.group=org") {
		t.Fatalf("missing fields: %s", out)
	}
}

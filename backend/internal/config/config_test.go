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
		"GLEIPNIR_DEMO":  "no",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.GitLabURL != "https://gitlab.example.com" || cfg.Cadence != "Sprints" || cfg.Port != "9000" ||
		cfg.CacheTTL != 90*time.Second || cfg.Demo {
		t.Fatalf("got %+v", cfg)
	}
}

func TestDemoNeedsNoGroup(t *testing.T) {
	for _, v := range []string{"1", "true", "TRUE", "Yes"} {
		cfg, err := Load(env(map[string]string{"GLEIPNIR_DEMO": v}))
		if err != nil {
			t.Fatalf("%s: %v", v, err)
		}
		if !cfg.Demo || cfg.Group != "" {
			t.Fatalf("%s: got %+v", v, cfg)
		}
		if w := cfg.Warnings(); len(w) != 0 {
			t.Fatalf("%s: no token warning expected in demo, got %v", v, w)
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
		{"bad demo", map[string]string{"GLEIPNIR_DEMO": "maybe"}, "GLEIPNIR_DEMO"},
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

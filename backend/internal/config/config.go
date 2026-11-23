// Package config reads the server configuration from the environment.
package config

import (
	"fmt"
	"log/slog"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Config is the server configuration. Token is a secret: Config logs itself without it.
type Config struct {
	GitLabURL string // without trailing slash
	Token     string
	Group     string // full path of the root group, without leading or trailing slash
	Cadence   string // iteration cadence title or ID; "" = the one holding the current iteration
	Port      string
	CacheTTL  time.Duration // data is fresh for that long, then served stale while it refreshes
	Demo      bool          // serve the demo dataset instead of GitLab
}

const (
	defaultGitLabURL = "https://gitlab.com"
	defaultPort      = "8080"
	defaultCacheTTL  = 5 * time.Minute
)

// Load reads the configuration through getenv (os.Getenv in production, a map in tests).
func Load(getenv func(string) string) (Config, error) {
	get := func(key string) string { return strings.TrimSpace(getenv(key)) }

	demo, err := parseBool(get("GLEIPNIR_DEMO"))
	if err != nil {
		return Config{}, fmt.Errorf("GLEIPNIR_DEMO: %w", err)
	}
	cfg := Config{
		GitLabURL: strings.TrimRight(get("GITLAB_URL"), "/"),
		Token:     get("GITLAB_TOKEN"),
		Group:     strings.Trim(get("GITLAB_GROUP"), "/ "),
		Cadence:   get("GITLAB_CADENCE"),
		Port:      get("PORT"),
		CacheTTL:  defaultCacheTTL,
		Demo:      demo,
	}

	if cfg.GitLabURL == "" {
		cfg.GitLabURL = defaultGitLabURL
	}
	if u, err := url.Parse(cfg.GitLabURL); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return Config{}, fmt.Errorf("GITLAB_URL %q is not a valid http(s) URL (e.g. https://gitlab.example.com)", cfg.GitLabURL)
	}

	if cfg.Group == "" && !cfg.Demo {
		return Config{}, fmt.Errorf("GITLAB_GROUP is required: set the full path of the root GitLab group (e.g. my-org/my-team), or GLEIPNIR_DEMO=1 to serve the demo dataset")
	}

	if cfg.Port == "" {
		cfg.Port = defaultPort
	}
	if n, err := strconv.Atoi(cfg.Port); err != nil || n < 1 || n > 65535 {
		return Config{}, fmt.Errorf("PORT %q is not a valid port number (1-65535)", cfg.Port)
	}

	if s := get("CACHE_TTL"); s != "" {
		ttl, err := time.ParseDuration(s)
		if err != nil {
			return Config{}, fmt.Errorf("CACHE_TTL %q is not a Go duration (e.g. 5m, 90s, 1h)", s)
		}
		if ttl <= 0 {
			return Config{}, fmt.Errorf("CACHE_TTL %q must be positive", s)
		}
		cfg.CacheTTL = ttl
	}
	return cfg, nil
}

// Warnings lists the settings that work but are probably a mistake.
func (c Config) Warnings() []string {
	var out []string
	if !c.Demo && c.Token == "" {
		out = append(out, "GITLAB_TOKEN is empty: only public groups and projects are readable, and GitLab may refuse anonymous GraphQL queries")
	}
	return out
}

// LogValue logs the configuration without the token, only whether it is set.
func (c Config) LogValue() slog.Value {
	return slog.GroupValue(
		slog.String("gitlabUrl", c.GitLabURL),
		slog.String("group", c.Group),
		slog.String("cadence", c.Cadence),
		slog.Bool("tokenSet", c.Token != ""),
		slog.String("port", c.Port),
		slog.Duration("cacheTTL", c.CacheTTL),
		slog.Bool("demo", c.Demo),
	)
}

func parseBool(s string) (bool, error) {
	switch strings.ToLower(s) {
	case "1", "true", "yes", "on":
		return true, nil
	case "", "0", "false", "no", "off":
		return false, nil
	}
	return false, fmt.Errorf("%q is not a boolean (use 1/true/yes or 0/false/no)", s)
}

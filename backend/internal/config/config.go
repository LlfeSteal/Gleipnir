// Package config reads the server configuration from the environment.
package config

import (
	"fmt"
	"log/slog"
	"net"
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

	legacyDemo bool // GLEIPNIR_DEMO is set: the demo mode is gone, the variable is ignored
}

const (
	defaultGitLabURL = "https://gitlab.com"
	defaultPort      = "8080"
	defaultCacheTTL  = 5 * time.Minute
)

// Load reads the configuration through getenv (os.Getenv in production, a map in tests).
func Load(getenv func(string) string) (Config, error) {
	get := func(key string) string { return strings.TrimSpace(getenv(key)) }

	cfg := Config{
		GitLabURL: strings.TrimRight(get("GITLAB_URL"), "/"),
		Token:     get("GITLAB_TOKEN"),
		Group:     strings.Trim(get("GITLAB_GROUP"), "/ "),
		Cadence:   get("GITLAB_CADENCE"),
		Port:      get("PORT"),
		CacheTTL:  defaultCacheTTL,

		legacyDemo: get("GLEIPNIR_DEMO") != "",
	}

	if cfg.GitLabURL == "" {
		cfg.GitLabURL = defaultGitLabURL
	}
	if u, err := url.Parse(cfg.GitLabURL); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return Config{}, fmt.Errorf("GITLAB_URL %q is not a valid http(s) URL (e.g. https://gitlab.example.com)", cfg.GitLabURL)
	}

	if cfg.Group == "" {
		msg := "GITLAB_GROUP is required: set the full path of the root GitLab group (e.g. my-org/my-team)"
		if cfg.legacyDemo {
			// Fail closed: an old demo configuration must not start against gitlab.com.
			msg += "; GLEIPNIR_DEMO is no longer supported, run the demo with docker-compose.demo.yml"
		}
		return Config{}, fmt.Errorf("%s", msg)
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
	if c.Token == "" {
		out = append(out, "GITLAB_TOKEN is empty: only public groups and projects are readable, and GitLab may refuse anonymous GraphQL queries")
	}
	if c.Token != "" && !c.secureTransport() {
		out = append(out, "GITLAB_URL is plain http: the token travels in clear text, use https")
	}
	if c.legacyDemo {
		out = append(out, "GLEIPNIR_DEMO is no longer supported and is ignored: run the demo with docker-compose.demo.yml")
	}
	return out
}

// secureTransport tells whether the token reaches GitLab over TLS, or at least never leaves the
// machine (loopback).
func (c Config) secureTransport() bool {
	u, err := url.Parse(c.GitLabURL)
	if err != nil || u.Scheme == "https" {
		return true // Load rejects an invalid URL
	}
	host := u.Hostname()
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
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
	)
}

// Command gitlab-mock is a fake GitLab for Gleipnir's demo and end-to-end tests: it answers
// the GraphQL queries of Gleipnir's backend, and only those, with a sample dataset placed
// around today. Like GitLab, it answers 401 unless the request carries the token set in
// GITLAB_MOCK_TOKEN: give Gleipnir's backend the same value in GITLAB_TOKEN, never a real one.
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const (
	defaultPort     = "8080"
	defaultPageSize = 10 // small, so that the backend walks several pages
	shutdownTimeout = 5 * time.Second
)

func main() {
	os.Exit(serve(os.Getenv, os.Stderr))
}

// serve logs to out and serves until SIGINT or SIGTERM; it returns the process exit code.
func serve(getenv func(string) string, out io.Writer) int {
	logger := slog.New(slog.NewTextHandler(out, nil))
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, getenv, logger); err != nil {
		logger.Error("server stopped", "err", err)
		return 1
	}
	return 0
}

// run serves until ctx is done, then shuts down gracefully.
func run(ctx context.Context, getenv func(string) string, logger *slog.Logger) error {
	cfg, err := loadConfig(getenv)
	if err != nil {
		return fmt.Errorf("invalid configuration: %w", err)
	}
	srv := &server{pageSize: cfg.pageSize, token: cfg.token, layout: cfg.layout, now: time.Now, logger: logger}
	httpServer := &http.Server{
		Addr:              ":" + cfg.port,
		Handler:           srv.handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       time.Minute,
		ErrorLog:          slog.NewLogLogger(logger.Handler(), slog.LevelWarn),
	}

	errCh := make(chan error, 1)
	go func() {
		logger.Info("fake GitLab listening", "addr", httpServer.Addr, "pageSize", cfg.pageSize)
		errCh <- httpServer.ListenAndServe()
	}()
	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		_ = httpServer.Close()
	}
	if err := <-errCh; !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// config is the fake GitLab's configuration. token is a secret: it is never logged.
type config struct {
	port     string
	pageSize int
	token    string
	layout   layout
}

// loadConfig reads PORT, PAGE_SIZE, GITLAB_MOCK_TOKEN and the layout: GITLAB_MOCK_ROOT,
// GITLAB_MOCK_ROOT_NAME and GITLAB_MOCK_NUMBERING (mockup or gitlab).
func loadConfig(getenv func(string) string) (config, error) {
	cfg := config{
		port:     strings.TrimSpace(getenv("PORT")),
		pageSize: defaultPageSize,
		token:    strings.TrimSpace(getenv("GITLAB_MOCK_TOKEN")),
	}
	if cfg.port == "" {
		cfg.port = defaultPort
	}
	if n, err := strconv.Atoi(cfg.port); err != nil || n < 1 || n > 65535 {
		return config{}, fmt.Errorf("PORT %q is not a valid port number (1-65535)", cfg.port)
	}
	if s := strings.TrimSpace(getenv("PAGE_SIZE")); s != "" {
		// GitLab serves at most 100 nodes a page.
		n, err := strconv.Atoi(s)
		if err != nil || n < 1 || n > 100 {
			return config{}, fmt.Errorf("PAGE_SIZE %q is not a number between 1 and 100", s)
		}
		cfg.pageSize = n
	}
	cfg.layout.root = strings.Trim(strings.TrimSpace(getenv("GITLAB_MOCK_ROOT")), "/")
	cfg.layout.rootName = strings.TrimSpace(getenv("GITLAB_MOCK_ROOT_NAME"))
	switch n := strings.TrimSpace(getenv("GITLAB_MOCK_NUMBERING")); n {
	case "", "mockup":
	case "gitlab":
		cfg.layout.gitlabIIDs = true
	default:
		return config{}, fmt.Errorf("GITLAB_MOCK_NUMBERING %q: use mockup or gitlab", n)
	}
	if cfg.token == "" {
		return config{}, fmt.Errorf("GITLAB_MOCK_TOKEN is required: the token the backend must send (e.g. DEMO-JETON-TEST)")
	}
	return cfg, nil
}

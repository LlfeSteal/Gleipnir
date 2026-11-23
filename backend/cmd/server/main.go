// Command server serves the Gleipnir API: the board of a GitLab group, read with a server-side
// token (or the demo dataset with GLEIPNIR_DEMO=1).
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
	"syscall"
	"time"

	"gleipnir/internal/api"
	"gleipnir/internal/board"
	"gleipnir/internal/cache"
	"gleipnir/internal/config"
	"gleipnir/internal/gitlab"
)

const (
	// A sync walks every page of the group: the first one may take minutes on a large group.
	// The fetch gets its own timeout and the write timeout leaves room to answer after it.
	fetchTimeout = 5 * time.Minute
	writeTimeout = fetchTimeout + 30*time.Second
	// Data older than the TTL is served stale while it refreshes; dropped after this.
	keepFor = 24 * time.Hour
	// ?refresh=1 within this delay of the last sync is served from the cache (ADR-20).
	minRefresh = 10 * time.Second
)

// Shutdown lets the running requests finish; a long sync is cut short past this. A variable
// for the tests.
var shutdownTimeout = 20 * time.Second

func main() {
	os.Exit(serve(os.Getenv, os.Stderr))
}

// serve logs to out and serves until SIGINT or SIGTERM; it returns the process exit code.
func serve(getenv func(string) string, out io.Writer) int {
	logger := slog.New(slog.NewTextHandler(out, nil))
	slog.SetDefault(logger)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	context.AfterFunc(ctx, stop) // a second signal kills the process at once
	if err := run(ctx, getenv, logger); err != nil {
		logger.Error("server stopped", "err", err)
		return 1
	}
	return 0
}

// run serves until ctx is done, then shuts down gracefully.
func run(ctx context.Context, getenv func(string) string, logger *slog.Logger) error {
	cfg, err := config.Load(getenv)
	if err != nil {
		return fmt.Errorf("invalid configuration: %w", err)
	}
	for _, w := range cfg.Warnings() {
		logger.Warn(w)
	}
	logger.Info("starting", "config", cfg)

	srv := api.NewServer(api.Options{
		Source:    newSource(cfg),
		Cache:     cache.Options{Fresh: cfg.CacheTTL, Keep: keepFor, FetchTimeout: fetchTimeout, MinRefresh: minRefresh},
		Demo:      cfg.Demo,
		GitLabURL: cfg.GitLabURL,
		Group:     cfg.Group,
		Token:     cfg.Token,
		Logger:    logger,
	})

	httpServer := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      writeTimeout,
		IdleTimeout:       2 * time.Minute,
		ErrorLog:          slog.NewLogLogger(logger.Handler(), slog.LevelWarn),
	}

	// Warm the cache, so the first visitor doesn't wait for GitLab.
	srv.Prefetch()

	errCh := make(chan error, 1)
	go func() {
		logger.Info("listening", "addr", httpServer.Addr)
		errCh <- httpServer.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
	}
	logger.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		// A request still waits for a long sync: cut it rather than exit with an error.
		logger.Warn("shutdown timed out, closing the remaining connections", "err", err)
		_ = httpServer.Close()
	}
	if err := <-errCh; !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	logger.Info("stopped")
	return nil
}

// newSource returns the demo dataset or the GitLab client, as configured.
func newSource(cfg config.Config) api.Source {
	if cfg.Demo {
		return demoSource{}
	}
	return gitlab.New(cfg.GitLabURL, cfg.Token, cfg.Group, cfg.Cadence)
}

// demoSource serves the mockup's dataset, placed around today.
type demoSource struct{}

func (demoSource) Fetch(context.Context) (*board.Raw, error) {
	return board.DemoRaw(time.Now()), nil
}

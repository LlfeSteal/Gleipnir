// Command gitlab-mock is a fake GitLab for Gleipnir's demo and end-to-end tests: it answers
// the GraphQL queries of Gleipnir's backend, and only those, with a sample dataset placed
// around today. It accepts any token and checks none. Never deploy it next to a real token:
// point Gleipnir's GITLAB_URL at it with GITLAB_TOKEN empty.
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
	port, pageSize, err := config(getenv)
	if err != nil {
		return fmt.Errorf("invalid configuration: %w", err)
	}
	srv := &server{pageSize: pageSize, now: time.Now, logger: logger}
	httpServer := &http.Server{
		Addr:              ":" + port,
		Handler:           srv.handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       time.Minute,
		ErrorLog:          slog.NewLogLogger(logger.Handler(), slog.LevelWarn),
	}

	errCh := make(chan error, 1)
	go func() {
		logger.Info("fake GitLab listening", "addr", httpServer.Addr, "pageSize", pageSize)
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

// config reads PORT and PAGE_SIZE.
func config(getenv func(string) string) (port string, pageSize int, err error) {
	port = strings.TrimSpace(getenv("PORT"))
	if port == "" {
		port = defaultPort
	}
	if n, err := strconv.Atoi(port); err != nil || n < 1 || n > 65535 {
		return "", 0, fmt.Errorf("PORT %q is not a valid port number (1-65535)", port)
	}
	pageSize = defaultPageSize
	if s := strings.TrimSpace(getenv("PAGE_SIZE")); s != "" {
		// GitLab serves at most 100 nodes a page.
		if pageSize, err = strconv.Atoi(s); err != nil || pageSize < 1 || pageSize > 100 {
			return "", 0, fmt.Errorf("PAGE_SIZE %q is not a number between 1 and 100", s)
		}
	}
	return port, pageSize, nil
}

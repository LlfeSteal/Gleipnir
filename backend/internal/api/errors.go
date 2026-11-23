package api

import (
	"context"
	"errors"
	"net"
	"net/http"
	"strings"

	"gleipnir/internal/cache"
	"gleipnir/internal/gitlab"
)

// Error codes of the JSON error body. The frontend picks its (French) message from the code;
// the error field keeps the technical message.
const (
	CodeUnauthorized      = "unauthorized"
	CodeGroupNotFound     = "group_not_found"
	CodePremiumRequired   = "premium_required"
	CodeCadenceNotFound   = "cadence_not_found"
	CodeGitLabUnreachable = "gitlab_unreachable"
	CodeInvalidScope      = "invalid_scope"
	CodeInternal          = "internal"
)

type errorBody struct {
	Error string `json:"error"`
	Code  string `json:"code"`
}

// sourceError marks a failure of the source (GitLab): those are 502, unlike our own bugs.
type sourceError struct{ err error }

func (e *sourceError) Error() string { return e.err.Error() }
func (e *sourceError) Unwrap() error { return e.err }

// classify maps an error to its HTTP status and code.
func classify(err error) (int, string) {
	var srcErr *sourceError
	var netErr net.Error
	switch {
	case errors.Is(err, cache.ErrInvalidScope):
		return http.StatusBadRequest, CodeInvalidScope
	case errors.Is(err, gitlab.ErrUnauthorized):
		return http.StatusUnauthorized, CodeUnauthorized
	case errors.Is(err, gitlab.ErrGroupNotFound):
		return http.StatusNotFound, CodeGroupNotFound
	case errors.Is(err, gitlab.ErrPremiumRequired):
		return http.StatusBadGateway, CodePremiumRequired
	case errors.Is(err, gitlab.ErrNoCadence), errors.Is(err, gitlab.ErrCadenceNotFound):
		return http.StatusBadGateway, CodeCadenceNotFound
	case errors.As(err, &srcErr), errors.Is(err, context.DeadlineExceeded), errors.As(err, &netErr):
		return http.StatusBadGateway, CodeGitLabUnreachable
	}
	return http.StatusInternalServerError, CodeInternal
}

func (s *Server) writeError(w http.ResponseWriter, err error) {
	status, code := classify(err)
	msg := err.Error()
	if s.token != "" {
		msg = strings.ReplaceAll(msg, s.token, "[redacted]")
	}
	writeJSON(w, status, errorBody{Error: msg, Code: code})
}

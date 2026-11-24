package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

var (
	errNotFound     = errors.New("not found")
	errConflict     = errors.New("already exists")
	errUnauthorized = errors.New("the token was refused (HTTP 401)")
)

// maxBody caps a response: a page of 50 work items with their links is a few hundred KB.
const maxBody = 16 << 20

// client calls GitLab's REST and GraphQL APIs with the seeding token. The token never goes into
// an error message or a log.
type client struct {
	base  string // without trailing slash
	token string
	http  *http.Client
}

func newClient(base, token string) *client {
	return &client{base: strings.TrimRight(base, "/"), token: token, http: &http.Client{Timeout: 60 * time.Second}}
}

func (c *client) do(ctx context.Context, method, url string, body, out any) error {
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, url, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "gleipnir-seed")
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("%s %s: %w", method, strings.TrimPrefix(url, c.base), err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxBody+1))
	if err != nil {
		return err
	}
	if len(data) > maxBody {
		return fmt.Errorf("%s %s: response larger than %d bytes", method, strings.TrimPrefix(url, c.base), maxBody)
	}
	switch {
	case resp.StatusCode == http.StatusUnauthorized:
		return errUnauthorized
	case resp.StatusCode == http.StatusForbidden:
		return fmt.Errorf("%s %s: forbidden (HTTP 403): the token needs the api scope, and admin rights to create users: %s",
			method, strings.TrimPrefix(url, c.base), truncate(string(data), 200))
	case resp.StatusCode == http.StatusNotFound:
		return errNotFound
	case resp.StatusCode == http.StatusConflict:
		return errConflict
	case resp.StatusCode >= 300:
		return fmt.Errorf("%s %s: HTTP %d: %s", method, strings.TrimPrefix(url, c.base), resp.StatusCode, truncate(string(data), 300))
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(data, out); err != nil {
		return fmt.Errorf("%s %s: decoding the response: %w", method, strings.TrimPrefix(url, c.base), err)
	}
	return nil
}

// rest calls /api/v4 + path.
func (c *client) rest(ctx context.Context, method, path string, body, out any) error {
	return c.do(ctx, method, c.base+"/api/v4"+path, body, out)
}

// graphql runs query and decodes its data into out. GraphQL errors come with HTTP 200.
func (c *client) graphql(ctx context.Context, query string, vars map[string]any, out any) error {
	var resp struct {
		Data   json.RawMessage `json:"data"`
		Errors []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}
	if err := c.do(ctx, http.MethodPost, c.base+"/api/graphql", map[string]any{"query": query, "variables": vars}, &resp); err != nil {
		return err
	}
	if len(resp.Errors) > 0 {
		msgs := make([]string, len(resp.Errors))
		for i, e := range resp.Errors {
			msgs[i] = e.Message
		}
		return fmt.Errorf("graphql %s: %s", operation(query), strings.Join(msgs, "; "))
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(resp.Data, out)
}

// payloadErrors turns the errors list of a mutation payload into an error.
func payloadErrors(op string, errs []string) error {
	if len(errs) == 0 {
		return nil
	}
	return fmt.Errorf("%s: %s", op, strings.Join(errs, "; "))
}

// operation is the name of a query or mutation ("mutation WorkItemCreate(…" → "WorkItemCreate").
func operation(query string) string {
	fields := strings.Fields(query)
	if len(fields) < 2 {
		return "query"
	}
	name, _, _ := strings.Cut(fields[1], "(")
	return name
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

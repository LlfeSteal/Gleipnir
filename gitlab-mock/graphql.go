package main

import (
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// maxBody caps a request: Gleipnir's queries are a few KB.
const maxBody = 1 << 20

// server answers the GraphQL queries Gleipnir sends, and only those, with the demo dataset,
// to requests carrying token.
type server struct {
	pageSize int
	token    string
	now      func() time.Time
	logger   *slog.Logger
}

func (s *server) handler() http.Handler {
	mux := http.NewServeMux()
	// GitLab's own health endpoint, used by the healthchecks.
	mux.HandleFunc("GET /-/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write([]byte("GitLab OK"))
	})
	mux.HandleFunc("POST /api/graphql", s.graphql)
	return mux
}

// gqlError is an error of the GraphQL response: GitLab sends them with HTTP 200.
type gqlError struct {
	Message string `json:"message"`
}

func (e gqlError) Error() string { return e.Message }

// operation reads the operation name of the query: Gleipnir names every query and sends no
// operationName.
var operation = regexp.MustCompile(`^\s*query\s+(\w+)`)

func (s *server) graphql(w http.ResponseWriter, r *http.Request) {
	if !s.authorized(r) {
		// Never the token, sent or expected.
		s.logger.Warn("token rejected", "remote", r.RemoteAddr)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"message":"401 Unauthorized"}`))
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBody)
	var req struct {
		Query     string         `json:"query"`
		Variables map[string]any `json:"variables"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			http.Error(w, "request body too large", http.StatusRequestEntityTooLarge)
			return
		}
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}
	op := ""
	if m := operation.FindStringSubmatch(req.Query); m != nil {
		op = m[1]
	}
	fullPath, _ := req.Variables["fullPath"].(string)
	// Never the headers: the backend may send a token.
	s.logger.Info("query", "op", op, "fullPath", fullPath)

	group, err := s.resolve(op, fullPath, req.Variables)
	w.Header().Set("Content-Type", "application/json")
	var body any
	switch {
	case err != nil:
		body = map[string]any{"errors": []gqlError{{Message: err.Error()}}}
	default:
		// group is nil for an unknown path: GitLab answers "group": null.
		body = map[string]any{"data": map[string]any{"group": group}}
	}
	_ = json.NewEncoder(w).Encode(body)
}

// authorized tells whether r carries the token, in either header GitLab reads: Authorization
// (Bearer) or PRIVATE-TOKEN.
func (s *server) authorized(r *http.Request) bool {
	sent := r.Header.Get("PRIVATE-TOKEN")
	if auth := r.Header.Get("Authorization"); auth != "" {
		scheme, token, ok := strings.Cut(auth, " ")
		if !ok || !strings.EqualFold(scheme, "Bearer") {
			return false
		}
		sent = token
	}
	return sent != "" && subtle.ConstantTimeCompare([]byte(sent), []byte(s.token)) == 1
}

// resolve answers one query; a nil group means the path is not a group of the dataset.
func (s *server) resolve(op, fullPath string, vars map[string]any) (map[string]any, error) {
	d := newDataset(s.now())
	g, ok := d.group(fullPath)
	known := map[string]bool{"Groups": true, "Cadences": true, "CurrentIterations": true, "Iterations": true, "WorkItems": true}
	if !known[op] {
		return nil, gqlError{Message: fmt.Sprintf("unsupported query %q: the fake GitLab only answers Gleipnir's queries", op)}
	}
	if !ok {
		return nil, nil
	}
	after := vars["after"]

	switch op {
	case "Groups":
		conn, err := page(d.descendantsOf(fullPath), after, s.pageSize)
		if err != nil {
			return nil, err
		}
		return map[string]any{"fullPath": g.FullPath, "name": g.Name, "descendantGroups": conn}, nil

	case "Cadences":
		conn, err := page([]cadenceNode{{ID: cadenceID, Title: d.cadence, Active: true}}, after, s.pageSize)
		if err != nil {
			return nil, err
		}
		return map[string]any{"iterationCadences": conn}, nil

	case "CurrentIterations":
		today, _ := vars["today"].(string)
		if _, err := time.Parse(dateLayout, today); err != nil {
			return nil, gqlError{Message: fmt.Sprintf("Variable $today of type Date! was provided invalid value %q", today)}
		}
		var current []iterationNode
		for _, it := range d.iterations {
			// Both bounds of timeframe are inclusive; the dates compare as strings.
			if it.StartDate <= today && today <= it.DueDate {
				current = append(current, it)
			}
		}
		return iterations(current, after, s.pageSize)

	case "Iterations":
		var matching []iterationNode
		if id, _ := vars["cadenceId"].(string); id == cadenceID {
			matching = d.iterations
		}
		return iterations(matching, after, s.pageSize)
	}

	// WorkItems
	conn, err := page(d.itemsUnder(fullPath), after, s.pageSize)
	if err != nil {
		return nil, err
	}
	return map[string]any{"workItems": conn}, nil
}

func iterations(nodes []iterationNode, after any, size int) (map[string]any, error) {
	conn, err := page(nodes, after, size)
	if err != nil {
		return nil, err
	}
	return map[string]any{"iterations": conn}, nil
}

// connection is a page of a GraphQL connection.
type connection[T any] struct {
	PageInfo struct {
		HasNextPage bool    `json:"hasNextPage"`
		EndCursor   *string `json:"endCursor"`
	} `json:"pageInfo"`
	Nodes []T `json:"nodes"`
}

// page cuts nodes after the cursor after (nil: from the start). Cursors are opaque, as on
// GitLab: an offset in base64.
func page[T any](nodes []T, after any, size int) (connection[T], error) {
	var conn connection[T]
	start := 0
	switch a := after.(type) {
	case nil:
	case string:
		n, err := decodeCursor(a)
		if err != nil || n > len(nodes) {
			return conn, gqlError{Message: fmt.Sprintf("invalid cursor %q", a)}
		}
		start = n
	default:
		return conn, gqlError{Message: fmt.Sprintf("invalid cursor %v", a)}
	}
	end := min(start+size, len(nodes))
	conn.Nodes = append([]T{}, nodes[start:end]...)
	if end > start {
		c := encodeCursor(end)
		conn.PageInfo.EndCursor = &c
	}
	conn.PageInfo.HasNextPage = end < len(nodes)
	return conn, nil
}

func encodeCursor(offset int) string {
	return base64.StdEncoding.EncodeToString([]byte("offset:" + strconv.Itoa(offset)))
}

func decodeCursor(cursor string) (int, error) {
	b, err := base64.StdEncoding.DecodeString(cursor)
	if err != nil {
		return 0, err
	}
	var n int
	if _, err := fmt.Sscanf(string(b), "offset:%d", &n); err != nil || n < 0 {
		return 0, fmt.Errorf("bad offset %q", b)
	}
	return n, nil
}

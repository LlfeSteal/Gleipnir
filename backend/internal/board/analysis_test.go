package board

import (
	"bytes"
	"fmt"
	"log/slog"
	"reflect"
	"strings"
	"testing"
	"time"
)

// planned returns the info of an open item spanning iterations start..end.
func planned(ref string, start, end int) itemInfo {
	return itemInfo{ref: ref, open: true, planned: true, start: start, end: end}
}

func blocksLink(a, b string) Link { return Link{Source: a, Target: b, Type: LinkBlocks} }

func TestMarkConflicts(t *testing.T) {
	closed := planned("&c", 0, 5)
	closed.open = false
	info := map[string]itemInfo{
		"early":    planned("&1", 0, 2),
		"late":     planned("&2", 3, 6),
		"same":     planned("#3", 2, 2),
		"closed":   closed,
		"unplan":   {ref: "#u", open: true, start: -1, end: -1},
		"overlaps": planned("&4", 1, 4),
	}
	tests := []struct {
		name string
		link Link
		want bool
	}{
		{"blocker ends before the target starts", blocksLink("early", "late"), false},
		{"blocker ends in the target's start iteration", blocksLink("early", "same"), false},
		{"blocker ends after the target starts", blocksLink("late", "early"), true},
		{"overlap by one iteration", blocksLink("overlaps", "late"), true},
		{"closed blocker is never a conflict", blocksLink("closed", "early"), false},
		{"closed target still conflicts", blocksLink("late", "closed"), true},
		{"unplanned blocker", blocksLink("unplan", "early"), false},
		{"unplanned target", blocksLink("late", "unplan"), false},
		{"relates is never a conflict", Link{Source: "late", Target: "early", Type: LinkRelates}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			links := []Link{tt.link}
			markConflicts(links, info)
			if links[0].Conflict != tt.want {
				t.Errorf("conflict = %v, want %v", links[0].Conflict, tt.want)
			}
		})
	}
}

func TestCriticalPath(t *testing.T) {
	closed := planned("&x", 0, 0)
	closed.open = false
	info := map[string]itemInfo{
		"a": planned("&a", 0, 0), "b": planned("&b", 1, 1), "c": planned("&c", 2, 2),
		"d": planned("&d", 3, 3), "e": planned("&e", 4, 4), "f": planned("&f", 5, 5),
		"u": {ref: "#u", open: true, start: -1, end: -1}, "x": closed,
	}
	tests := []struct {
		name  string
		links []Link
		want  []string
	}{
		{"no link", nil, []string{}},
		{"only relates", []Link{{Source: "a", Target: "b", Type: LinkRelates}}, []string{}},
		{"single link", []Link{blocksLink("b", "a")}, []string{"b", "a"}},
		{"simple chain", []Link{blocksLink("a", "b"), blocksLink("b", "c"), blocksLink("c", "d")}, []string{"a", "b", "c", "d"}},
		{"longest wins", []Link{blocksLink("a", "f"), blocksLink("b", "c"), blocksLink("c", "d")}, []string{"b", "c", "d"}},
		{"closed item breaks the chain", []Link{blocksLink("a", "x"), blocksLink("x", "b"), blocksLink("c", "d")}, []string{"c", "d"}},
		{"tie: the chain ending latest", []Link{blocksLink("a", "b"), blocksLink("c", "e"), blocksLink("d", "b")},
			[]string{"c", "e"}},
		{"tie: branch ending latest", []Link{blocksLink("a", "b"), blocksLink("b", "c"), blocksLink("b", "f")},
			[]string{"a", "b", "f"}},
		{"tie: unplanned ends earliest", []Link{blocksLink("a", "u"), blocksLink("b", "c")}, []string{"b", "c"}},
		{"tie: lexicographic IDs", []Link{blocksLink("b", "d"), blocksLink("a", "d"), blocksLink("c", "d")},
			[]string{"a", "d"}},
		{"unplanned items stay in chains", []Link{blocksLink("a", "u"), blocksLink("u", "b")}, []string{"a", "u", "b"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := criticalPath(tt.links, info); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("criticalPath = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestCriticalPathCycle(t *testing.T) {
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
	defer slog.SetDefault(prev)

	info := map[string]itemInfo{
		"a": planned("&a", 0, 0), "b": planned("&b", 1, 1), "c": planned("&c", 2, 2), "d": planned("&d", 3, 3),
	}
	// a → b → c → a is a cycle; c → d leads out of it.
	links := []Link{blocksLink("a", "b"), blocksLink("b", "c"), blocksLink("c", "a"), blocksLink("c", "d")}
	got := criticalPath(links, info)
	if want := []string{"a", "b", "c", "d"}; !reflect.DeepEqual(got, want) {
		t.Errorf("criticalPath = %v, want %v", got, want)
	}
	logs := buf.String()
	if strings.Count(logs, "level=WARN") != 1 || !strings.Contains(logs, "&c → &a") {
		t.Errorf("want one warning naming the back edge, got %q", logs)
	}

	// Two-item cycle only: still a chain of two, no infinite loop.
	buf.Reset()
	got = criticalPath([]Link{blocksLink("a", "b"), blocksLink("b", "a")}, info)
	if len(got) != 2 {
		t.Errorf("criticalPath = %v", got)
	}
}

// TestCriticalPathScale checks the analyses stay fast on a large board (spec: ~300 epics,
// 1000 issues, 3000 links) with long chains and many ties.
func TestCriticalPathScale(t *testing.T) {
	info := map[string]itemInfo{}
	var ids []string
	for i := 0; i < 1300; i++ {
		id := fmt.Sprintf("n%04d", i)
		ids = append(ids, id)
		info[id] = planned(id, i%10, i%10)
	}
	var links []Link
	for i := 0; i < 1300; i++ {
		for _, step := range []int{1, 2, 3} {
			if j := i + step; j < 1300 {
				links = append(links, blocksLink(ids[i], ids[j]))
			}
		}
	}
	links = append(links, blocksLink(ids[1299], ids[0])) // one big cycle
	sortLinks(links)
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	defer slog.SetDefault(prev)

	begin := time.Now()
	markConflicts(links, info)
	path := criticalPath(links, info)
	if elapsed := time.Since(begin); elapsed > 2*time.Second {
		t.Errorf("analyses took %v", elapsed)
	}
	if len(path) != 1300 || path[0] != ids[0] || path[1299] != ids[1299] {
		t.Errorf("path of %d items from %s", len(path), path[0])
	}
}

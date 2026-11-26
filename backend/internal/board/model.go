// Package board turns the raw GitLab data into the normalized board served to the frontend:
// the iterations of the active cadences as columns, epics placed on them, the issues, and the links between them
// (spec §5). It holds the business rules; the frontend only lays it out.
package board

import "time"

// Board is the JSON body of GET /api/board. Item references between epics, issues and links
// use the work item global ID (gid://gitlab/WorkItem/…): refs ("&18", "#110") are for display
// only, since issue IIDs repeat from one project to the next.
type Board struct {
	SyncedAt  time.Time `json:"syncedAt"`
	GitLabURL string    `json:"gitlabUrl"`
	RootGroup Group     `json:"rootGroup"`
	// Cadences lists every cadence, sorted by title then ID; Active ones give the columns.
	Cadences []Cadence `json:"cadences"`
	// Iterations are the columns: the iterations of the active cadences, those with the same
	// dates merged into one (ADR-38), sorted by start date.
	Iterations []Iteration `json:"iterations"`
	Current    int         `json:"current"` // index of the current iteration, -1 when none
	Groups     []Group     `json:"groups"`  // the root group, then its descendants, sorted by path
	Labels     []Label     `json:"labels"`  // every label used by an epic or an issue, sorted by title
	Epics      []Epic      `json:"epics"`
	// Issues holds every synced issue, blocking an epic or not: each lane's issue mode picks
	// the ones it shows (ADR-35).
	Issues []Issue `json:"issues"`
	Links  []Link  `json:"links"`
	// CriticalPath is the longest chain of open blocking links between epics and issues that
	// block an epic, as item IDs from the first blocker to the last blocked item (empty when
	// there is no such link).
	CriticalPath []string `json:"criticalPath"`
}

type Group struct {
	// ID is the group's global ID (gid://gitlab/Group/N): the frontend names groups by it in
	// the URL of a view, shorter than a full path.
	ID   string `json:"id"`
	Path string `json:"path"`
	Name string `json:"name"`
	// SyncedAt is when the group's items were read from GitLab. Groups are refreshed one
	// subtree at a time (Synchroniser), so it differs from one group to the next. Set by the
	// cache when it encodes the board; nil (omitted) in Build's output.
	SyncedAt *time.Time `json:"syncedAt,omitempty"`
}

type Cadence struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	// Active: its iterations are columns of this board (the request's choice, or the default).
	Active bool `json:"active"`
}

// Iteration is a column: one iteration, or several of different cadences with the same dates.
// ID, Title and WebURL are the first one's.
type Iteration struct {
	ID        string `json:"id"`
	Title     string `json:"title"`     // never empty: "Itération <sequence>" when GitLab has none
	StartDate string `json:"startDate"` // YYYY-MM-DD
	DueDate   string `json:"dueDate"`   // YYYY-MM-DD, inclusive
	WebURL    string `json:"webUrl"`
	Current   bool   `json:"current"`
	// IterationIDs are the GitLab iterations of the column, the first one first.
	IterationIDs []string `json:"iterationIds"`
	CadenceIDs   []string `json:"cadenceIds"` // their cadences, without duplicates
}

type Label struct {
	Title string `json:"title"`
	Color string `json:"color"` // GitLab's background color, e.g. "#428bca"
}

type Person struct {
	Name     string `json:"name"`
	Username string `json:"username"`
}

// State values of epics and issues.
const (
	StateOpen   = "open"
	StateClosed = "closed"
)

type Epic struct {
	ID        string   `json:"id"`
	IID       string   `json:"iid"`
	Ref       string   `json:"ref"` // "&18"
	GroupPath string   `json:"groupPath"`
	Title     string   `json:"title"`
	Labels    []string `json:"labels"`
	State     string   `json:"state"`
	// Start and End are iteration indexes (inclusive); nil when the epic is unplanned.
	Start *int `json:"start"`
	End   *int `json:"end"`
	// StartDate and DueDate are the epic's dates in GitLab ("" when unset).
	StartDate string `json:"startDate"`
	DueDate   string `json:"dueDate"`
	// DatesFromChildren: no dates in GitLab, Start/End come from its child issues (spec §5.2).
	DatesFromChildren bool   `json:"datesFromChildren"`
	Unplanned         bool   `json:"unplanned"`
	WebURL            string `json:"webUrl"`
}

type Issue struct {
	ID          string   `json:"id"`
	IID         string   `json:"iid"`
	Ref         string   `json:"ref"` // "#110"
	GroupPath   string   `json:"groupPath"`
	ProjectPath string   `json:"projectPath"`
	Title       string   `json:"title"`
	Labels      []string `json:"labels"`
	State       string   `json:"state"`
	// Iteration is a column index; nil when the issue has no iteration, or one past the last
	// column (ADR-38).
	Iteration  *int    `json:"iteration"`
	ParentEpic string  `json:"parentEpic"` // epic ID, "" when none
	Assignee   *Person `json:"assignee"`
	// BlocksEpics lists the IDs of the epics this issue blocks, sorted; empty when it blocks
	// none (spec §5.1: such an issue only shows in a lane set to « Toutes »).
	BlocksEpics []string `json:"blocksEpics"`
	Unplanned   bool     `json:"unplanned"`
	WebURL      string   `json:"webUrl"`
}

// Link types.
const (
	LinkBlocks  = "blocks"
	LinkRelates = "relates"
	LinkParent  = "parent"
)

// Link joins two items of the board. blocks: Source blocks Target. relates: unordered, Source < Target.
// parent: Source is the parent epic of the Target issue.
type Link struct {
	Source string `json:"source"`
	Target string `json:"target"`
	Type   string `json:"type"`
	// Conflict: a blocks link whose open blocker ends in a later iteration than the one its
	// target starts in.
	Conflict bool `json:"conflict"`
}

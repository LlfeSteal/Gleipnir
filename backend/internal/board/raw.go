package board

// Raw is what a source (GitLab, or the demo dataset) hands to Build: the data as GitLab has
// it, before any business rule. Dates are "YYYY-MM-DD" strings, "" when unset.
type Raw struct {
	GitLabURL  string
	RootGroup  Group
	Groups     []Group // descendants of the root group (the root itself excluded), any order
	Cadence    Cadence
	Iterations []RawIteration // the cadence's iterations, any order
	Items      []RawItem      // every epic and issue of the root group and its descendants
}

type RawIteration struct {
	ID        string
	Title     string // may be "" (automatic cadences)
	Sequence  int
	StartDate string
	DueDate   string
	WebURL    string
}

// Item kinds.
const (
	KindEpic  = "epic"
	KindIssue = "issue"
)

type RawItem struct {
	ID    string // work item global ID
	IID   string
	Kind  string // KindEpic or KindIssue
	Title string
	State string // StateOpen or StateClosed
	// NamespacePath is the group path of an epic, the project path of an issue.
	NamespacePath string
	WebURL        string
	StartDate     string
	DueDate       string
	IterationID   string // "" when none
	ParentID      string // hierarchy parent work item ID, "" when none
	Labels        []Label
	Assignee      *Person // first assignee, nil when none
	// Linked items, by work item ID, as GitLab returns them (both directions may list the
	// same link; Build normalizes them). IDs may point outside Items: such links are dropped.
	Blocks    []string
	BlockedBy []string
	Related   []string
}

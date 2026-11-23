package gitlab

// GraphQL response structs. One groupData serves every query: each fills the connection it
// asks for and leaves the others zero.

type gqlResponse struct {
	Data struct {
		Group *groupData `json:"group"`
	} `json:"data"`
	Errors []gqlError `json:"errors,omitempty"`
}

type gqlError struct {
	Message string `json:"message"`
	// Path holds field names and list indexes (strings and numbers).
	Path []any `json:"path,omitempty"`
}

type groupData struct {
	FullPath          string        `json:"fullPath"`
	Name              string        `json:"name"`
	DescendantGroups  groupConn     `json:"descendantGroups"`
	IterationCadences cadenceConn   `json:"iterationCadences"`
	Iterations        iterationConn `json:"iterations"`
	WorkItems         workItemConn  `json:"workItems"`
}

type pageInfo struct {
	HasNextPage bool   `json:"hasNextPage"`
	EndCursor   string `json:"endCursor"`
}

type groupConn struct {
	PageInfo pageInfo    `json:"pageInfo"`
	Nodes    []groupNode `json:"nodes"`
}

type groupNode struct {
	FullPath string `json:"fullPath"`
	Name     string `json:"name"`
}

type cadenceConn struct {
	PageInfo pageInfo      `json:"pageInfo"`
	Nodes    []cadenceNode `json:"nodes"`
}

type cadenceNode struct {
	ID     string `json:"id"` // "gid://gitlab/Iterations::Cadence/<n>"
	Title  string `json:"title"`
	Active bool   `json:"active"`
}

type iterationConn struct {
	PageInfo pageInfo        `json:"pageInfo"`
	Nodes    []iterationNode `json:"nodes"`
}

type iterationNode struct {
	ID    string  `json:"id"` // "gid://gitlab/Iteration/<n>"
	Title *string `json:"title"`
	// Sequence: the iteration's number in its cadence.
	Sequence int `json:"sequence"`
	// StartDate and DueDate are typed Time in the schema but come back as "YYYY-MM-DD".
	StartDate        string   `json:"startDate"`
	DueDate          string   `json:"dueDate"`
	WebURL           string   `json:"webUrl"`
	IterationCadence *idTitle `json:"iterationCadence"`
}

type idTitle struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

type workItemConn struct {
	PageInfo pageInfo       `json:"pageInfo"`
	Nodes    []workItemNode `json:"nodes"`
}

type workItemNode struct {
	ID           string        `json:"id"`
	IID          string        `json:"iid"`
	Title        string        `json:"title"`
	State        string        `json:"state"` // "OPEN" or "CLOSED"
	WebURL       string        `json:"webUrl"`
	Namespace    *namespaceRef `json:"namespace"`
	WorkItemType struct {
		Name string `json:"name"` // "Epic", "Issue"…
	} `json:"workItemType"`
	Widgets []widget `json:"widgets"`
}

// namespaceRef: a group for epics, the project for issues.
type namespaceRef struct {
	ID       string `json:"id"`
	FullPath string `json:"fullPath"`
}

// widget flattens the fragments; __typename tells them apart (`type` is an enum such as
// HIERARCHY, not the GraphQL type name).
type widget struct {
	Typename  string      `json:"__typename"`
	StartDate *string     `json:"startDate"`
	DueDate   *string     `json:"dueDate"`
	Iteration *idRef      `json:"iteration"`
	Parent    *idRef      `json:"parent"`
	Labels    *labelConn  `json:"labels"`
	Assignees *userConn   `json:"assignees"`
	Blocks    *linkedConn `json:"blocks"`
	BlockedBy *linkedConn `json:"blockedBy"`
	Related   *linkedConn `json:"related"`
}

type idRef struct {
	ID string `json:"id"`
}

type labelConn struct {
	Nodes []struct {
		Title string `json:"title"`
		Color string `json:"color"`
	} `json:"nodes"`
}

type userConn struct {
	Nodes []struct {
		Name     string `json:"name"`
		Username string `json:"username"`
	} `json:"nodes"`
}

type linkedConn struct {
	Nodes []struct {
		// WorkItem is null when the linked item is not visible to the token.
		WorkItem *idRef `json:"workItem"`
	} `json:"nodes"`
}

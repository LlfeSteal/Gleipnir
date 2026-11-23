// JSON of GET /api/board, mirror of backend/internal/board/model.go: keep both in sync.
// Items reference each other by `id` (the GitLab work item global ID); `ref` ("&18", "#110")
// is for display and search only, since issue IIDs repeat from one project to the next.

export type ItemState = 'open' | 'closed';
export type LinkType = 'blocks' | 'relates' | 'parent';

export interface Group {
  path: string;
  name: string;
}

export interface Cadence {
  id: string;
  title: string;
}

export interface Iteration {
  id: string;
  title: string; // never empty
  startDate: string; // YYYY-MM-DD
  dueDate: string; // YYYY-MM-DD, inclusive
  webUrl: string;
  current: boolean;
}

export interface Label {
  title: string;
  color: string; // GitLab background color, e.g. "#428bca"
}

export interface Person {
  name: string;
  username: string;
}

export interface Epic {
  id: string;
  iid: string;
  ref: string; // "&18"
  groupPath: string;
  title: string;
  labels: string[];
  state: ItemState;
  /** Iteration indexes (inclusive); null when unplanned. */
  start: number | null;
  end: number | null;
  startDate: string; // "" when unset in GitLab
  dueDate: string;
  /** No dates in GitLab: start/end come from the child issues (spec §5.2). */
  datesFromChildren: boolean;
  unplanned: boolean;
  webUrl: string;
}

export interface Issue {
  id: string;
  iid: string;
  ref: string; // "#110"
  groupPath: string;
  projectPath: string;
  title: string;
  labels: string[];
  state: ItemState;
  /** Iteration index; null when the issue has no iteration of the cadence (unplanned). */
  iteration: number | null;
  parentEpic: string; // epic id, "" when none
  assignee: Person | null;
  /** IDs of the epics this issue blocks (never empty: only blocking issues are sent). */
  blocksEpics: string[];
  unplanned: boolean;
  webUrl: string;
}

/** blocks: source blocks target. relates: unordered. parent: source is the parent epic of the target issue. */
export interface Link {
  source: string;
  target: string;
  type: LinkType;
  /** An open blocker that ends in a later iteration than the one its target starts in. */
  conflict: boolean;
}

export interface BoardData {
  syncedAt: string; // RFC 3339
  gitlabUrl: string;
  rootGroup: Group;
  cadence: Cadence;
  iterations: Iteration[]; // sorted by start date
  current: number; // index of the current iteration, -1 when none
  groups: Group[]; // root group first, then descendants sorted by path
  labels: Label[];
  epics: Epic[];
  issues: Issue[];
  links: Link[];
  /** Longest chain of open blocking links, item ids from the first blocker to the last blocked. */
  criticalPath: string[];
  /** Synced issues that block no epic, hence not shown. */
  ignoredIssues: number;
}

/** Error body of the API: { error, code }. */
export type ApiErrorCode =
  | 'unauthorized' // GitLab rejected the token (401)
  | 'group_not_found' // GITLAB_GROUP unknown or not visible to the token (404)
  | 'premium_required' // epics / iterations / blocking links unavailable on this instance
  | 'cadence_not_found' // GITLAB_CADENCE matches no cadence, or the group has none
  | 'gitlab_unreachable' // network error / GitLab 5xx (502)
  | 'internal';

export interface ApiErrorBody {
  error: string;
  code: ApiErrorCode;
}

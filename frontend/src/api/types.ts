// JSON of GET /api/board, mirror of backend/internal/board/model.go: keep both in sync.
// Items reference each other by `id` (the GitLab work item global ID); `ref` ("&18", "#110")
// is for display and search only, since issue IIDs repeat from one project to the next.

export type ItemState = 'open' | 'closed';
export type LinkType = 'blocks' | 'relates' | 'parent';

export interface Group {
  /** Global ID, "gid://gitlab/Group/12": lanes name their groups by it, stable on a rename. */
  id: string;
  path: string;
  name: string;
  /** When the group's items were read from GitLab (RFC 3339). Synchroniser refreshes some
   * groups only, so it differs from one group to the next. */
  syncedAt?: string;
}

export interface Cadence {
  /** Global ID, "gid://gitlab/Iterations::Cadence/3". */
  id: string;
  title: string;
  /** Its iterations are columns of this board (the cadences asked for, or the default, ADR-38). */
  active: boolean;
}

/** A column: one iteration, or several of different active cadences with the same dates
 * (ADR-38). id, title and webUrl are the first one's. */
export interface Iteration {
  id: string;
  title: string; // never empty
  startDate: string; // YYYY-MM-DD
  dueDate: string; // YYYY-MM-DD, inclusive
  webUrl: string;
  current: boolean;
  /** The GitLab iterations of the column, the first one first. */
  iterationIds: string[];
  cadenceIds: string[];
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
  /** Column index; null when the issue has no iteration, or one outside the columns
   * (unplanned, ADR-38). */
  iteration: number | null;
  parentEpic: string; // epic id, "" when none
  assignee: Person | null;
  /** IDs of the epics this issue blocks; empty when it blocks none (every issue is sent, each
   * lane picks the ones it shows, spec §5.1). */
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
  cadences: Cadence[]; // every cadence, sorted by title; the active ones give the columns
  iterations: Iteration[]; // the columns, sorted by start date
  current: number; // index of the current iteration, -1 when none
  groups: Group[]; // root group first, then descendants sorted by path
  labels: Label[];
  epics: Epic[];
  issues: Issue[]; // every synced issue, blocking an epic or not
  links: Link[];
  /** Longest chain of open blocking links, item ids from the first blocker to the last blocked. */
  criticalPath: string[];
}

/** Error body of the API: { error, code }. */
export type ApiErrorCode =
  | 'unauthorized' // GitLab rejected the token (401)
  | 'group_not_found' // GITLAB_GROUP unknown or not visible to the token (404)
  | 'premium_required' // epics / iterations / blocking links unavailable on this instance
  | 'cadence_not_found' // GITLAB_CADENCE matches no cadence, or the group has none
  | 'gitlab_unreachable' // network error / GitLab 5xx (502)
  | 'invalid_scope' // ?refresh=1 named no group known to the backend (400)
  | 'internal';

export interface ApiErrorBody {
  error: string;
  code: ApiErrorCode;
}

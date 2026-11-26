// Contract between the board logic (src/board/*), the board canvas (components/board/*) and
// the app shell (App.tsx and the panels). Pure data: no React here.

import type { BoardData, Iteration, LinkType } from '../api/types';

export type ItemKind = 'epic' | 'issue';

/** Lane colors: identification only, mapped to CSS tokens (--lane-<color>) by
 * [data-lane-color]. Red and green are left out on purpose: they mean "conflict" and "on
 * track"; purple and teal are the epic and issue colors. */
export const LANE_COLORS = ['indigo', 'blue', 'cyan', 'mint', 'yellow', 'orange', 'pink', 'brown'] as const;
export type LaneColor = (typeof LANE_COLORS)[number];

/** Which issues a lane shows (spec §4.4, §5.1): every one, those that block an epic, or none. */
export const ISSUE_MODES = ['all', 'blocking', 'none'] as const;
export type IssueMode = (typeof ISSUE_MODES)[number];

export type LabelMode = 'any' | 'all';

/** A lane is a filter edited by the user (spec §4.4, ADR-34): GitLab groups, item types and
 * labels. Lanes may overlap: an item shows in every active lane it matches. Stored in
 * localStorage (gleipnir.lanes), in display order. */
export interface Lane {
  id: string; // local id, stable across edits
  name: string;
  color: LaneColor;
  groups: string[]; // group global IDs (gid://gitlab/Group/N): stable when a group is renamed
  /** An item of a/b/c matches the group a/b. */
  includeSubgroups: boolean;
  showEpics: boolean;
  issueMode: IssueMode;
  labels: string[]; // label titles; empty: no label filter
  labelMode: LabelMode;
  active: boolean;
}

/** A group in the tree, in tree order (parent first, siblings by path). */
export interface GroupNode {
  path: string;
  id: string;
  name: string;
  depth: number;
  parent: string | null;
  children: string[]; // paths
}

/** Iteration indexes, inclusive, from <= to. */
export interface BoardWindow {
  from: number;
  to: number;
}

export interface DisplayOptions {
  linkTypes: Record<LinkType, boolean>;
  hideClosed: boolean;
  showUnplanned: boolean;
  criticalPath: boolean;
}

export const DEFAULT_OPTIONS: DisplayOptions = {
  linkTypes: { blocks: true, relates: true, parent: false },
  hideClosed: false,
  showUnplanned: true,
  criticalPath: false,
};

export interface ViewInput {
  data: BoardData;
  lanes: Lane[]; // in display order; inactive ones are skipped
  window: BoardWindow;
  options: DisplayOptions;
  query: string; // search on ref and title, case-insensitive, already trimmed
  collapsed: ReadonlySet<string>; // ids of collapsed lanes
  /** Inner width of the scroll container (scrollbar excluded): columns widen to fill it. */
  availableWidth?: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One column of the board: an iteration of the window, or the "Non planifié" column. */
export interface Column {
  key: string; // iteration id, or 'unplanned'
  iteration: Iteration | null; // null for the unplanned column
  index: number | null; // iteration index, null for the unplanned column
  x: number;
  width: number;
  current: boolean;
}

/** One occurrence of an item in a lane (an item matching several lanes shows in each). */
export interface PlacedItem {
  key: string; // `${laneId}|${itemId}`
  laneId: string;
  itemId: string;
  kind: ItemKind;
  rect: Rect;
  clippedStart: boolean; // epic starting before the window (dashed / open left side)
  clippedEnd: boolean; // epic ending after the window
  unplanned: boolean; // placed in the unplanned column
  /** Ids of linked items that match an active lane but sit outside the window (badge "› N"). */
  offWindow: string[];
  /** Ids of items linked by a shown "bloque" or "lié à" link that match no active lane, whatever
   * the window, search and closed filter (badge "N hors couloirs", spec §4.5). */
  offLanes: string[];
  /** Brought in by the search as a dependency of a match, not a match itself (dimmed). */
  searchContext: boolean;
}

export interface LaneBlock {
  lane: Lane;
  top: number;
  height: number;
  collapsed: boolean;
  /** Items shown in this lane for the window (unplanned ones included). */
  counts: { epics: number; issues: number; outside: number };
  empty: boolean; // nothing to show in the window
}

export interface LinkPath {
  key: string;
  type: LinkType;
  source: string; // item ids
  target: string;
  sourceKey: string; // PlacedItem keys joined by this path
  targetKey: string;
  d: string; // SVG path of the curve
  arrow: string | null; // SVG path of the arrowhead (blocks only)
  conflict: boolean;
  critical: boolean; // both ends on the critical path, consecutive
}

export interface BoardStats {
  lanes: number; // active lanes
  epics: number; // unique epics shown (an item in several lanes counts once)
  issues: number; // unique issues shown
  blocks: number; // unique blocks links drawn
  conflicts: number; // unique blocks links drawn in conflict
}

export interface BoardView {
  width: number;
  height: number;
  headerHeight: number;
  railWidth: number;
  columns: Column[];
  lanes: LaneBlock[];
  items: PlacedItem[];
  links: LinkPath[];
  stats: BoardStats;
  /** Unique links drawn per type (sidebar counters). */
  linkCounts: Record<LinkType, number>;
}

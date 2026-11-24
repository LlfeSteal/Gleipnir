// Contract between the board logic (src/board/*), the board canvas (components/board/*) and
// the app shell (App.tsx and the panels). Pure data: no React here.

import type { BoardData, Iteration, LinkType } from '../api/types';

export type ItemKind = 'epic' | 'issue';

/** Lane colors: identification only, mapped to CSS tokens (--lane-<color>) by
 * [data-lane-color]. Red and green are left out on purpose: they mean "conflict" and "on
 * track"; purple and teal are the epic and issue colors. */
export const LANE_COLORS = ['indigo', 'blue', 'cyan', 'mint', 'yellow', 'orange', 'pink', 'brown'] as const;
export type LaneColor = (typeof LANE_COLORS)[number];

/** A lane is a filter (spec §4.4). Stored in localStorage. */
export interface Lane {
  id: string;
  name: string;
  color: LaneColor;
  groups: string[]; // group full paths
  includeSubgroups: boolean;
  showEpics: boolean;
  showIssues: boolean;
  labels: string[]; // empty = no label filter
  labelMode: 'any' | 'all';
  active: boolean;
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
  /** Ids of linked items that match the lane filters but sit outside the window (badge "› N"). */
  offWindow: string[];
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
  issues: number; // unique blocking issues shown
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

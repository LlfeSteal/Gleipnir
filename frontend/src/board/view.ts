// The whole board layout, computed once per input change (pure): columns, lanes, placed items,
// link curves, off-window dependencies and counters. Ported from the mockup's render(), pack(),
// inLane() and geo(), with maps instead of scans so 300 epics / 1000 issues / 3000 links stay
// well under the 300 ms budget (spec §8).

import type { Epic, Issue, LinkType } from '../api/types';
import { isEpicUnplanned, isIssueUnplanned } from './items';
import { laneMatcher, MAX_LANE_LABELS } from './lanes';
import { searchItems } from './search';
import type {
  BoardStats,
  BoardView,
  Column,
  Lane,
  LaneBlock,
  LinkPath,
  PlacedItem,
  Rect,
  ViewInput,
} from './types';
import { clampWindow } from './window';

/** Layout constants, in px. */
export interface BoardLayout {
  railWidth: number;
  headerHeight: number;
  columnWidth: number;
  narrowColumnWidth: number;
  /** Above this many iterations, columns use narrowColumnWidth (spec §4.3). */
  narrowAbove: number;
  inset: number;
  barHeight: number;
  barPitch: number;
  cardHeight: number;
  cardPitch: number;
  /** Extra space between the last epic row and the first issue card. */
  sectionGap: number;
  lanePaddingTop: number;
  lanePaddingBottom: number;
  laneMinHeight: number;
  /** Height of the lane header without labels, and of one more meta line (16 px line + 4 px
   * gap): keep in step with .lane-header in board.css. 0 in the compact rail, which hides them. */
  laneHeaderBase: number;
  laneMetaLine: number;
  collapsedLaneHeight: number;
  arrowLength: number;
  arrowHalfWidth: number;
}

/** The regular layout. Exported for the canvas (empty-lane message, rail) and the tests. */
export const LAYOUT: Readonly<BoardLayout> = {
  railWidth: 220,
  headerHeight: 56,
  columnWidth: 212,
  narrowColumnWidth: 180,
  /** Above this many iterations, columns use narrowColumnWidth (spec §4.3). */
  narrowAbove: 7,
  inset: 8,
  barHeight: 28,
  barPitch: 36,
  cardHeight: 100,
  cardPitch: 108,
  /** Extra space between the last epic row and the first issue card. */
  sectionGap: 4,
  lanePaddingTop: 12,
  lanePaddingBottom: 12,
  laneMinHeight: 120,
  // 8 + 8 padding, 24 top row, two 20 px meta lines (groups, issue mode), 4 + 18 counts.
  laneHeaderBase: 102,
  laneMetaLine: 20,
  collapsedLaneHeight: 64,
  arrowLength: 6,
  arrowHalfWidth: 3.5,
};

/** The phone layout (≤ 760 px): a narrow rail (color edge, chevron, name on two lines, pencil)
 * and narrower columns, so that a 390 px screen shows the rail and about one and a half
 * columns. Items keep their height: only widths change. The canvas recognizes it by its rail
 * width (isCompactView). */
export const COMPACT_LAYOUT: Readonly<BoardLayout> = {
  ...LAYOUT,
  railWidth: 124,
  columnWidth: 172,
  narrowColumnWidth: 172,
  laneMinHeight: 96,
  laneHeaderBase: 0,
  laneMetaLine: 0,
  collapsedLaneHeight: 80,
};

/** The height a lane's header needs (§4.1): its labels add a « Labels · … » line and one line
 * per shown label, so that the header, which clips its overflow, never cuts its counts. */
export function laneHeaderHeight(lane: Pick<Lane, 'labels'>, L: Readonly<BoardLayout>): number {
  const labelLines = lane.labels.length ? 1 + Math.min(lane.labels.length, MAX_LANE_LABELS) : 0;
  return L.laneHeaderBase + labelLines * L.laneMetaLine;
}

export const layoutFor = (compact: boolean): Readonly<BoardLayout> => (compact ? COMPACT_LAYOUT : LAYOUT);

/** True for a view laid out with COMPACT_LAYOUT: the rail then shows its compact header. */
export const isCompactView = (view: BoardView): boolean => view.railWidth <= COMPACT_LAYOUT.railWidth;

type Status = 'in' | 'out' | 'unplanned';

interface EpicEntry {
  epic: Epic;
  order: number;
  status: Status;
  s: number; // clipped to the window when in
  e: number;
}

interface LaneContent {
  lane: Lane;
  epicsIn: EpicEntry[];
  issuesIn: Issue[];
  epicsUnplanned: Epic[];
  issuesUnplanned: Issue[];
  outside: number;
  /** Ids of every item shown by the lane (filters, query, hide closed), whatever the window. */
  matching: Set<string>;
}

const round = (v: number) => Math.round(v * 10) / 10;

export function computeBoardView(input: ViewInput, layout: Readonly<BoardLayout> = LAYOUT): BoardView {
  const { data, options, collapsed } = input;
  const L = layout;
  const count = data.iterations.length;
  const win = clampWindow(input.window, count);
  const from = win.from;
  const to = count > 0 ? win.to : from - 1;
  const n = Math.max(0, to - from + 1);

  // Item-level filters and window status, computed once for all lanes. The search keeps its
  // matches and their dependency chains.
  const search = searchItems(data, input.query, options.linkTypes);
  const inSearch = (id: string) => !search || search.matches.has(id) || search.chain.has(id);
  const status = new Map<string, Status>();
  const epics: EpicEntry[] = [];
  data.epics.forEach((epic, order) => {
    let st: Status;
    let s = 0;
    let e = 0;
    if (isEpicUnplanned(epic)) st = 'unplanned';
    else if ((epic.end as number) >= from && (epic.start as number) <= to) {
      st = 'in';
      s = Math.max(epic.start as number, from);
      e = Math.min(epic.end as number, to);
    } else st = 'out';
    status.set(epic.id, st);
    epics.push({ epic, order, status: st, s, e });
  });
  for (const issue of data.issues) {
    const it = issue.iteration;
    const st: Status = isIssueUnplanned(issue) ? 'unplanned' : (it as number) >= from && (it as number) <= to ? 'in' : 'out';
    status.set(issue.id, st);
  }
  const shownIssue = (issue: Issue) => inSearch(issue.id) && !(options.hideClosed && issue.state === 'closed');

  // Each active lane takes every item matching its filters (spec §5.1): lanes may overlap.
  // inLanes ignores the window, the search and the closed filter: an item outside it is "hors
  // couloirs" (spec §4.5).
  const inLanes = new Set<string>();
  const contents: LaneContent[] = input.lanes
    .filter((lane) => lane.active)
    .map((lane) => {
      const c: LaneContent = {
        lane,
        epicsIn: [],
        issuesIn: [],
        epicsUnplanned: [],
        issuesUnplanned: [],
        outside: 0,
        matching: new Set(),
      };
      const matches = laneMatcher(lane, data);
      for (const entry of epics) {
        if (!matches(entry.epic, 'epic')) continue;
        inLanes.add(entry.epic.id);
        if (!inSearch(entry.epic.id)) continue;
        c.matching.add(entry.epic.id);
        if (entry.status === 'in') c.epicsIn.push(entry);
        else if (entry.status === 'unplanned') c.epicsUnplanned.push(entry.epic);
        else c.outside++;
      }
      for (const issue of data.issues) {
        if (!matches(issue, 'issue')) continue;
        inLanes.add(issue.id);
        if (!shownIssue(issue)) continue;
        c.matching.add(issue.id);
        const st = status.get(issue.id);
        if (st === 'in') c.issuesIn.push(issue);
        else if (st === 'unplanned') c.issuesUnplanned.push(issue);
        else c.outside++;
      }
      return c;
    });

  const unplannedColumn =
    options.showUnplanned && contents.some((c) => c.epicsUnplanned.length > 0 || c.issuesUnplanned.length > 0);

  // Columns share the available width equally, never narrower than the layout's width (then
  // the board scrolls). Floored so the canvas never overflows by a fraction of a pixel.
  const minW = n > L.narrowAbove ? L.narrowColumnWidth : L.columnWidth;
  const total = n + (unplannedColumn ? 1 : 0);
  const fill = total > 0 && input.availableWidth ? Math.floor((input.availableWidth - L.railWidth) / total) : 0;
  const colW = Math.max(minW, fill);
  const colX = (i: number) => L.railWidth + (i - from) * colW;

  const columns: Column[] = [];
  for (let i = from; i <= to; i++) {
    const iteration = data.iterations[i];
    columns.push({ key: iteration.id, iteration, index: i, x: colX(i), width: colW, current: iteration.current });
  }
  const unplannedX = L.railWidth + n * colW;
  if (unplannedColumn) {
    columns.push({ key: 'unplanned', iteration: null, index: null, x: unplannedX, width: colW, current: false });
  }
  const width = unplannedX + (unplannedColumn ? colW : 0);

  // Lanes, top to bottom.
  const items: PlacedItem[] = [];
  const occurrences = new Map<string, PlacedItem[]>();
  const place = (lane: Lane, id: string, kind: 'epic' | 'issue', rect: Rect, extra?: Partial<PlacedItem>) => {
    const p: PlacedItem = {
      key: `${lane.id}|${id}`,
      laneId: lane.id,
      itemId: id,
      kind,
      rect,
      clippedStart: false,
      clippedEnd: false,
      unplanned: false,
      offWindow: [],
      offLanes: [],
      searchContext: !!search && !search.matches.has(id),
      ...extra,
    };
    items.push(p);
    const list = occurrences.get(id);
    if (list) list.push(p);
    else occurrences.set(id, [p]);
    return p;
  };

  const blocks: LaneBlock[] = [];
  let y = L.headerHeight;
  for (const c of contents) {
    const top = y;
    const epicsShown = c.epicsIn.length + (unplannedColumn ? c.epicsUnplanned.length : 0);
    const issuesShown = c.issuesIn.length + (unplannedColumn ? c.issuesUnplanned.length : 0);
    const isCollapsed = collapsed.has(c.lane.id);
    const block: LaneBlock = {
      lane: c.lane,
      top,
      height: L.collapsedLaneHeight,
      collapsed: isCollapsed,
      counts: { epics: epicsShown, issues: issuesShown, outside: c.outside },
      empty: epicsShown + issuesShown === 0,
    };
    blocks.push(block);
    if (isCollapsed) {
      y += block.height;
      continue;
    }

    const body = top + L.lanePaddingTop;
    let bottom = body;

    // Epic bars on the fewest rows: interval partitioning, by start then longest first.
    const sorted = c.epicsIn.slice().sort((a, b) => a.s - b.s || b.e - a.e || a.order - b.order);
    const rowEnds: number[] = [];
    for (const entry of sorted) {
      let row = rowEnds.findIndex((end) => end < entry.s);
      if (row < 0) {
        row = rowEnds.length;
        rowEnds.push(entry.e);
      } else rowEnds[row] = entry.e;
      const x = colX(entry.s) + L.inset;
      const rect = { x, y: body + row * L.barPitch, w: colX(entry.e) + colW - L.inset - x, h: L.barHeight };
      const epic = entry.epic;
      place(c.lane, epic.id, 'epic', rect, {
        clippedStart: (epic.start as number) < from,
        clippedEnd: (epic.end as number) > to,
      });
      bottom = Math.max(bottom, rect.y + rect.h);
    }

    // Issue cards stacked in their iteration's column, below the epic rows.
    const issueTop = body + (rowEnds.length ? rowEnds.length * L.barPitch + L.sectionGap : 0);
    const stacks = new Array<number>(n).fill(0);
    for (const issue of c.issuesIn) {
      const it = issue.iteration as number;
      const k = stacks[it - from]++;
      const rect = { x: colX(it) + L.inset, y: issueTop + k * L.cardPitch, w: colW - 2 * L.inset, h: L.cardHeight };
      place(c.lane, issue.id, 'issue', rect);
      bottom = Math.max(bottom, rect.y + rect.h);
    }

    // Unplanned column: compact epic bars, then cards.
    if (unplannedColumn) {
      let uy = body;
      const x = unplannedX + L.inset;
      const w = colW - 2 * L.inset;
      for (const epic of c.epicsUnplanned) {
        const rect = { x, y: uy, w, h: L.barHeight };
        place(c.lane, epic.id, 'epic', rect, { unplanned: true });
        bottom = Math.max(bottom, rect.y + rect.h);
        uy += L.barPitch;
      }
      if (c.epicsUnplanned.length && c.issuesUnplanned.length) uy += L.sectionGap;
      for (const issue of c.issuesUnplanned) {
        const rect = { x, y: uy, w, h: L.cardHeight };
        place(c.lane, issue.id, 'issue', rect, { unplanned: true });
        bottom = Math.max(bottom, rect.y + rect.h);
        uy += L.cardPitch;
      }
    }

    block.height = Math.max(L.laneMinHeight, laneHeaderHeight(c.lane, L), bottom + L.lanePaddingBottom - top);
    y += block.height;
  }
  const height = y;

  // Links between placed items, and dependencies left outside the window or the lanes.
  const matching = new Set<string>();
  for (const c of contents) for (const id of c.matching) matching.add(id);
  const offWindow = new Map<string, Set<string>>(); // placed key -> item ids
  const offLanes = new Map<string, Set<string>>();
  const addTo = (map: Map<string, Set<string>>, placed: PlacedItem[], other: string) => {
    for (const p of placed) {
      let set = map.get(p.key);
      if (!set) map.set(p.key, (set = new Set()));
      set.add(other);
    }
  };
  const addOff = (placed: PlacedItem[], other: string, type: LinkType) => {
    if (status.get(other) === 'out' && matching.has(other)) addTo(offWindow, placed, other);
    // Hierarchy links don't count: every epic would be flagged for the issues its lanes hide.
    else if (type !== 'parent' && status.has(other) && !inLanes.has(other)) addTo(offLanes, placed, other);
  };
  const critical = new Set<string>();
  for (let i = 0; i + 1 < data.criticalPath.length; i++) {
    critical.add(`${data.criticalPath[i]}\n${data.criticalPath[i + 1]}`);
  }
  const drawn: Record<LinkType, Set<string>> = { blocks: new Set(), relates: new Set(), parent: new Set() };
  const conflicts = new Set<string>();
  const links: LinkPath[] = [];
  const seen = new Set<string>();
  for (const link of data.links) {
    if (!options.linkTypes[link.type] || link.source === link.target) continue;
    const a = occurrences.get(link.source);
    const b = occurrences.get(link.target);
    if (!a || !b) {
      if (a) addOff(a, link.target, link.type);
      if (b) addOff(b, link.source, link.type);
      continue;
    }
    const pair = `${link.source}\n${link.target}`;
    drawn[link.type].add(pair);
    if (link.type === 'blocks' && link.conflict) conflicts.add(pair);
    const isCritical = link.type === 'blocks' && critical.has(pair);
    // One path per occurrence of the source, to the target in the same lane, else its first one.
    for (const pa of a) {
      const pb = b.find((p) => p.laneId === pa.laneId) ?? b[0];
      const key = `${pa.key}>${pb.key}:${link.type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const g = curve(pa.rect, pb.rect, pa.kind === 'issue' && pb.kind === 'issue', link.type === 'blocks');
      links.push({
        key,
        type: link.type,
        source: link.source,
        target: link.target,
        sourceKey: pa.key,
        targetKey: pb.key,
        d: g.d,
        arrow: g.arrow,
        conflict: link.conflict,
        critical: isCritical,
      });
    }
  }
  for (const p of items) {
    const off = offWindow.get(p.key);
    if (off) p.offWindow = [...off];
    const out = offLanes.get(p.key);
    if (out) p.offLanes = [...out];
  }

  const epicIds = new Set<string>();
  const issueIds = new Set<string>();
  for (const p of items) (p.kind === 'epic' ? epicIds : issueIds).add(p.itemId);
  const stats: BoardStats = {
    lanes: contents.length,
    epics: epicIds.size,
    issues: issueIds.size,
    blocks: drawn.blocks.size,
    conflicts: conflicts.size,
  };

  return {
    width,
    height,
    headerHeight: L.headerHeight,
    railWidth: L.railWidth,
    columns,
    lanes: blocks,
    items,
    links,
    stats,
    linkCounts: { blocks: drawn.blocks.size, relates: drawn.relates.size, parent: drawn.parent.size },
  };
}

/** The curve between two items (mockup geo()): side by side, a horizontal curve from edge to
 * edge; one above the other, a vertical curve aligned on the narrower item; two issues in the
 * same column, a loop on the right side so it doesn't cross the cards in between. With an
 * arrow, the curve stops at the arrowhead's base so the stroke never blunts its tip. */
export function curve(a: Rect, b: Rect, bothIssues: boolean, withArrow: boolean): { d: string; arrow: string | null } {
  const ax = a.x + a.w / 2;
  const ay = a.y + a.h / 2;
  const bx = b.x + b.w / 2;
  const by = b.y + b.h / 2;
  const right = b.x >= a.x + a.w - 1;
  const left = a.x >= b.x + b.w - 1;
  const len = withArrow ? LAYOUT.arrowLength : 0;
  let x1: number, y1: number, x2: number, y2: number, dx: number, dy: number;
  let c1x: number, c1y: number, c2x: number, c2y: number;
  if (bothIssues && Math.abs(ax - bx) < 2) {
    x1 = a.x + a.w;
    y1 = ay;
    x2 = b.x + b.w;
    y2 = by;
    const k = Math.min(34, 16 + Math.abs(y2 - y1) / 8);
    [c1x, c1y, c2x, c2y, dx, dy] = [x1 + k, y1, x2 + k, y2, -1, 0];
  } else if (right || left) {
    const s = right ? 1 : -1;
    x1 = right ? a.x + a.w : a.x;
    y1 = ay;
    x2 = right ? b.x : b.x + b.w;
    y2 = by;
    const k = Math.max(24, Math.abs(x2 - x1) / 2);
    [c1x, c1y, c2x, c2y, dx, dy] = [x1 + s * k, y1, x2 - s * k, y2, s, 0];
  } else {
    const s = by > ay ? 1 : -1;
    const lo = Math.max(a.x, b.x) + 14;
    const hi = Math.min(a.x + a.w, b.x + b.w) - 14;
    if (lo <= hi) {
      x1 = x2 = Math.max(lo, Math.min(hi, a.w < b.w ? ax : bx));
    } else {
      x1 = ax;
      x2 = bx;
    }
    y1 = s > 0 ? a.y + a.h : a.y;
    y2 = s > 0 ? b.y : b.y + b.h;
    const k = Math.max(14, Math.abs(y2 - y1) / 2);
    [c1x, c1y, c2x, c2y, dx, dy] = [x1, y1 + s * k, x2, y2 - s * k, 0, s];
  }
  const ex = x2 - dx * len;
  const ey = y2 - dy * len;
  const d = `M${round(x1)} ${round(y1)} C${round(c1x)} ${round(c1y)} ${round(c2x)} ${round(c2y)} ${round(ex)} ${round(ey)}`;
  if (!withArrow) return { d, arrow: null };
  const px = -dy * LAYOUT.arrowHalfWidth;
  const py = dx * LAYOUT.arrowHalfWidth;
  const arrow = `M${round(x2)} ${round(y2)} L${round(ex + px)} ${round(ey + py)} L${round(ex - px)} ${round(ey - py)} Z`;
  return { d, arrow };
}

/** The item and every item linked to it by a drawn link. */
export function connectedIds(view: BoardView, id: string): Set<string> {
  const ids = new Set([id]);
  for (const l of view.links) {
    if (l.source === id) ids.add(l.target);
    else if (l.target === id) ids.add(l.source);
  }
  return ids;
}

// Lanes are filters edited by the user (spec §4.4, ADR-34): GitLab groups (and their subgroups),
// item types with the issue mode, and labels. They may overlap: an item shows in every active
// lane it matches. Groups are named by their global ID, so a renamed group keeps its lanes.

import type { BoardData, Epic, Group, Issue } from '../api/types';
import { BOARD } from '../strings/board';
import { matchesLabels } from './items';
import { ISSUE_MODES, LANE_COLORS, type GroupNode, type ItemKind, type Lane, type LaneColor } from './types';

/** Labels a lane header lists by name before « et N autres… » (§4.1), like an issue card's two. */
export const MAX_LANE_LABELS = 2;

const treeCache = new WeakMap<BoardData, GroupNode[]>();
const pathCache = new WeakMap<BoardData, Map<string, string>>();

/** The parent path of a group path, null at the top. */
function parentPath(path: string): string | null {
  const i = path.lastIndexOf('/');
  return i < 0 ? null : path.slice(0, i);
}

/**
 * The groups in tree order: the root, then each group followed by its subgroups, siblings
 * sorted by path. Not a plain sort on paths: "a/b-x" would come before "a/b/c". A group whose
 * parent is not listed hangs under the root. Cached per BoardData.
 */
export function groupTree(data: BoardData): GroupNode[] {
  const cached = treeCache.get(data);
  if (cached) return cached;
  const root = data.rootGroup.path;
  const byPath = new Map(data.groups.map((g) => [g.path, g]));
  byPath.set(root, { ...data.rootGroup, ...byPath.get(root) });
  const children = new Map<string, string[]>();
  for (const path of byPath.keys()) {
    if (path === root) continue;
    let parent = parentPath(path);
    if (parent === null || !byPath.has(parent)) parent = root;
    children.set(parent, [...(children.get(parent) ?? []), path]);
  }
  const nodes: GroupNode[] = [];
  const visit = (path: string, depth: number, parent: string | null) => {
    const group = byPath.get(path)!;
    const kids = (children.get(path) ?? []).sort((a, b) => a.localeCompare(b));
    nodes.push({ path, id: group.id ?? '', name: group.name, depth, parent, children: kids });
    for (const kid of kids) visit(kid, depth + 1, path);
  };
  visit(root, 0, null);
  treeCache.set(data, nodes);
  return nodes;
}

/** Group paths by global ID, cached per BoardData. */
function groupPaths(data: BoardData): Map<string, string> {
  let paths = pathCache.get(data);
  if (!paths) {
    paths = new Map(groupTree(data).map((node) => [node.id, node.path]));
    pathCache.set(data, paths);
  }
  return paths;
}

/** The paths of a lane's groups; unknown IDs are left out. */
export function lanePaths(lane: Lane, data: BoardData): string[] {
  const paths = groupPaths(data);
  return lane.groups.flatMap((id) => paths.get(id) ?? []);
}

/** The first color not used by the lanes, else the palette again from the start. */
export function nextLaneColor(existing: readonly Lane[]): LaneColor {
  const used = new Set(existing.map((l) => l.color));
  return LANE_COLORS.find((c) => !used.has(c)) ?? LANE_COLORS[existing.length % LANE_COLORS.length];
}

/** One lane per direct subgroup of the root, in tree order (the root alone when it has none),
 * with its subgroups, its epics and the issues that block an epic: the example configuration.
 * Ids derive from the group, so collapsed lanes survive a reset. */
export function defaultLanes(data: BoardData): Lane[] {
  const tree = groupTree(data);
  const [root] = tree;
  const byPath = new Map(tree.map((node) => [node.path, node]));
  const sources = root.children.length > 0 ? root.children.map((path) => byPath.get(path)!) : [root];
  return sources.map((node, i) => ({
    id: `group:${node.id || node.path}`,
    name: node.name,
    color: LANE_COLORS[i % LANE_COLORS.length],
    groups: [node.id],
    includeSubgroups: true,
    showEpics: true,
    issueMode: 'blocking',
    labels: [],
    labelMode: 'any',
    active: true,
  }));
}

/** A new lane: the first free color, every type, no group yet. */
export function newLane(existing: readonly Lane[]): Lane {
  const ids = new Set(existing.map((l) => l.id));
  let n = existing.length + 1;
  while (ids.has(`lane-${n}`)) n++;
  return {
    id: `lane-${n}`,
    name: BOARD.newLaneName,
    color: nextLaneColor(existing),
    groups: [],
    includeSubgroups: true,
    showEpics: true,
    issueMode: 'blocking',
    labels: [],
    labelMode: 'any',
    active: true,
  };
}

/** Whether an item matches a lane's filters (spec §5.1, §5.3), whatever the window, the search
 * and the closed filter. Resolved once against the data, to test many items quickly. A lane
 * without a known group matches nothing. */
export type LaneMatcher = (item: Epic | Issue, kind: ItemKind) => boolean;

export function laneMatcher(lane: Lane, data: BoardData): LaneMatcher {
  const paths = lanePaths(lane, data);
  const exact = new Set(paths);
  const prefixes = lane.includeSubgroups ? paths.map((p) => `${p}/`) : [];
  return (item, kind) => {
    if (kind === 'epic') {
      if (!lane.showEpics) return false;
    } else if (lane.issueMode === 'none' || (lane.issueMode === 'blocking' && (item as Issue).blocksEpics.length === 0)) {
      return false;
    }
    const path = item.groupPath;
    if (!exact.has(path) && !prefixes.some((p) => path.startsWith(p))) return false;
    return matchesLabels(item.labels, lane.labels, lane.labelMode);
  };
}

export function groupName(path: string, groups: Group[]): string {
  return groups.find((g) => g.path === path)?.name ?? path.split('/').pop() ?? path;
}

/** The names of a lane's groups, in its order; unknown IDs are left out. */
export function laneGroupNames(lane: Lane, data: BoardData): string[] {
  return lanePaths(lane, data).map((path) => groupName(path, data.groups));
}

/** One line describing a lane: "Identité · epics, issues bloquantes · au moins un de : bug". */
export function laneSummary(lane: Lane, data: BoardData): string {
  const names = laneGroupNames(lane, data);
  const groups = names.length ? names.join(', ') : BOARD.noGroup;
  const types = [lane.showEpics ? BOARD.typeEpics : '', lane.issueMode === 'none' ? '' : BOARD.issueModes[lane.issueMode]]
    .filter(Boolean)
    .join(', ');
  return `${groups} · ${types || BOARD.noType} · ${labelsText(lane)}`;
}

/** "tous les labels", "au moins un de : bug, UX" or "tous : bug, UX". */
export function labelsText(lane: Pick<Lane, 'labels' | 'labelMode'>): string {
  if (lane.labels.length === 0) return BOARD.allLabels;
  return lane.labelMode === 'all' ? BOARD.labelsAll(lane.labels) : BOARD.labelsAny(lane.labels);
}

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === 'string');

/**
 * Lanes read back from storage, checked field by field against the data: unknown groups and
 * labels are dropped, a lane left without a group is dropped, a bad color takes the palette's
 * by index, a bad issue mode the default, a bad flag its default. null when the value is not a
 * list at all (nothing stored, or garbage): the default lanes then apply. An empty list stays
 * empty: the user removed every lane.
 */
export function validateLanes(value: unknown, data: BoardData): Lane[] | null {
  if (!Array.isArray(value)) return null;
  const known = groupPaths(data);
  const labels = new Set(data.labels.map((l) => l.title));
  const ids = new Set<string>();
  const lanes: Lane[] = [];
  value.forEach((raw, index) => {
    if (!isObject(raw)) return;
    const groups = isStringArray(raw.groups) ? [...new Set(raw.groups.filter((id) => known.has(id)))] : [];
    if (groups.length === 0) return;
    let id = typeof raw.id === 'string' && raw.id ? raw.id : `lane-${index + 1}`;
    for (let n = index + 1; ids.has(id); n++) id = `lane-${n}`;
    ids.add(id);
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    const flag = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
    lanes.push({
      id,
      name: name || BOARD.untitledLane,
      color: (LANE_COLORS as readonly unknown[]).includes(raw.color) ? (raw.color as LaneColor) : LANE_COLORS[index % LANE_COLORS.length],
      groups,
      includeSubgroups: flag(raw.includeSubgroups, true),
      showEpics: flag(raw.showEpics, true),
      issueMode: (ISSUE_MODES as readonly unknown[]).includes(raw.issueMode) ? (raw.issueMode as Lane['issueMode']) : 'blocking',
      labels: isStringArray(raw.labels) ? [...new Set(raw.labels.filter((l) => labels.has(l)))] : [],
      labelMode: raw.labelMode === 'all' ? 'all' : 'any',
      active: flag(raw.active, true),
    });
  });
  return lanes;
}

/** The groups Synchroniser reads again: those of the active lanes, sorted, without a group
 * whose ancestor is listed (the backend reads each one with its whole subtree: the issues live
 * in projects, below the group, even for a lane without subgroups). */
export function refreshScope(lanes: readonly Lane[], data: BoardData): string[] {
  const paths = [...new Set(lanes.filter((lane) => lane.active).flatMap((lane) => lanePaths(lane, data)))].sort();
  const scope: string[] = [];
  for (const path of paths) {
    // Sorted: an ancestor comes before its descendants.
    if (!scope.some((s) => path === s || path.startsWith(`${s}/`))) scope.push(path);
  }
  return scope;
}

/** When the oldest group shown by the active lanes was read from GitLab, null when unknown.
 * Groups are refreshed separately, so this is how old the board in front of the user is. */
export function scopeSyncedAt(data: BoardData, lanes: readonly Lane[]): string | null {
  const covers = lanes
    .filter((lane) => lane.active)
    .map((lane) => {
      const paths = lanePaths(lane, data);
      return (path: string) => paths.some((p) => path === p || (lane.includeSubgroups && path.startsWith(`${p}/`)));
    });
  let oldest: string | null = null;
  let oldestTime = Infinity;
  for (const group of data.groups) {
    if (!group.syncedAt || !covers.some((cover) => cover(group.path))) continue;
    const time = Date.parse(group.syncedAt);
    if (time < oldestTime) {
      oldestTime = time;
      oldest = group.syncedAt;
    }
  }
  return oldest;
}

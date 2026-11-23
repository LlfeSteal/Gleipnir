// Lanes are filters (spec §4.4): groups (+ subgroups), item types and labels.

import type { BoardData, Epic, Group, Issue } from '../api/types';
import { BOARD } from '../strings/board';
import { LANE_COLORS, type ItemKind, type Lane } from './types';

/** One lane per direct subgroup of the root group, sorted by path; one lane for the root group
 * when it has no subgroup. Ids derive from the group path so collapsed state survives reloads. */
export function defaultLanes(data: BoardData): Lane[] {
  const root = data.rootGroup;
  const prefix = `${root.path}/`;
  const subgroups = data.groups
    .filter((g) => g.path.startsWith(prefix) && !g.path.slice(prefix.length).includes('/'))
    .sort((a, b) => a.path.localeCompare(b.path));
  const sources: Group[] = subgroups.length > 0 ? subgroups : [root];
  return sources.map((g, i) => ({
    id: `group:${g.path}`,
    name: g.name,
    color: LANE_COLORS[i % LANE_COLORS.length],
    groups: [g.path],
    includeSubgroups: true,
    showEpics: true,
    showIssues: true,
    labels: [],
    labelMode: 'any',
    active: true,
  }));
}

/** Whether an item matches a lane's filters, regardless of the window. A lane without groups
 * matches nothing. */
export function matchLane(lane: Lane, item: Epic | Issue, kind: ItemKind): boolean {
  if (kind === 'epic' ? !lane.showEpics : !lane.showIssues) return false;
  if (!laneCoversGroup(lane, item.groupPath)) return false;
  if (lane.labels.length === 0) return true;
  return lane.labelMode === 'all'
    ? lane.labels.every((l) => item.labels.includes(l))
    : lane.labels.some((l) => item.labels.includes(l));
}

/** A new, empty lane: the first color not used yet, all types, no group. */
export function newLane(existing: Lane[]): Lane {
  const used = new Set(existing.map((l) => l.color));
  const color = LANE_COLORS.find((c) => !used.has(c)) ?? LANE_COLORS[existing.length % LANE_COLORS.length];
  const ids = new Set(existing.map((l) => l.id));
  let n = existing.length + 1;
  while (ids.has(`lane-${n}`)) n++;
  return {
    id: `lane-${n}`,
    name: BOARD.newLaneName,
    color,
    groups: [],
    includeSubgroups: true,
    showEpics: true,
    showIssues: true,
    labels: [],
    labelMode: 'any',
    active: true,
  };
}

export function groupName(path: string, groups: Group[]): string {
  return groups.find((g) => g.path === path)?.name ?? path.split('/').pop() ?? path;
}

/** One line describing a lane: "Identité · epics, issues · au moins un de : bug". */
export function laneSummary(lane: Lane, groups: Group[]): string {
  const g = lane.groups.length ? lane.groups.map((p) => groupName(p, groups)).join(', ') : BOARD.noGroup;
  const types = [lane.showEpics ? BOARD.typeEpics : '', lane.showIssues ? BOARD.typeIssues : '']
    .filter(Boolean)
    .join(', ');
  const labels = lane.labels.length
    ? lane.labelMode === 'all'
      ? BOARD.labelsAll(lane.labels)
      : BOARD.labelsAny(lane.labels)
    : BOARD.allLabels;
  return `${g} · ${types || BOARD.noType} · ${labels}`;
}

/** Whether a lane shows the items of the group at path (its groups, and their subgroups when
 * it includes them). */
function laneCoversGroup(lane: Lane, path: string): boolean {
  return lane.groups.some((g) => path === g || (lane.includeSubgroups && path.startsWith(`${g}/`)));
}

/** The groups Synchroniser reads again: those of the active lanes, sorted, without a group
 * whose ancestor is listed (the backend reads each one with its whole subtree: the issues live
 * in projects, below the group, even for a lane without subgroups). */
export function refreshScope(lanes: Lane[]): string[] {
  const paths = [...new Set(lanes.filter((lane) => lane.active).flatMap((lane) => lane.groups))].sort();
  const scope: string[] = [];
  for (const path of paths) {
    // Sorted: an ancestor comes before its descendants.
    if (!scope.some((s) => path === s || path.startsWith(`${s}/`))) scope.push(path);
  }
  return scope;
}

/** When the oldest group shown by the active lanes was read from GitLab, null when unknown.
 * Groups are refreshed separately, so this is how old the board in front of the user is. */
export function scopeSyncedAt(data: BoardData, lanes: Lane[]): string | null {
  const active = lanes.filter((lane) => lane.active);
  let oldest: string | null = null;
  let oldestTime = Infinity;
  for (const group of data.groups) {
    if (!group.syncedAt || !active.some((lane) => laneCoversGroup(lane, group.path))) continue;
    const time = Date.parse(group.syncedAt);
    if (time < oldestTime) {
      oldestTime = time;
      oldest = group.syncedAt;
    }
  }
  return oldest;
}

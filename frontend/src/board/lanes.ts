// Lanes are the checked groups of the GitLab group tree (ADR-32, spec §4.4): read only, named
// and colored after GitLab. An item goes to the lane of its closest checked group, itself or
// the first checked one up its path: one lane per item.

import type { BoardData } from '../api/types';
import { LANE_COLORS, type GroupNode, type Lane, type LaneColor } from './types';

const treeCache = new WeakMap<BoardData, GroupNode[]>();

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

/** The groups checked by default: the direct subgroups of the root, or the root without any. */
export function defaultChecked(data: BoardData): string[] {
  const [root] = groupTree(data);
  return root.children.length > 0 ? [...root.children] : [root.path];
}

/** A stable color: that of the direct subgroup the group belongs to, by its place among them
 * (a sublane takes its parent's color); the root has the last one. Checking a group never
 * changes another lane's color. */
export function laneColor(data: BoardData, path: string): LaneColor {
  const tree = groupTree(data);
  const [root] = tree;
  if (path === root.path) return LANE_COLORS[LANE_COLORS.length - 1];
  const nodes = new Map(tree.map((n) => [n.path, n]));
  let node = nodes.get(path);
  while (node?.parent && node.parent !== root.path) node = nodes.get(node.parent);
  const index = node ? root.children.indexOf(node.path) : -1;
  return LANE_COLORS[Math.max(0, index) % LANE_COLORS.length];
}

/** The lanes of the checked groups, in tree order; unknown paths are left out. */
export function lanesOf(data: BoardData, checked: ReadonlySet<string>): Lane[] {
  const tree = groupTree(data);
  const names = new Map(tree.map((n) => [n.path, n]));
  return tree
    .filter((node) => checked.has(node.path))
    .map((node) => {
      const chain: string[] = [];
      for (let n: GroupNode | undefined = node; n && n.depth > 0; n = n.parent ? names.get(n.parent) : undefined) {
        chain.unshift(n.name);
      }
      return {
        id: node.path,
        name: node.name,
        title: node.depth === 0 ? node.name : chain.join(' › '),
        color: laneColor(data, node.path),
        depth: node.depth,
      };
    });
}

/** The lane of an item of the group at path: the closest checked group, itself or up its
 * path; null when none is checked. */
export function laneOf(path: string, checked: ReadonlySet<string>): string | null {
  for (let p: string | null = path; p !== null; p = parentPath(p)) {
    if (checked.has(p)) return p;
  }
  return null;
}

/** The groups Synchroniser reads again: the checked ones, sorted, without a group whose
 * ancestor is listed (the backend reads each one with its whole subtree: an unchecked subgroup
 * shows in its checked parent's lane). */
export function refreshScope(checked: ReadonlySet<string>): string[] {
  const paths = [...checked].sort();
  const scope: string[] = [];
  for (const path of paths) {
    // Sorted: an ancestor comes before its descendants.
    if (!scope.some((s) => path === s || path.startsWith(`${s}/`))) scope.push(path);
  }
  return scope;
}

/** When the oldest group shown by a lane was read from GitLab, null when unknown. Groups are
 * refreshed separately, so this is how old the board in front of the user is. */
export function scopeSyncedAt(data: BoardData, checked: ReadonlySet<string>): string | null {
  let oldest: string | null = null;
  let oldestTime = Infinity;
  for (const group of data.groups) {
    if (!group.syncedAt || laneOf(group.path, checked) === null) continue;
    const time = Date.parse(group.syncedAt);
    if (time < oldestTime) {
      oldestTime = time;
      oldest = group.syncedAt;
    }
  }
  return oldest;
}

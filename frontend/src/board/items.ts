// Lookup of epics and issues by id, cached per BoardData object: the data is immutable once
// fetched, and several helpers (window, inspector, canvas) need O(1) access by id.

import type { BoardData, Epic, Issue } from '../api/types';

export type BoardItem = { kind: 'epic'; item: Epic } | { kind: 'issue'; item: Issue };

const cache = new WeakMap<BoardData, Map<string, BoardItem>>();

export function itemIndex(data: BoardData): Map<string, BoardItem> {
  let index = cache.get(data);
  if (!index) {
    index = new Map();
    for (const item of data.epics) index.set(item.id, { kind: 'epic', item });
    for (const item of data.issues) index.set(item.id, { kind: 'issue', item });
    cache.set(data, index);
  }
  return index;
}

export function findItem(data: BoardData, id: string): BoardItem | null {
  return itemIndex(data).get(id) ?? null;
}

export function isEpicUnplanned(epic: Epic): boolean {
  return epic.unplanned || epic.start === null || epic.end === null;
}

export function isIssueUnplanned(issue: Issue): boolean {
  return issue.unplanned || issue.iteration === null;
}

export function isUnplanned(entry: BoardItem): boolean {
  return entry.kind === 'epic' ? isEpicUnplanned(entry.item) : isIssueUnplanned(entry.item);
}

const labelCache = new WeakMap<BoardData, Map<string, string>>();

/** GitLab label colors by title, cached per BoardData. */
export function labelColors(data: BoardData): Map<string, string> {
  let colors = labelCache.get(data);
  if (!colors) {
    colors = new Map(data.labels.map((l) => [l.title, l.color]));
    labelCache.set(data, colors);
  }
  return colors;
}

/** Display refs of item ids ("&18"), unknown ids left out. */
export function refsOf(data: BoardData, ids: string[]): string[] {
  const index = itemIndex(data);
  const refs: string[] = [];
  for (const id of ids) {
    const entry = index.get(id);
    if (entry) refs.push(entry.item.ref);
  }
  return refs;
}

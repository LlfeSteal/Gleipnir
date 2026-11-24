// The search (spec §4.7): the items whose reference or title holds the query, and their whole
// dependency chain, so a result never shows without what blocks it or what it blocks.

import type { BoardData, Epic, Issue, LinkType } from '../api/types';

export interface SearchResult {
  /** Items whose reference or title holds the query. */
  matches: Set<string>;
  /** Items brought in by the matches' dependency chains, never a match themselves. */
  chain: Set<string>;
}

/** The matches of a query (already trimmed; case-insensitive) and their dependency chains,
 * following the link types shown: upstream (what blocks them, transitively) and downstream (what
 * they block, transitively), in two separate walks so that a blocked item's other blockers don't
 * come along. "relates" has no direction: it is followed both ways in both walks. Hidden items
 * (closed ones with "Masquer les issues fermées") are walked through too. null without query. */
export function searchItems(data: BoardData, query: string, linkTypes: Record<LinkType, boolean>): SearchResult | null {
  if (!query) return null;
  const q = query.toLowerCase();
  const holds = (it: Epic | Issue) => it.ref.toLowerCase().includes(q) || it.title.toLowerCase().includes(q);
  const matches = new Set<string>();
  for (const it of data.epics) if (holds(it)) matches.add(it.id);
  for (const it of data.issues) if (holds(it)) matches.add(it.id);

  const up = new Map<string, string[]>(); // item -> items before it
  const down = new Map<string, string[]>(); // item -> items after it
  const add = (map: Map<string, string[]>, from: string, to: string) => {
    const list = map.get(from);
    if (list) list.push(to);
    else map.set(from, [to]);
  };
  for (const link of data.links) {
    if (!linkTypes[link.type] || link.source === link.target) continue;
    add(up, link.target, link.source);
    add(down, link.source, link.target);
    if (link.type === 'relates') {
      add(up, link.source, link.target);
      add(down, link.target, link.source);
    }
  }

  const chain = new Set<string>();
  for (const next of [up, down]) {
    const seen = new Set(matches);
    const queue = [...matches];
    for (let i = 0; i < queue.length; i++) {
      for (const id of next.get(queue[i]) ?? []) {
        if (seen.has(id)) continue;
        seen.add(id);
        queue.push(id);
        chain.add(id);
      }
    }
  }
  return { matches, chain };
}

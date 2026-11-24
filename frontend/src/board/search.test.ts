import { describe, expect, it } from 'vitest';
import type { LinkType } from '../api/types';
import { idOf, mockupBoard } from './fixtures';
import { searchItems } from './search';
import { DEFAULT_OPTIONS } from './types';

const SHOWN = DEFAULT_OPTIONS.linkTypes; // blocks and relates, not parent
const ids = (...refs: string[]) => new Set(refs.map(idOf));

function search(query: string, linkTypes: Record<LinkType, boolean> = SHOWN, data = mockupBoard()) {
  return searchItems(data, query, linkTypes);
}

describe('searchItems', () => {
  it('is null without query', () => {
    expect(search('')).toBeNull();
  });

  it('matches refs and titles, case-insensitive', () => {
    expect(search('#110')!.matches).toEqual(ids('#110'));
    expect(search('SSO')!.matches).toEqual(ids('&12', '#114'));
    expect(search('&1')!.matches).toEqual(ids('&12', '&13', '&15', '&16', '&17', '&18', '&19'));
  });

  it('finds nothing, with no chain, when nothing matches', () => {
    expect(search('introuvable')).toEqual({ matches: new Set(), chain: new Set() });
  });

  it('brings the whole chain downstream: what the match blocks, transitively', () => {
    // #131 blocks &21, which blocks &23; nothing blocks #131.
    expect(search('kafka')!.chain).toEqual(ids('&21', '&23'));
  });

  it('brings the whole chain upstream and downstream, but not the other blockers of a blocked item', () => {
    // Upstream: &12, &19, #114, #140 block &18. Downstream: &22 (and &16, related to it), &21,
    // then &23. Not &13 (also blocked by &12), nor #110 / #131 (also blocking &21).
    expect(search('&18')!.chain).toEqual(ids('&12', '&19', '#114', '#140', '&22', '&16', '&21', '&23'));
  });

  it('follows "relates" both ways, and only the link types shown', () => {
    // #107 blocks &15 (related to &17) and is related to #110, which blocks &21 → &23.
    expect(search('#107')!.chain).toEqual(ids('&15', '&17', '#110', '&21', '&23'));
    expect(search('#107', { blocks: true, relates: false, parent: false })!.chain).toEqual(ids('&15'));
    expect(search('#107', { blocks: false, relates: false, parent: false })!.chain).toEqual(new Set());
  });

  it('follows parent links when shown: the parent epic upstream, the children downstream', () => {
    const chain = search('kafka', { blocks: true, relates: false, parent: true })!.chain;
    expect(chain.has(idOf('&21'))).toBe(true); // parent and blocked
    expect(chain.has(idOf('&18'))).toBe(true); // blocks the parent
    expect(chain.has(idOf('#130'))).toBe(true); // a child of &21
    expect(chain.has(idOf('&15'))).toBe(false);
  });

  it('never puts a match in the chain', () => {
    const r = search('&1')!;
    for (const id of r.matches) expect(r.chain.has(id)).toBe(false);
    expect(r.chain.size).toBeGreaterThan(0);
  });

  it('ends on a cycle and ignores a link to itself', () => {
    const data = mockupBoard();
    data.links.push(
      { source: idOf('&23'), target: idOf('&12'), type: 'blocks', conflict: false },
      { source: idOf('&23'), target: idOf('&23'), type: 'blocks', conflict: false },
    );
    const r = search('kafka', SHOWN, data)!;
    // &23 now blocks &12, so &12 and its own downstream join the chain; the walk still ends.
    expect(r.chain.has(idOf('&12'))).toBe(true);
    expect(r.chain.has(idOf('&13'))).toBe(true);
    expect(r.chain.has(idOf('#131'))).toBe(false);
  });
});

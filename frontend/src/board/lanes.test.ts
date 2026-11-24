import { describe, expect, it } from 'vitest';
import type { BoardData, Group } from '../api/types';
import { G, mockupBoard } from './fixtures';
import { defaultChecked, groupTree, laneColor, laneOf, lanesOf, refreshScope, scopeSyncedAt } from './lanes';
import { LANE_COLORS } from './types';

const data = mockupBoard();
const ROOT = data.rootGroup.path;

/** A board with only these groups under the root "r". */
function withGroups(paths: string[]): BoardData {
  const group = (path: string, i: number): Group => ({ id: `gid://gitlab/Group/${i}`, path, name: path.split('/').pop()! });
  return { ...mockupBoard(), rootGroup: group('r', 0), groups: [group('r', 0), ...paths.map((p, i) => group(p, i + 1))] };
}

describe('groupTree', () => {
  it('lists the root, then each group before its subgroups, siblings by path', () => {
    const tree = groupTree(withGroups(['r/b', 'r/a/c', 'r/b-x', 'r/a', 'r/b/d']));
    expect(tree.map((n) => [n.path, n.depth, n.parent])).toEqual([
      ['r', 0, null],
      ['r/a', 1, 'r'],
      ['r/a/c', 2, 'r/a'],
      ['r/b', 1, 'r'],
      ['r/b/d', 2, 'r/b'],
      ['r/b-x', 1, 'r'],
    ]);
    expect(tree[0].children).toEqual(['r/a', 'r/b', 'r/b-x']);
  });

  it('hangs a group whose parent is unknown under the root, and is cached per board', () => {
    const board = withGroups(['r/x/y']);
    expect(groupTree(board).map((n) => [n.path, n.parent])).toEqual([
      ['r', null],
      ['r/x/y', 'r'],
    ]);
    expect(groupTree(board)).toBe(groupTree(board));
  });

  it('keeps the root when data.groups leaves it out', () => {
    const board = { ...withGroups(['r/a']), groups: [{ id: 'gid://gitlab/Group/1', path: 'r/a', name: 'a' }] };
    expect(groupTree(board).map((n) => n.path)).toEqual(['r', 'r/a']);
    expect(groupTree({ ...board, rootGroup: { path: 'r', name: 'r' } as Group, groups: [] })[0].id).toBe('');
  });
});

describe('defaultChecked', () => {
  it('checks the direct subgroups, or the root without any', () => {
    expect(defaultChecked(data)).toEqual([G.api, G.data, G.xp, G.identite]);
    expect(defaultChecked(withGroups([]))).toEqual(['r']);
  });
});

describe('laneColor', () => {
  it('gives each direct subgroup its color, in tree order, and its subgroups the same', () => {
    expect([G.api, G.data, G.xp, G.identite].map((p) => laneColor(data, p))).toEqual(LANE_COLORS.slice(0, 4));
    expect(laneColor(data, G.partenaires)).toBe(laneColor(data, G.api));
    expect(laneColor(data, ROOT)).toBe(LANE_COLORS[LANE_COLORS.length - 1]);
  });

  it('cycles the palette, and falls back to the first color for an unknown group', () => {
    const board = withGroups(Array.from({ length: 9 }, (_, i) => `r/g${i}`));
    expect(laneColor(board, 'r/g8')).toBe(LANE_COLORS[0]);
    expect(laneColor(board, 'r/nope')).toBe(LANE_COLORS[0]);
  });
});

describe('lanesOf', () => {
  it('makes a lane per checked group, in tree order, named after GitLab', () => {
    const lanes = lanesOf(data, new Set([G.partenaires, G.data, ROOT, 'unknown']));
    expect(lanes.map((l) => [l.id, l.name, l.title, l.depth])).toEqual([
      [ROOT, 'Atlas', 'Atlas', 0],
      [G.partenaires, 'Partenaires', 'API & intégrations › Partenaires', 2],
      [G.data, 'Data', 'Data', 1],
    ]);
    expect(lanes[1].color).toBe(laneColor(data, G.api));
  });
});

describe('laneOf', () => {
  const checked = new Set([G.api, G.partenaires]);
  it('is the closest checked group, the group itself first', () => {
    expect(laneOf(G.partenaires, checked)).toBe(G.partenaires);
    expect(laneOf(`${G.api}/export`, checked)).toBe(G.api);
    expect(laneOf(`${G.partenaires}/x/y`, checked)).toBe(G.partenaires);
  });

  it('is null when no group up the path is checked, the root catching everything', () => {
    expect(laneOf(G.data, checked)).toBeNull();
    expect(laneOf(ROOT, checked)).toBeNull();
    expect(laneOf(G.data, new Set([ROOT]))).toBe(ROOT);
  });
});

describe('refreshScope', () => {
  it('lists the checked groups, sorted, an ancestor covering its descendants', () => {
    expect(refreshScope(new Set([G.xp, G.partenaires, G.api]))).toEqual([G.api, G.xp]);
  });

  it('keeps a sibling sharing a prefix, and is empty without a checked group', () => {
    expect(refreshScope(new Set(['r/a', 'r/ab']))).toEqual(['r/a', 'r/ab']);
    expect(refreshScope(new Set())).toEqual([]);
  });
});

describe('scopeSyncedAt', () => {
  const stamped = (times: Record<string, string>): BoardData => ({
    ...data,
    groups: data.groups.map((g) => ({ ...g, syncedAt: times[g.path] })),
  });

  it('is the oldest read of the groups the lanes show, subgroups included', () => {
    const board = stamped({ [G.api]: '2026-11-23T10:00:00Z', [G.partenaires]: '2026-11-23T08:00:00Z', [G.data]: '2026-11-23T07:00:00Z' });
    expect(scopeSyncedAt(board, new Set([G.api]))).toBe('2026-11-23T08:00:00Z');
    expect(scopeSyncedAt(board, new Set([G.api, G.data]))).toBe('2026-11-23T07:00:00Z');
  });

  it('is null without a stamped group in the scope', () => {
    expect(scopeSyncedAt(stamped({ [G.data]: '2026-11-23T07:00:00Z' }), new Set([G.api]))).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import type { BoardData, Group } from '../api/types';
import { G, groupId, idOf, mockupBoard } from './fixtures';
import {
  defaultLanes,
  groupName,
  groupTree,
  labelsText,
  laneGroupNames,
  lanePaths,
  laneMatcher,
  laneSummary,
  newLane,
  nextLaneColor,
  refreshScope,
  scopeSyncedAt,
  validateLanes,
} from './lanes';
import { findItem } from './items';
import { LANE_COLORS, type Lane } from './types';

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

const gid = (path: string) => data.groups.find((g) => g.path === path)!.id;
const lane = (paths: string[], patch: Partial<Lane> = {}): Lane => ({
  id: 'l',
  name: 'L',
  color: 'blue',
  groups: paths.map(gid),
  includeSubgroups: true,
  showEpics: true,
  issueMode: 'blocking',
  labels: [],
  labelMode: 'any',
  active: true,
  ...patch,
});
const item = (ref: string) => findItem(data, idOf(ref))!;
const matches = (l: Lane, ref: string) => laneMatcher(l, data)(item(ref).item, item(ref).kind);

describe('defaultLanes', () => {
  it('makes one lane per direct subgroup, in tree order, with subgroups, epics and blocking issues', () => {
    const lanes = defaultLanes(data);
    expect(lanes.map((l) => [l.name, l.groups, l.color])).toEqual([
      ['API & intégrations', [groupId(1)], 'indigo'],
      ['Data', [groupId(2)], 'blue'],
      ['Expérience produit', [groupId(3)], 'cyan'],
      ['Identité & sécurité', [groupId(4)], 'mint'],
    ]);
    expect(lanes[0]).toMatchObject({
      id: `group:${groupId(1)}`,
      includeSubgroups: true,
      showEpics: true,
      issueMode: 'blocking',
      labels: [],
      labelMode: 'any',
      active: true,
    });
  });

  it('makes one lane for the root without subgroups; colors wrap around the palette', () => {
    expect(defaultLanes(withGroups([])).map((l) => [l.name, l.groups])).toEqual([['r', ['gid://gitlab/Group/0']]]);
    const nine = defaultLanes(withGroups(Array.from({ length: 9 }, (_, i) => `r/g${i}`)));
    expect(nine[8].color).toBe(LANE_COLORS[0]);
  });
});

describe('newLane and nextLaneColor', () => {
  it('takes the first free color, else cycles; a fresh id', () => {
    const lanes = defaultLanes(data);
    expect(nextLaneColor([])).toBe('indigo');
    expect(nextLaneColor(lanes)).toBe('yellow');
    const full = LANE_COLORS.map((color, i) => ({ ...lanes[0], id: `lane-${i + 1}`, color }));
    expect(nextLaneColor(full)).toBe(LANE_COLORS[0]);
    const fresh = newLane(full);
    expect(fresh).toMatchObject({ id: 'lane-9', name: 'Nouveau couloir', groups: [], issueMode: 'blocking', active: true });
    expect(newLane([{ ...lanes[0], id: 'lane-2' }]).id).toBe('lane-3');
  });
});

describe('laneMatcher', () => {
  it('matches the lane groups, and their subgroups when asked (spec §5.3)', () => {
    expect(matches(lane([G.api]), '&18')).toBe(true);
    expect(matches(lane([G.api]), '&22')).toBe(true); // api/partenaires
    expect(matches(lane([G.api], { includeSubgroups: false }), '&22')).toBe(false);
    expect(matches(lane([G.partenaires]), '&18')).toBe(false);
    expect(matches(lane([G.api, G.xp]), '&15')).toBe(true);
    // "a/b" never takes "a/b-x": the prefix ends with a slash.
    const board = withGroups(['r/b', 'r/b-x']);
    const epic = { ...data.epics[0], groupPath: 'r/b-x' };
    const b = { ...lane([]), groups: ['gid://gitlab/Group/1'] };
    expect(laneMatcher(b, board)(epic, 'epic')).toBe(false);
    // No known group: nothing.
    expect(matches({ ...lane([]), groups: ['gid://gitlab/Group/999'] }, '&18')).toBe(false);
  });

  it('shows epics on demand, and the issues of the lane mode (spec §5.1)', () => {
    expect(matches(lane([G.api], { showEpics: false }), '&18')).toBe(false);
    expect(matches(lane([G.api], { showEpics: false }), '#110')).toBe(true);
    // #150 blocks no epic.
    expect(matches(lane([G.api]), '#150')).toBe(false);
    expect(matches(lane([G.api], { issueMode: 'all' }), '#150')).toBe(true);
    expect(matches(lane([G.api], { issueMode: 'all' }), '#110')).toBe(true);
    expect(matches(lane([G.api], { issueMode: 'none' }), '#110')).toBe(false);
    expect(matches(lane([G.api], { issueMode: 'none' }), '&18')).toBe(true);
  });

  it('filters labels: at least one, or all of them; none is no filter', () => {
    expect(matches(lane([G.identite], { labels: ['bug', 'UX'] }), '#104')).toBe(true);
    expect(matches(lane([G.identite], { labels: ['bug', 'UX'] }), '#114')).toBe(false);
    expect(matches(lane([G.identite], { labels: ['bug', 'backend'], labelMode: 'all' }), '#104')).toBe(true);
    expect(matches(lane([G.identite], { labels: ['bug', 'sécurité'], labelMode: 'all' }), '#104')).toBe(false);
  });
});

describe('names and summaries', () => {
  it('names the groups of a lane, unknown ones left out', () => {
    const l = { ...lane([G.api, G.xp]), groups: [gid(G.api), 'gid://gitlab/Group/999', gid(G.xp)] };
    expect(lanePaths(l, data)).toEqual([G.api, G.xp]);
    expect(laneGroupNames(l, data)).toEqual(['API & intégrations', 'Expérience produit']);
    expect(groupName('a/unknown', data.groups)).toBe('unknown');
    expect(groupName('', [])).toBe('');
  });

  it('describes a lane in one line', () => {
    expect(laneSummary(lane([G.api]), data)).toBe('API & intégrations · epics, issues bloquantes · tous les labels');
    expect(laneSummary(lane([G.api], { issueMode: 'all', labels: ['bug', 'UX'] }), data)).toBe(
      'API & intégrations · epics, toutes les issues · au moins un de : bug, UX',
    );
    expect(laneSummary(lane([], { showEpics: false, issueMode: 'none', labels: ['bug'], labelMode: 'all' }), data)).toBe(
      'aucun groupe · aucun type · tous : bug',
    );
    expect(labelsText({ labels: [], labelMode: 'all' })).toBe('tous les labels');
  });
});

describe('validateLanes', () => {
  const stored = (patch: Record<string, unknown> = {}) => ({ ...lane([G.api]), ...patch });

  it('keeps valid lanes as they are', () => {
    const lanes = [lane([G.api], { id: 'a' }), lane([G.xp], { id: 'b', issueMode: 'all', labels: ['UX'], labelMode: 'all', active: false })];
    expect(validateLanes(JSON.parse(JSON.stringify(lanes)), data)).toEqual(lanes);
    // An empty list stays empty: the user removed every lane.
    expect(validateLanes([], data)).toEqual([]);
  });

  it('falls back to the defaults (null) when the value is not a list', () => {
    for (const value of [null, undefined, 'x', 3, { id: 'a' }]) expect(validateLanes(value, data)).toBeNull();
  });

  it('drops unknown groups and labels, and lanes left without a group or not objects', () => {
    const lanes = validateLanes(
      [
        stored({ groups: [gid(G.api), 'gid://gitlab/Group/999', gid(G.api)], labels: ['UX', 'nope', 'UX'] }),
        stored({ id: 'gone', groups: ['gid://gitlab/Group/999'] }),
        stored({ id: 'none', groups: 'x' }),
        'garbage',
        null,
        [1],
      ],
      data,
    )!;
    expect(lanes).toHaveLength(1);
    expect(lanes[0]).toMatchObject({ groups: [gid(G.api)], labels: ['UX'] });
  });

  it('repairs field by field: color, mode, flags, name and duplicate or missing ids', () => {
    const [a, b, c] = validateLanes(
      [
        stored({ id: 'x', color: 'red', issueMode: 'some', labelMode: 'nope', name: '  ', showEpics: 'yes', active: 1, includeSubgroups: null }),
        stored({ id: 'x', name: ' Data ' }),
        stored({ id: 3, labels: 'bug' }),
      ],
      data,
    )!;
    expect(a).toMatchObject({
      id: 'x',
      color: LANE_COLORS[0],
      issueMode: 'blocking',
      labelMode: 'any',
      name: 'Couloir sans nom',
      showEpics: true,
      active: true,
      includeSubgroups: true,
    });
    expect(b).toMatchObject({ id: 'lane-2', name: 'Data' });
    expect(c).toMatchObject({ id: 'lane-3', labels: [], color: 'blue' });
  });
});

describe('refreshScope', () => {
  it('lists the groups of the active lanes, without descendants of a listed group', () => {
    const lanes = [lane([G.api, G.partenaires]), lane([G.data]), lane([G.xp], { active: false }), lane([G.api])];
    expect(refreshScope(lanes, data)).toEqual([G.api, G.data]);
    expect(refreshScope([lane([G.partenaires]), lane([ROOT])], data)).toEqual([ROOT]);
    expect(refreshScope([], data)).toEqual([]);
  });
});

describe('scopeSyncedAt', () => {
  const synced = (): BoardData => {
    const board = mockupBoard();
    const at: Record<string, string> = {
      [G.api]: '2026-11-23T10:00:00Z',
      [G.partenaires]: '2026-11-23T08:00:00Z',
      [G.data]: '2026-11-23T09:00:00Z',
      [G.xp]: '2026-11-23T07:00:00Z',
    };
    board.groups = board.groups.map((g) => ({ ...g, syncedAt: at[g.path] }));
    return board;
  };

  it('gives the oldest read among the groups the active lanes cover', () => {
    const board = synced();
    expect(scopeSyncedAt(board, [lane([G.api])])).toBe('2026-11-23T08:00:00Z'); // with Partenaires
    expect(scopeSyncedAt(board, [lane([G.api], { includeSubgroups: false })])).toBe('2026-11-23T10:00:00Z');
    expect(scopeSyncedAt(board, [lane([G.data]), lane([G.xp], { active: false })])).toBe('2026-11-23T09:00:00Z');
    // Identité has no date; nothing known.
    expect(scopeSyncedAt(board, [lane([G.identite])])).toBeNull();
    expect(scopeSyncedAt(board, [])).toBeNull();
  });
});

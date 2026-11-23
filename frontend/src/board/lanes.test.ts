import { describe, expect, it } from 'vitest';
import { G, idOf, mockupBoard } from './fixtures';
import { defaultLanes, laneSummary, matchLane, newLane, refreshScope, scopeSyncedAt } from './lanes';
import type { Lane } from './types';

const lane = (patch: Partial<Lane> = {}): Lane => ({
  id: 'l',
  name: 'L',
  color: 'blue',
  groups: [G.api],
  includeSubgroups: false,
  showEpics: true,
  showIssues: true,
  labels: [],
  labelMode: 'any',
  active: true,
  ...patch,
});

const data = mockupBoard();
const epic = (ref: string) => data.epics.find((e) => e.id === idOf(ref))!;
const issue = (ref: string) => data.issues.find((e) => e.id === idOf(ref))!;

describe('defaultLanes', () => {
  it('makes one lane per direct subgroup, sorted by path, with cycling colors', () => {
    const lanes = defaultLanes(data);
    expect(lanes.map((l) => l.groups[0])).toEqual([G.api, G.data, G.xp, G.identite]);
    expect(lanes.map((l) => l.name)).toEqual(['API & intégrations', 'Data', 'Expérience produit', 'Identité & sécurité']);
    expect(lanes.map((l) => l.color)).toEqual(['indigo', 'blue', 'cyan', 'mint']);
    expect(lanes.every((l) => l.active && l.showEpics && l.showIssues && l.includeSubgroups)).toBe(true);
    expect(new Set(lanes.map((l) => l.id)).size).toBe(4);
  });

  it('ignores deeper descendants and falls back to the root group', () => {
    const deep = { ...data, groups: [...data.groups, { path: `${G.api}/v2`, name: 'v2' }] };
    expect(defaultLanes(deep)).toHaveLength(4);
    const alone = { ...data, groups: [data.rootGroup] };
    const lanes = defaultLanes(alone);
    expect(lanes).toHaveLength(1);
    expect(lanes[0].groups).toEqual(['plateforme/atlas']);
    expect(lanes[0].name).toBe('Atlas');
  });

  it('cycles the 8 colors', () => {
    const groups = Array.from({ length: 10 }, (_, i) => ({ path: `plateforme/atlas/g${i}`, name: `g${i}` }));
    const lanes = defaultLanes({ ...data, groups: [data.rootGroup, ...groups] });
    expect(lanes[8].color).toBe(lanes[0].color);
  });
});

describe('matchLane', () => {
  it('filters by type', () => {
    expect(matchLane(lane(), epic('&18'), 'epic')).toBe(true);
    expect(matchLane(lane({ showEpics: false }), epic('&18'), 'epic')).toBe(false);
    expect(matchLane(lane({ showIssues: false }), issue('#110'), 'issue')).toBe(false);
    expect(matchLane(lane({ showEpics: false }), issue('#110'), 'issue')).toBe(true);
  });

  it('filters by group, with subgroups by path prefix', () => {
    expect(matchLane(lane({ groups: [G.data] }), epic('&18'), 'epic')).toBe(false);
    expect(matchLane(lane({ groups: [] }), epic('&18'), 'epic')).toBe(false);
    expect(matchLane(lane({ groups: ['plateforme/atlas'] }), epic('&18'), 'epic')).toBe(false);
    expect(matchLane(lane({ groups: ['plateforme/atlas'], includeSubgroups: true }), epic('&18'), 'epic')).toBe(true);
    // "plateforme/at" is not a parent of "plateforme/atlas/api"
    expect(matchLane(lane({ groups: ['plateforme/at'], includeSubgroups: true }), epic('&18'), 'epic')).toBe(false);
  });

  it('filters labels with any / all', () => {
    const any = lane({ labels: ['bug', 'API'], labelMode: 'any' });
    const all = lane({ labels: ['backend', 'API'], labelMode: 'all' });
    expect(matchLane(any, issue('#110'), 'issue')).toBe(true); // API
    expect(matchLane(all, issue('#110'), 'issue')).toBe(true); // backend + API
    expect(matchLane(lane({ labels: ['bug', 'API'], labelMode: 'all' }), issue('#110'), 'issue')).toBe(false);
    expect(matchLane(lane({ labels: ['bug'] }), epic('&18'), 'epic')).toBe(false);
  });
});

describe('newLane', () => {
  it('picks the next free color and a fresh id', () => {
    const lanes = defaultLanes(data);
    const l = newLane(lanes);
    expect(l.name).toBe('Nouveau couloir');
    expect(l.color).toBe('yellow');
    expect(l.groups).toEqual([]);
    expect(l.showEpics && l.showIssues && l.active).toBe(true);
    expect(lanes.some((x) => x.id === l.id)).toBe(false);
    const l2 = newLane([...lanes, l]);
    expect(l2.id).not.toBe(l.id);
    expect(l2.color).toBe('orange');
  });

  it('cycles colors when all are used', () => {
    let lanes: Lane[] = [];
    for (let i = 0; i < 9; i++) lanes = [...lanes, newLane(lanes)];
    expect(lanes[8].color).toBe('indigo');
    expect(new Set(lanes.map((l) => l.id)).size).toBe(9);
  });
});

describe('laneSummary', () => {
  it('describes groups, types and labels', () => {
    expect(laneSummary(lane({ groups: [G.identite], labels: ['bug'] }), data.groups)).toBe(
      'Identité & sécurité · epics, issues · au moins un de : bug',
    );
    expect(laneSummary(lane({ groups: [], showEpics: false, labels: ['a', 'b'], labelMode: 'all' }), data.groups)).toBe(
      'aucun groupe · issues · tous : a, b',
    );
    expect(laneSummary(lane({ groups: ['x/unknown'], showEpics: false, showIssues: false }), data.groups)).toBe(
      'unknown · aucun type · tous les labels',
    );
  });
});

describe('refreshScope', () => {
  it('lists the groups of the active lanes, sorted, an ancestor covering its descendants', () => {
    const lanes = [
      lane({ groups: [G.xp, G.api] }),
      lane({ groups: [`${G.api}/sub`, G.api] }),
      lane({ groups: [G.data], active: false }),
      lane({ groups: [] }),
    ];
    expect(refreshScope(lanes)).toEqual([G.api, G.xp]);
  });

  it('keeps a sibling sharing a prefix, and the root covers everything', () => {
    expect(refreshScope([lane({ groups: [`${G.api}x`, G.api] })])).toEqual([G.api, `${G.api}x`]);
    expect(refreshScope([lane({ groups: [G.api] }), lane({ groups: [data.rootGroup.path] })])).toEqual([
      data.rootGroup.path,
    ]);
  });

  it('is empty without an active lane with groups', () => {
    expect(refreshScope([])).toEqual([]);
    expect(refreshScope([lane({ active: false }), lane({ groups: [] })])).toEqual([]);
  });
});

describe('scopeSyncedAt', () => {
  const stamped = {
    ...data,
    groups: data.groups.map((g) => ({
      ...g,
      syncedAt: g.path === G.api ? '2026-11-23T10:00:00Z' : g.path === G.data ? '2026-11-23T08:00:00Z' : '2026-11-23T09:00:00Z',
    })),
  };

  it('is the oldest read of the groups the active lanes show', () => {
    expect(scopeSyncedAt(stamped, [lane({ groups: [G.api] })])).toBe('2026-11-23T10:00:00Z');
    expect(scopeSyncedAt(stamped, [lane({ groups: [G.api] }), lane({ groups: [G.xp] })])).toBe('2026-11-23T09:00:00Z');
    expect(scopeSyncedAt(stamped, [lane({ groups: [G.api] }), lane({ groups: [G.data], active: false })])).toBe(
      '2026-11-23T10:00:00Z',
    );
  });

  it('follows the subgroups only when the lane includes them', () => {
    const root = data.rootGroup.path;
    expect(scopeSyncedAt(stamped, [lane({ groups: [root], includeSubgroups: true })])).toBe('2026-11-23T08:00:00Z');
    expect(scopeSyncedAt(stamped, [lane({ groups: [root], includeSubgroups: false })])).toBe('2026-11-23T09:00:00Z');
  });

  it('is null without a stamped group in the scope', () => {
    expect(scopeSyncedAt(data, [lane({ groups: [G.api] })])).toBeNull();
    expect(scopeSyncedAt(stamped, [lane({ active: false })])).toBeNull();
    expect(scopeSyncedAt(stamped, [])).toBeNull();
  });
});

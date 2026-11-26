import { describe, expect, it } from 'vitest';
import type { BoardData } from '../api/types';
import { generateBoard, G, idOf, mockupBoard } from './fixtures';
import { defaultLanes } from './lanes';
import { DEFAULT_OPTIONS, type BoardView, type DisplayOptions, type Lane, type ViewInput } from './types';
import { COMPACT_LAYOUT, computeBoardView, connectedIds, curve, isCompactView, LAYOUT, laneHeaderHeight, layoutFor } from './view';

function view(patch: Partial<Omit<ViewInput, 'options'>> & { options?: Partial<DisplayOptions> } = {}): BoardView {
  const data = patch.data ?? mockupBoard();
  return computeBoardView({
    data,
    lanes: patch.lanes ?? defaultLanes(data),
    window: patch.window ?? { from: 2, to: 6 },
    options: { ...DEFAULT_OPTIONS, ...patch.options },
    query: patch.query ?? '',
    collapsed: patch.collapsed ?? new Set(),
    availableWidth: patch.availableWidth,
  });
}

const gid = (data: BoardData, path: string) => data.groups.find((g) => g.path === path)!.id;
/** A lane on these groups (with their subgroups unless told otherwise), id = its first path. */
const lane = (data: BoardData, paths: string[], patch: Partial<Lane> = {}): Lane => ({
  id: paths[0],
  name: paths[0],
  color: 'blue',
  groups: paths.map((p) => gid(data, p)),
  includeSubgroups: true,
  showEpics: true,
  issueMode: 'blocking',
  labels: [],
  labelMode: 'any',
  active: true,
  ...patch,
});
/** One lane per group, with its subgroups. */
const lanesFor = (data: BoardData, ...paths: string[]) => paths.map((p) => lane(data, [p]));
/** The id of the default lane of a direct subgroup. */
const laneId = (path: string) => `group:${mockupBoard().groups.find((g) => g.path === path)!.id}`;
const placed = (v: BoardView, ref: string, lane?: string) =>
  v.items.find((p) => p.itemId === idOf(ref) && (!lane || p.laneId === lane));
const placedRefs = (v: BoardView) => new Set(v.items.map((p) => p.itemId));

function withUnplanned(): BoardData {
  const data = mockupBoard();
  data.epics.push({
    ...data.epics.find((e) => e.id === idOf('&18'))!,
    id: idOf('&31'),
    iid: '31',
    ref: '&31',
    title: 'Recherche plein texte',
    start: null,
    end: null,
    startDate: '',
    dueDate: '',
    unplanned: true,
  });
  data.issues.push({
    ...data.issues.find((i) => i.id === idOf('#110'))!,
    id: idOf('#160'),
    iid: '160',
    ref: '#160',
    title: 'Index de recherche',
    iteration: null,
    unplanned: true,
    blocksEpics: [idOf('&31')],
  });
  data.links.push({ source: idOf('#160'), target: idOf('&31'), type: 'blocks', conflict: false });
  return data;
}

describe('columns', () => {
  it('makes one 212 px column per iteration of the window, after the rail', () => {
    const v = view();
    expect(v.railWidth).toBe(220);
    expect(v.headerHeight).toBe(LAYOUT.headerHeight);
    expect(v.columns.map((c) => c.index)).toEqual([2, 3, 4, 5, 6]);
    expect(v.columns.map((c) => c.x)).toEqual([220, 432, 644, 856, 1068]);
    expect(v.columns.every((c) => c.width === 212)).toBe(true);
    expect(v.columns.filter((c) => c.current).map((c) => c.index)).toEqual([3]);
    expect(v.width).toBe(220 + 5 * 212);
  });

  it('narrows columns to 180 px above 7 iterations', () => {
    const v = view({ window: { from: 0, to: 9 } });
    expect(v.columns).toHaveLength(10);
    expect(v.columns.every((c) => c.width === 180)).toBe(true);
    expect(view({ window: { from: 0, to: 6 } }).columns[0].width).toBe(212);
  });

  it('uses the compact layout on phones: a narrow rail and narrower columns', () => {
    expect(layoutFor(false)).toBe(LAYOUT);
    expect(layoutFor(true)).toBe(COMPACT_LAYOUT);
    const data = mockupBoard();
    const input = { data, lanes: defaultLanes(data), window: { from: 2, to: 6 }, options: DEFAULT_OPTIONS, query: '', collapsed: new Set<string>() };
    const v = computeBoardView(input, COMPACT_LAYOUT);
    expect(v.railWidth).toBe(COMPACT_LAYOUT.railWidth);
    expect(v.columns.map((c) => c.x)).toEqual([0, 1, 2, 3, 4].map((i) => COMPACT_LAYOUT.railWidth + i * COMPACT_LAYOUT.columnWidth));
    expect(v.width).toBe(COMPACT_LAYOUT.railWidth + 5 * COMPACT_LAYOUT.columnWidth);
    expect(isCompactView(v)).toBe(true);
    expect(isCompactView(computeBoardView(input))).toBe(false);
    // Same items, same heights: only the widths change.
    const regular = computeBoardView(input);
    expect(v.items.map((p) => [p.key, p.rect.y, p.rect.h])).toEqual(regular.items.map((p) => [p.key, p.rect.y, p.rect.h]));
    const collapsed = computeBoardView({ ...input, collapsed: new Set([input.lanes[0].id]) }, COMPACT_LAYOUT);
    expect(collapsed.lanes[0].height).toBe(COMPACT_LAYOUT.collapsedLaneHeight);
  });

  it('widens columns equally to fill the available width', () => {
    const v = view({ availableWidth: 1603 });
    const w = Math.floor((1603 - 220) / 5); // 276
    expect(v.columns.every((c) => c.width === w)).toBe(true);
    expect(v.columns.map((c) => c.x)).toEqual([0, 1, 2, 3, 4].map((i) => 220 + i * w));
    expect(v.width).toBe(220 + 5 * w);
    expect(v.width).toBeLessThanOrEqual(1603);
    // items follow the wider columns
    const e19 = placed(v, '&19')!; // 0..3 in 2..6
    expect(e19.rect.x + e19.rect.w).toBe(220 + 2 * w - LAYOUT.inset);
    expect(placed(v, '#107')!.rect).toMatchObject({ x: 220 + 2 * w + LAYOUT.inset, w: w - 2 * LAYOUT.inset });
  });

  it('keeps the minimum widths when the available width is too small, or unknown', () => {
    expect(view({ availableWidth: 900 }).columns.every((c) => c.width === 212)).toBe(true);
    expect(view({ availableWidth: 0 }).columns.every((c) => c.width === 212)).toBe(true);
    expect(view({ window: { from: 0, to: 9 }, availableWidth: 1600 }).columns.every((c) => c.width === 180)).toBe(true);
    expect(view({ window: { from: 0, to: 9 }, availableWidth: 2420 }).columns.every((c) => c.width === 220)).toBe(true);
  });

  it('keeps the compact widths on a phone', () => {
    const data = mockupBoard();
    const input = { data, lanes: defaultLanes(data), window: { from: 2, to: 6 }, options: DEFAULT_OPTIONS, query: '', collapsed: new Set<string>(), availableWidth: 390 };
    expect(computeBoardView(input, COMPACT_LAYOUT).columns.every((c) => c.width === COMPACT_LAYOUT.columnWidth)).toBe(true);
  });

  it('clamps the window to the cadence', () => {
    expect(view({ window: { from: 7, to: 14 } }).columns.map((c) => c.index)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe('unplanned column', () => {
  it('is absent when no lane has an unplanned item', () => {
    expect(view().columns.some((c) => c.key === 'unplanned')).toBe(false);
  });

  it('trails the iterations and holds unplanned epics then cards', () => {
    const v = view({ data: withUnplanned() });
    const last = v.columns[v.columns.length - 1];
    expect(last).toMatchObject({ key: 'unplanned', iteration: null, index: null, x: 220 + 5 * 212, width: 212 });
    expect(v.width).toBe(220 + 6 * 212);
    const epic = placed(v, '&31')!;
    const issue = placed(v, '#160')!;
    expect(epic.unplanned && issue.unplanned).toBe(true);
    expect(epic.rect.x).toBe(last.x + LAYOUT.inset);
    expect(epic.rect.h).toBe(LAYOUT.barHeight);
    expect(issue.rect.y).toBeGreaterThanOrEqual(epic.rect.y + epic.rect.h);
    expect(issue.rect.h).toBe(LAYOUT.cardHeight);
    // drawn inside the unplanned column, linked
    expect(v.links.some((l) => l.source === idOf('#160') && l.target === idOf('&31'))).toBe(true);
    const api = v.lanes.find((l) => l.lane.id === laneId(G.api))!;
    expect(api.counts).toEqual({ epics: 3, issues: 3, outside: 2 });
  });

  it('shares the available width with the iterations', () => {
    const v = view({ data: withUnplanned(), availableWidth: 1900 });
    const w = (1900 - 220) / 6; // 280
    expect(v.columns).toHaveLength(6);
    expect(v.columns.every((c) => c.width === w)).toBe(true);
    expect(v.columns[5].x).toBe(220 + 5 * w);
    expect(v.width).toBe(1900);
    expect(placed(v, '&31')!.rect.w).toBe(w - 2 * LAYOUT.inset);
  });

  it('can be hidden', () => {
    const v = view({ data: withUnplanned(), options: { showUnplanned: false } });
    expect(v.columns.some((c) => c.key === 'unplanned')).toBe(false);
    expect(placed(v, '&31')).toBeUndefined();
    const api = v.lanes.find((l) => l.lane.id === laneId(G.api))!;
    expect(api.counts).toEqual({ epics: 2, issues: 2, outside: 2 });
  });
});

describe('lanes and items', () => {
  it('places epics and issues of each lane in the window', () => {
    const v = view();
    expect(v.lanes.map((l) => l.lane.id)).toEqual([G.api, G.data, G.xp, G.identite].map(laneId));
    const api = v.lanes[0];
    expect(api.top).toBe(LAYOUT.headerHeight);
    expect(api.counts).toEqual({ epics: 2, issues: 2, outside: 2 }); // &22 and #140 outside
    expect(v.items.filter((p) => p.laneId === api.lane.id).map((p) => p.itemId)).toEqual(
      ['&19', '&18', '#107', '#110'].map(idOf),
    );
    // lanes follow each other
    for (let i = 1; i < v.lanes.length; i++) expect(v.lanes[i].top).toBe(v.lanes[i - 1].top + v.lanes[i - 1].height);
    const last = v.lanes[v.lanes.length - 1];
    expect(v.height).toBe(last.top + last.height);
  });

  it('packs epics without overlap on the fewest rows', () => {
    const v = view();
    const e19 = placed(v, '&19')!;
    const e18 = placed(v, '&18')!;
    expect(e19.rect.y).toBe(e18.rect.y); // 2..3 and 4..6 share a row
    // A lane with every epic: no two bars may overlap.
    const data = mockupBoard();
    const w = view({ data, lanes: [lane(data, [data.rootGroup.path], { issueMode: 'none' })], window: { from: 0, to: 9 } });
    const bars = w.items.filter((p) => p.kind === 'epic');
    expect(bars).toHaveLength(11);
    for (const a of bars)
      for (const b of bars) {
        if (a === b) continue;
        const overlap = a.rect.x < b.rect.x + b.rect.w && b.rect.x < a.rect.x + a.rect.w && a.rect.y === b.rect.y;
        expect(overlap).toBe(false);
      }
    // at most 6 epics run at once (index 7: &13, &21, &17, &16, &22, &30)
    expect(new Set(bars.map((b) => b.rect.y)).size).toBe(6);
  });

  it('clips epics to the window and flags the cut sides', () => {
    const v = view();
    const e19 = placed(v, '&19')!; // 0..3 in 2..6
    expect(e19).toMatchObject({ clippedStart: true, clippedEnd: false });
    expect(e19.rect.x).toBe(220 + LAYOUT.inset);
    expect(e19.rect.x + e19.rect.w).toBe(220 + 2 * 212 - LAYOUT.inset);
    expect(placed(v, '&21')).toMatchObject({ clippedStart: false, clippedEnd: true }); // 5..7
    expect(placed(v, '&18')).toMatchObject({ clippedStart: false, clippedEnd: false }); // 4..6
  });

  it('stacks issue cards in their column below the epic rows', () => {
    const v = view();
    const top = v.lanes[0].top;
    const i107 = placed(v, '#107')!;
    expect(i107.rect).toEqual({
      x: 220 + 2 * 212 + LAYOUT.inset,
      y: top + LAYOUT.lanePaddingTop + LAYOUT.barPitch + LAYOUT.sectionGap,
      w: 212 - 2 * LAYOUT.inset,
      h: LAYOUT.cardHeight,
    });
    // two issues in the same column of one lane
    const data = mockupBoard();
    data.issues.find((i) => i.ref === '#110')!.iteration = 4;
    const w = view({ data });
    expect(placed(w, '#110')!.rect.y - placed(w, '#107')!.rect.y).toBe(LAYOUT.cardPitch);
    expect(placed(w, '#110')!.rect.x).toBe(placed(w, '#107')!.rect.x);
  });

  it('collapses lanes to their header', () => {
    const v = view({ collapsed: new Set([laneId(G.api)]) });
    const api = v.lanes[0];
    expect(api.collapsed).toBe(true);
    expect(api.height).toBe(LAYOUT.collapsedLaneHeight);
    expect(api.counts.epics).toBe(2);
    expect(v.items.some((p) => p.laneId === api.lane.id)).toBe(false);
    expect(v.lanes[1].top).toBe(api.top + LAYOUT.collapsedLaneHeight);
  });

  it('flags empty lanes and keeps a minimum height', () => {
    const data = mockupBoard();
    // Partenaires only holds &22, after the window.
    const v = view({ data, lanes: lanesFor(data, G.partenaires, G.xp, G.identite) });
    expect(v.lanes).toHaveLength(3);
    expect(v.stats.lanes).toBe(3);
    expect(v.lanes[0].lane.id).toBe(G.partenaires);
    expect(v.lanes[0].counts).toEqual({ epics: 0, issues: 0, outside: 1 });
    expect(v.lanes[0].empty).toBe(true);
    expect(v.lanes[0].height).toBe(LAYOUT.laneMinHeight);
    expect(v.lanes[1].empty).toBe(false);
  });

  it('makes a lane tall enough for its header: a « Labels » line and up to two label lines (§4.1)', () => {
    const data = mockupBoard();
    const heightWith = (labels: string[], compact = false) =>
      computeBoardView(
        { data, lanes: [lane(data, [G.partenaires], { labels })], window: { from: 2, to: 6 }, options: DEFAULT_OPTIONS, query: '', collapsed: new Set() },
        layoutFor(compact),
      ).lanes[0].height;
    // No label: the header fits the minimum height, as before.
    expect(laneHeaderHeight({ labels: [] }, LAYOUT)).toBeLessThanOrEqual(LAYOUT.laneMinHeight);
    expect(heightWith([])).toBe(LAYOUT.laneMinHeight);
    // One label: heading + one line; two or more: heading + two lines, never more.
    expect(heightWith(['API'])).toBe(Math.max(LAYOUT.laneMinHeight, LAYOUT.laneHeaderBase + 2 * LAYOUT.laneMetaLine));
    const two = LAYOUT.laneHeaderBase + 3 * LAYOUT.laneMetaLine;
    expect(two).toBeGreaterThan(LAYOUT.laneMinHeight);
    expect(heightWith(['API', 'bug'])).toBe(two);
    expect(heightWith(['API', 'bug', 'UX', 'data', 'mobile'])).toBe(two);
    // The compact rail hides the labels: they add nothing.
    expect(heightWith(['API', 'bug', 'UX'], true)).toBe(COMPACT_LAYOUT.laneMinHeight);
    expect(laneHeaderHeight({ labels: ['API', 'bug', 'UX'] }, COMPACT_LAYOUT)).toBe(0);
  });

  it('takes the items of the lane groups, with their subgroups when asked (spec §5.3)', () => {
    const data = mockupBoard();
    const whole = { data, window: { from: 0, to: 9 } };
    // Partenaires sits under API: in it with the subgroups, not without.
    expect(placed(view({ ...whole, lanes: [lane(data, [G.api])] }), '&22')).toBeDefined();
    const strict = view({ ...whole, lanes: [lane(data, [G.api], { includeSubgroups: false })] });
    expect(placed(strict, '&22')).toBeUndefined();
    expect(placed(strict, '&18')).toBeDefined();
    // The root without subgroups only holds its own items: &30.
    expect(placedRefs(view({ ...whole, lanes: [lane(data, [data.rootGroup.path], { includeSubgroups: false })] }))).toEqual(
      new Set([idOf('&30')]),
    );
    // Several groups in one lane; an unknown group matches nothing.
    const two = view({ ...whole, lanes: [lane(data, [G.xp, G.identite])] });
    expect(placed(two, '&15') && placed(two, '&12')).toBeTruthy();
    expect(view({ ...whole, lanes: [{ ...lane(data, [G.xp]), groups: ['gid://gitlab/Group/999'] }] }).items).toEqual([]);
  });

  it('shows an item in every active lane it matches, and skips inactive lanes', () => {
    const data = mockupBoard();
    const lanes = [lane(data, [G.api]), lane(data, [G.partenaires]), lane(data, [G.xp], { active: false })];
    const v = view({ data, lanes, window: { from: 0, to: 9 } });
    expect(v.lanes.map((b) => b.lane.id)).toEqual([G.api, G.partenaires]);
    expect(v.items.filter((p) => p.itemId === idOf('&22')).map((p) => p.laneId)).toEqual([G.api, G.partenaires]);
    expect(placed(v, '&15')).toBeUndefined();
    // Counted once.
    expect(v.stats).toMatchObject({ lanes: 2, epics: 3 });
  });

  it('applies each lane its types and labels', () => {
    const data = mockupBoard();
    const kinds = (v: BoardView) => new Set(v.items.map((p) => p.kind));
    const all = (patch: Partial<Lane>) => [lane(data, [data.rootGroup.path], patch)];
    expect(kinds(view({ data, lanes: all({ showEpics: false }) }))).toEqual(new Set(['issue']));
    expect(kinds(view({ data, lanes: all({ issueMode: 'none' }) }))).toEqual(new Set(['epic']));
    expect(view({ data, lanes: all({ showEpics: false, issueMode: 'none' }) }).items).toEqual([]);
    // "bug" or "UX", then both.
    expect(placedRefs(view({ data, lanes: all({ labels: ['bug', 'UX'] }) }))).toEqual(new Set(['#104', '#113', '&15'].map(idOf)));
    expect(placedRefs(view({ data, lanes: all({ labels: ['bug', 'priorité::haute'], labelMode: 'all' }) }))).toEqual(
      new Set(['#104', '#113'].map(idOf)),
    );
    // Lanes differ: epics in one, issues in the other.
    const split = view({ data, lanes: [lane(data, [G.api], { issueMode: 'none' }), lane(data, [G.data], { showEpics: false })] });
    expect(new Set(split.items.filter((p) => p.laneId === G.api).map((p) => p.kind))).toEqual(new Set(['epic']));
    expect(new Set(split.items.filter((p) => p.laneId === G.data).map((p) => p.kind))).toEqual(new Set(['issue']));
  });

  it('shows the issues of the lane mode: every one, the blocking ones or none (spec §5.1)', () => {
    const data = mockupBoard();
    const at = (issueMode: Lane['issueMode']) =>
      view({ data, lanes: [lane(data, [G.api], { issueMode }), lane(data, [G.data], { issueMode })], window: { from: 0, to: 9 } });
    const issues = (v: BoardView) => new Set(v.items.filter((p) => p.kind === 'issue').map((p) => p.itemId));
    expect(issues(at('blocking'))).toEqual(new Set(['#140', '#107', '#110', '#131', '#130'].map(idOf)));
    const every = at('all');
    expect(issues(every)).toEqual(new Set(['#140', '#107', '#110', '#150', '#151', '#131', '#130', '#152'].map(idOf)));
    // #152 has no iteration: unplanned, like a blocking one.
    expect(placed(every, '#152')!.unplanned).toBe(true);
    expect(every.columns.some((c) => c.key === 'unplanned')).toBe(true);
    // A link between two issues that block no epic is drawn.
    expect(every.links.some((l) => l.source === idOf('#150') && l.target === idOf('#151'))).toBe(true);
    expect(issues(at('none'))).toEqual(new Set());
  });

  it('searches refs and titles, case-insensitive, and keeps the dependency chain of the matches', () => {
    const context = (v: BoardView) => new Set(v.items.filter((p) => p.searchContext).map((p) => p.itemId));
    const matched = (v: BoardView) => new Set(v.items.filter((p) => !p.searchContext).map((p) => p.itemId));
    // #131 blocks &21 (in the window), which blocks &23 (after it: a pill on &21).
    const kafka = view({ query: 'KAFKA' });
    expect(matched(kafka)).toEqual(new Set([idOf('#131')]));
    expect(context(kafka)).toEqual(new Set([idOf('&21')]));
    expect(placed(kafka, '&21')!.offWindow).toEqual([idOf('&23')]);
    // &18: its blockers (&12, &19, #114 in the window; #140 before it) and what it blocks
    // (&21; &22 after it), not &13 nor #110 (other branches of &12 and &21).
    const e18 = view({ query: '&18' });
    expect(matched(e18)).toEqual(new Set([idOf('&18')]));
    expect(context(e18)).toEqual(new Set(['&12', '&19', '#114', '&21'].map(idOf)));
    expect(new Set(placed(e18, '&18')!.offWindow)).toEqual(new Set([idOf('&22'), idOf('#140')]));
    expect(matched(view({ query: 'export' }))).toEqual(new Set([idOf('&18'), idOf('#110')]));
    expect(matched(view({ query: '&1' })).size).toBe(6); // &12 &13 &15 &17 &18 &19, not &16 (out)
    // Only the link types shown: without "relates", #107 keeps &15 but loses #110.
    expect(placedRefs(view({ query: '#107' })).has(idOf('#110'))).toBe(true);
    expect(placedRefs(view({ query: '#107', options: { linkTypes: { blocks: true, relates: false, parent: false } } }))).toEqual(
      new Set([idOf('#107'), idOf('&15')]),
    );
    // Without query, nothing is a search dependency.
    expect(context(view())).toEqual(new Set());
  });

  it('hides the closed issues of a search chain with "Masquer les issues fermées"', () => {
    expect(placedRefs(view({ query: 'pipeline' })).has(idOf('#131'))).toBe(true); // blocks &21
    const hidden = placedRefs(view({ query: 'pipeline', options: { hideClosed: true } }));
    expect(hidden.has(idOf('#131'))).toBe(false);
    expect(hidden.has(idOf('&21'))).toBe(true);
  });

  it('hides closed issues only', () => {
    const data = mockupBoard();
    data.epics.find((e) => e.ref === '&18')!.state = 'closed';
    const shown = placedRefs(view({ data }));
    expect(shown.has(idOf('#131'))).toBe(true);
    const hidden = placedRefs(view({ data, options: { hideClosed: true } }));
    expect(hidden.has(idOf('#131'))).toBe(false);
    expect(hidden.has(idOf('&18'))).toBe(true);
  });
});

describe('links', () => {
  it('draws links between placed items of enabled types', () => {
    const v = view();
    expect(v.linkCounts).toEqual({ blocks: 12, relates: 2, parent: 0 });
    expect(v.links.every((l) => (l.type === 'blocks') === (l.arrow !== null))).toBe(true);
    const parent = view({ options: { linkTypes: { blocks: false, relates: false, parent: true } } });
    expect(parent.links.every((l) => l.type === 'parent')).toBe(true);
    expect(parent.linkCounts).toEqual({ blocks: 0, relates: 0, parent: 8 }); // #140 is out
  });

  it('flags conflicts and the critical path', () => {
    const v = view();
    const find = (a: string, b: string) => v.links.find((l) => l.source === idOf(a) && l.target === idOf(b))!;
    expect(find('&13', '&17').conflict).toBe(true);
    expect(find('&12', '&13').conflict).toBe(false);
    expect(find('&12', '&18').critical).toBe(true);
    expect(find('&18', '&21').critical).toBe(true);
    expect(find('&19', '&18').critical).toBe(false);
    expect(v.links.filter((l) => l.critical)).toHaveLength(2);
  });

  it('links items across lanes, once per pair', () => {
    const v = view();
    const paths = v.links.filter((l) => l.source === idOf('#107') && l.target === idOf('&15'));
    expect(paths.map((p) => [p.sourceKey, p.targetKey])).toEqual([[`${laneId(G.api)}|${idOf('#107')}`, `${laneId(G.xp)}|${idOf('&15')}`]]);
    expect(new Set(v.links.map((l) => l.key)).size).toBe(v.links.length);
  });

  it('counts dependencies outside the window per occurrence', () => {
    const v = view();
    expect(new Set(placed(v, '&18')!.offWindow)).toEqual(new Set([idOf('&22'), idOf('#140')]));
    expect(placed(v, '&21')!.offWindow).toEqual([idOf('&23')]);
    expect(placed(v, '#110')!.offWindow).toEqual([]);
    // the other end must match a lane: no epic shown, no "›" pill toward &23, which is then
    // outside every lane
    const data = mockupBoard();
    const w = view({ data, lanes: defaultLanes(data).map((l) => ({ ...l, showEpics: false })) });
    expect(placed(w, '#130')!.offWindow).toEqual([]);
    expect(placed(w, '#130')!.offLanes).toEqual([idOf('&23')]);
    // any active lane counts, not only the item's own
    const split = view({ data, lanes: [lane(data, [G.api]), lane(data, [G.data])] });
    expect(placed(split, '&21')!.offWindow).toEqual([idOf('&23')]);
    // disabled link types don't count
    const off = view({ options: { linkTypes: { blocks: false, relates: true, parent: false } } });
    expect(placed(off, '&18')!.offWindow).toEqual([]);
  });

  it('flags dependencies outside every active lane (spec §4.5)', () => {
    const data = mockupBoard();
    // &30 is in the root group, in no default lane: &15 relates to it.
    expect(placed(view({ data }), '&15')!.offLanes).toEqual([idOf('&30')]);
    expect(placed(view({ data }), '&15')!.offWindow).toEqual([]);
    // Only the link types shown count.
    expect(placed(view({ data, options: { linkTypes: { blocks: true, relates: false, parent: false } } }), '&15')!.offLanes).toEqual([]);
    // A lane taking the root brings it in: drawn, no longer flagged.
    const root = view({ data, lanes: [...defaultLanes(data), lane(data, [data.rootGroup.path], { includeSubgroups: false })] });
    expect(placed(root, '&15')!.offLanes).toEqual([]);
    expect(root.links.some((l) => l.source === idOf('&30') && l.target === idOf('&15'))).toBe(true);
    // An inactive lane doesn't count.
    const inactive = view({ data, lanes: [...defaultLanes(data), lane(data, [data.rootGroup.path], { active: false })] });
    expect(placed(inactive, '&15')!.offLanes).toEqual([idOf('&30')]);
    // Membership ignores the window, the search and the closed filter: those never make an item
    // "hors couloirs".
    expect(placed(view({ data, query: '&18' }), '&18')!.offLanes).toEqual([]);
    data.issues.find((i) => i.ref === '#114')!.state = 'closed';
    expect(placed(view({ data, options: { hideClosed: true } }), '&18')!.offLanes).toEqual([]);
    // An issue that a lane's rule excludes, matching no other lane, is outside every lane: #107
    // (API) blocks &15 (Expérience); API set to « Aucune issue ».
    const xp = lane(data, [G.xp]);
    const noIssues = view({ data, lanes: [lane(data, [G.api], { issueMode: 'none' }), xp] });
    expect(new Set(placed(noIssues, '&15')!.offLanes)).toEqual(new Set([idOf('#107'), idOf('&30')]));
    // In « Toutes », #150 → #151 is drawn: neither block an epic, both are in the lane.
    const all = view({ data, lanes: [lane(data, [G.api], { issueMode: 'all' })], window: { from: 0, to: 9 } });
    expect(placed(all, '#150')!.offLanes).toEqual([]);
    // Labels too: #110 blocks &21, in the Data group that no lane takes.
    const labelled = view({ data, lanes: [lane(data, [G.api], { showEpics: false, labels: ['API'] }), xp] });
    expect(placed(labelled, '#110')!.offLanes).toEqual([idOf('&21')]);
    // Parent links never count: an epic would be flagged for every issue its lanes hide.
    const parents = view({ data, options: { linkTypes: { blocks: false, relates: false, parent: true } } });
    expect(parents.items.every((p) => p.offLanes.length === 0)).toBe(true);
  });

  it('joins the occurrence in the same lane first, else the first one', () => {
    const data = mockupBoard();
    // &22 shows in API and in Partenaires; &18 (API) blocks it, &16 (Identité) relates to it.
    const lanes = [lane(data, [G.api]), lane(data, [G.partenaires]), lane(data, [G.identite])];
    const v = view({ data, lanes, window: { from: 4, to: 9 } });
    const ends = (l: BoardView['links'][number]) => [l.sourceKey.split('|')[0], l.targetKey.split('|')[0]];
    expect(v.links.filter((l) => l.source === idOf('&18') && l.target === idOf('&22')).map(ends)).toEqual([[G.api, G.api]]);
    expect(v.links.filter((l) => l.type === 'relates' && l.target === idOf('&22')).map(ends)).toEqual([[G.identite, G.api]]);
  });

  it('computes unique stats', () => {
    expect(view().stats).toEqual({ lanes: 4, epics: 7, issues: 8, blocks: 12, conflicts: 3 });
  });

  it('lists connected items', () => {
    const v = view();
    expect(connectedIds(v, idOf('&18'))).toEqual(new Set(['&18', '&12', '&19', '&21', '#114'].map(idOf)));
    expect(connectedIds(v, 'unknown')).toEqual(new Set(['unknown']));
  });
});

describe('curve', () => {
  const card = (x: number, y: number) => ({ x, y, w: 196, h: 96 });
  it('joins side-by-side items edge to edge, horizontally', () => {
    const g = curve(card(0, 0), card(300, 200), false, true);
    expect(g.d.startsWith('M196 48 C')).toBe(true);
    expect(g.d.endsWith(`${300 - LAYOUT.arrowLength} 248`)).toBe(true);
    expect(g.arrow).toBe('M300 248 L294 251.5 L294 244.5 Z');
  });
  it('goes backwards from the left edge', () => {
    const g = curve(card(300, 0), card(0, 0), false, false);
    expect(g.d.startsWith('M300 48')).toBe(true);
    expect(g.d.endsWith('196 48')).toBe(true);
    expect(g.arrow).toBeNull();
  });
  it('drops vertically, aligned on the narrower item', () => {
    const bar = { x: 0, y: 0, w: 600, h: 28 };
    const g = curve(bar, card(200, 100), false, false);
    expect(g.d).toMatch(/^M298 28 C298 \S+ 298 \S+ 298 100$/);
  });
  it('loops on the right side for two issues of one column', () => {
    const g = curve(card(0, 0), card(0, 208), true, true);
    expect(g.d.startsWith('M196 48 C')).toBe(true);
    expect(g.d.endsWith(`${196 + LAYOUT.arrowLength} 256`)).toBe(true);
    expect(g.arrow!.startsWith('M196 256')).toBe(true);
  });
});

describe('performance', () => {
  it('lays out 300 epics, 1000 issues, 3000 links and 6 lanes fast', () => {
    const data = generateBoard({ epics: 300, issues: 1000, links: 3000, groups: 6, iterations: 12 });
    const lanes = defaultLanes(data);
    expect(lanes).toHaveLength(6);
    const input: ViewInput = {
      data,
      lanes,
      window: { from: 0, to: 11 },
      options: { ...DEFAULT_OPTIONS, linkTypes: { blocks: true, relates: true, parent: true } },
      query: '',
      collapsed: new Set(),
    };
    computeBoardView(input); // warm up
    const t0 = performance.now();
    const v = computeBoardView(input);
    const elapsed = performance.now() - t0;
    expect(v.items.length).toBe(1300);
    expect(v.links.length).toBeGreaterThan(2500);
    expect(elapsed).toBeLessThan(300);
    // and with a query, a few overlapping lanes and the selection helper
    const t1 = performance.now();
    const v2 = computeBoardView({ ...input, lanes: [lane(data, [data.rootGroup.path]), ...lanes.slice(0, 3)], query: 'e' });
    connectedIds(v2, data.epics[0].id);
    expect(performance.now() - t1).toBeLessThan(300);
    console.info(`computeBoardView: ${elapsed.toFixed(1)} ms for ${v.items.length} items and ${v.links.length} links`);
  });
});

import { describe, expect, it } from 'vitest';
import type { BoardData } from '../api/types';
import { generateBoard, G, idOf, mockupBoard } from './fixtures';
import { defaultLanes } from './lanes';
import { DEFAULT_OPTIONS, type BoardView, type DisplayOptions, type Lane, type ViewInput } from './types';
import { COMPACT_LAYOUT, computeBoardView, connectedIds, curve, isCompactView, LAYOUT, layoutFor } from './view';

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

const laneId = (path: string) => `group:${path}`;
const placed = (v: BoardView, ref: string, lane?: string) =>
  v.items.find((p) => p.itemId === idOf(ref) && (!lane || p.laneId === lane));
const placedRefs = (v: BoardView) => new Set(v.items.map((p) => p.itemId));

function withUnplanned(): BoardData {
  const data = mockupBoard();
  data.epics.push({
    ...data.epics.find((e) => e.id === idOf('&18'))!,
    id: idOf('&30'),
    iid: '30',
    ref: '&30',
    title: 'Recherche plein texte',
    start: null,
    end: null,
    startDate: '',
    dueDate: '',
    unplanned: true,
  });
  data.issues.push({
    ...data.issues.find((i) => i.id === idOf('#110'))!,
    id: idOf('#150'),
    iid: '150',
    ref: '#150',
    title: 'Index de recherche',
    iteration: null,
    unplanned: true,
    blocksEpics: [idOf('&30')],
  });
  data.links.push({ source: idOf('#150'), target: idOf('&30'), type: 'blocks', conflict: false });
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
    const epic = placed(v, '&30')!;
    const issue = placed(v, '#150')!;
    expect(epic.unplanned && issue.unplanned).toBe(true);
    expect(epic.rect.x).toBe(last.x + LAYOUT.inset);
    expect(epic.rect.h).toBe(LAYOUT.barHeight);
    expect(issue.rect.y).toBeGreaterThanOrEqual(epic.rect.y + epic.rect.h);
    expect(issue.rect.h).toBe(LAYOUT.cardHeight);
    // drawn inside the unplanned column, linked
    expect(v.links.some((l) => l.source === idOf('#150') && l.target === idOf('&30'))).toBe(true);
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
    expect(placed(v, '&30')!.rect.w).toBe(w - 2 * LAYOUT.inset);
  });

  it('can be hidden', () => {
    const v = view({ data: withUnplanned(), options: { showUnplanned: false } });
    expect(v.columns.some((c) => c.key === 'unplanned')).toBe(false);
    expect(placed(v, '&30')).toBeUndefined();
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
    const all: Lane = { ...defaultLanes(data)[0], id: 'all', groups: ['plateforme/atlas'], includeSubgroups: true, showIssues: false };
    const w = view({ data, lanes: [all], window: { from: 0, to: 9 } });
    const bars = w.items.filter((p) => p.kind === 'epic');
    expect(bars).toHaveLength(10);
    for (const a of bars)
      for (const b of bars) {
        if (a === b) continue;
        const overlap = a.rect.x < b.rect.x + b.rect.w && b.rect.x < a.rect.x + a.rect.w && a.rect.y === b.rect.y;
        expect(overlap).toBe(false);
      }
    // at most 5 epics run at once (index 7: &13, &21, &17, &16, &22)
    expect(new Set(bars.map((b) => b.rect.y)).size).toBe(5);
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
    const lanes = defaultLanes(data);
    lanes[0] = { ...lanes[0], labels: ['nobody'] };
    lanes[1] = { ...lanes[1], active: false };
    const v = view({ data, lanes });
    expect(v.lanes).toHaveLength(3);
    expect(v.stats.lanes).toBe(3);
    expect(v.lanes[0].empty).toBe(true);
    expect(v.lanes[0].height).toBe(LAYOUT.laneMinHeight);
    expect(v.lanes[1].empty).toBe(false);
  });

  it('searches refs and titles, case-insensitive', () => {
    expect(placedRefs(view({ query: '#110' }))).toEqual(new Set([idOf('#110')]));
    expect(placedRefs(view({ query: 'sso' }))).toEqual(new Set([idOf('&12'), idOf('#114')]));
    expect(placedRefs(view({ query: 'export' }))).toEqual(new Set([idOf('&18'), idOf('#110')]));
    expect(placedRefs(view({ query: '&1' })).size).toBe(6); // &12 &13 &15 &17 &18 &19, not &16 (out)
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

  it('links the occurrence of the same lane first, else the first one', () => {
    const data = mockupBoard();
    const all: Lane = { ...defaultLanes(data)[0], id: 'all', name: 'Tout', groups: ['plateforme/atlas'], includeSubgroups: true };
    const v = view({ data, lanes: [...defaultLanes(data), all] });
    const paths = v.links.filter((l) => l.source === idOf('#107') && l.target === idOf('&15'));
    expect(paths.map((p) => [p.sourceKey, p.targetKey])).toEqual([
      [`${laneId(G.api)}|${idOf('#107')}`, `${laneId(G.xp)}|${idOf('&15')}`],
      [`all|${idOf('#107')}`, `all|${idOf('&15')}`],
    ]);
    expect(new Set(v.links.map((l) => l.key)).size).toBe(v.links.length);
    // items in two lanes count once
    expect(v.stats).toEqual({ lanes: 5, epics: 7, issues: 8, blocks: 12, conflicts: 3 });
  });

  it('counts dependencies outside the window per occurrence', () => {
    const v = view();
    expect(new Set(placed(v, '&18')!.offWindow)).toEqual(new Set([idOf('&22'), idOf('#140')]));
    expect(placed(v, '&21')!.offWindow).toEqual([idOf('&23')]);
    expect(placed(v, '#110')!.offWindow).toEqual([]);
    // the other end must match the lane: &23 is in "Data", not in "API"
    const lanes = defaultLanes(mockupBoard()).map((l) => (l.id === laneId(G.data) ? { ...l, showEpics: false } : l));
    const w = view({ lanes });
    expect(placed(w, '#130')!.offWindow).toEqual([]);
    // disabled link types don't count
    const off = view({ options: { linkTypes: { blocks: false, relates: true, parent: false } } });
    expect(placed(off, '&18')!.offWindow).toEqual([]);
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
    const all: Lane = { ...lanes[0], id: 'all', groups: ['plateforme/atlas'], includeSubgroups: true };
    const v2 = computeBoardView({ ...input, lanes: [...lanes, all], query: 'e' });
    connectedIds(v2, data.epics[0].id);
    expect(performance.now() - t1).toBeLessThan(300);
    console.info(`computeBoardView: ${elapsed.toFixed(1)} ms for ${v.items.length} items and ${v.links.length} links`);
  });
});

import { describe, expect, it } from 'vitest';
import { G, idOf, mockupBoard } from './fixtures';
import { defaultChecked } from './lanes';
import { decodeView, encodeView, idKey, resolveGroups, resolveItem, resolveWindow, type ViewState } from './share';
import { DEFAULT_OPTIONS } from './types';

// The mockup: It. 12 → It. 21 are gid://gitlab/Iteration/500 → 509, It. 15 current, so the
// default window is It. 14 – It. 18 (2 – 6). Groups: root 40, api 41, data 42, experience 43,
// identite 44, api/partenaires 45; the four subgroups are checked by default.
const data = mockupBoard();
const ROOT = data.rootGroup.path;

function state(overrides: Partial<ViewState> = {}): ViewState {
  return {
    checked: new Set(defaultChecked(data)),
    window: { from: 2, to: 6 },
    options: DEFAULT_OPTIONS,
    query: '',
    collapsed: new Set(),
    selectedId: null,
    ...overrides,
  };
}

/** Encodes, decodes and resolves, as a link opened in another browser. */
function roundTrip(view: ViewState, fixedWindow = false) {
  const shared = decodeView(encodeView(view, data, { fixedWindow }));
  return { shared, ...resolveGroups(shared, data), window: resolveWindow(shared, data), selectedId: resolveItem(shared, data) };
}

describe('idKey', () => {
  it('keeps the last segment of a global ID', () => {
    expect(idKey('gid://gitlab/Group/45')).toBe('45');
    expect(idKey('42')).toBe('42');
  });
});

describe('encodeView', () => {
  it('is empty for the default view', () => {
    expect(encodeView(state(), data)).toBe('');
  });

  it('always names the window of a shared link', () => {
    expect(encodeView(state(), data, { fixedWindow: true })).toBe('from=502&to=506');
  });

  it('names the checked groups by id, in tree order, when they differ from the default', () => {
    expect(encodeView(state({ checked: new Set([G.identite, G.partenaires, G.api]) }), data)).toBe('groups=41,45,44');
    expect(encodeView(state({ checked: new Set([...defaultChecked(data), G.partenaires]) }), data)).toBe('groups=41,45,42,43,44');
    expect(encodeView(state({ checked: new Set() }), data)).toBe('groups=');
  });

  it('writes the collapsed lanes that are shown', () => {
    expect(encodeView(state({ collapsed: new Set([G.api, G.partenaires]) }), data)).toBe('fold=41');
  });

  it('writes the item filters', () => {
    const options = { ...DEFAULT_OPTIONS, showEpics: false, labels: ['bug', 'priorité::haute'], labelMode: 'all' as const };
    expect(encodeView(state({ options }), data)).toBe('types=issues&label=bug&label=priorit%C3%A9%3A%3Ahaute&labelMode=all');
    expect(encodeView(state({ options: { ...DEFAULT_OPTIONS, showIssues: false, labels: ['UX'] } }), data)).toBe('types=epics&label=UX');
    expect(encodeView(state({ options: { ...DEFAULT_OPTIONS, showEpics: false, showIssues: false } }), data)).toBe('types=');
  });

  it('writes the display options that differ from the defaults', () => {
    const options = {
      ...DEFAULT_OPTIONS,
      linkTypes: { blocks: true, relates: false, parent: true },
      hideClosed: true,
      showUnplanned: false,
      criticalPath: true,
    };
    expect(encodeView(state({ options }), data)).toBe('links=blocks,parent&closed=hide&unplanned=hide&critical=1');
    const none = { ...DEFAULT_OPTIONS, linkTypes: { blocks: false, relates: false, parent: false } };
    expect(encodeView(state({ options: none }), data)).toBe('links=');
  });

  it('writes the trimmed search, escaped, and the key of a known selection', () => {
    expect(encodeView(state({ query: '  a+b &18 é ' }), data)).toBe('q=a%2Bb%20%2618%20%C3%A9');
    expect(encodeView(state({ selectedId: idOf('&18') }), data)).toBe('item=1018');
    expect(encodeView(state({ selectedId: 'gid://gitlab/WorkItem/9999' }), data)).toBe('');
  });

  it('leaves the window out without iterations, and groups without an id', () => {
    expect(encodeView(state({ window: null }), { ...data, iterations: [] }, { fixedWindow: true })).toBe('');
    const noIds = { ...data, groups: data.groups.map((g) => ({ ...g, id: '' })) };
    expect(encodeView(state({ checked: new Set([G.api]) }), noIds)).toBe('groups=');
  });
});

describe('decodeView', () => {
  it('gives the defaults for an empty query', () => {
    expect(decodeView('')).toEqual({
      groups: null,
      collapsed: [],
      window: null,
      options: DEFAULT_OPTIONS,
      query: '',
      item: null,
    });
  });

  it('reads every field, with or without "?"', () => {
    const view = decodeView(
      '?groups=41,45,41&fold=41,,41&from=503&to=505&types=issues,nope&label=bug&label=&label=bug&label=UX&labelMode=all' +
        '&links=parent,nope&closed=hide&unplanned=hide&critical=1&q=%2618%20x&item=1018',
    );
    expect(view).toEqual({
      groups: ['41', '45'],
      collapsed: ['41'],
      window: { from: '503', to: '505' },
      options: {
        linkTypes: { blocks: false, relates: false, parent: true },
        hideClosed: true,
        showUnplanned: false,
        criticalPath: true,
        showEpics: false,
        showIssues: true,
        labels: ['bug', 'UX'],
        labelMode: 'all',
      },
      query: '&18 x',
      item: '1018',
    });
  });

  it('ignores a window with one end only, and invalid values', () => {
    const view = decodeView('from=503&closed=yes&unplanned=no&critical=true&labelMode=some&item=');
    expect(view.window).toBeNull();
    expect(view.options).toEqual(DEFAULT_OPTIONS);
    expect(view.item).toBeNull();
    expect(decodeView('groups=').groups).toEqual([]);
  });
});

describe('resolveGroups', () => {
  it('checks the default groups without a list', () => {
    expect(resolveGroups({ groups: null, collapsed: [] }, data)).toEqual({ checked: new Set(defaultChecked(data)), collapsed: new Set() });
  });

  it('turns keys into paths, leaving unknown ones out', () => {
    expect(resolveGroups({ groups: ['45', '40', 'x'], collapsed: ['45', '99'] }, data)).toEqual({
      checked: new Set([G.partenaires, ROOT]),
      collapsed: new Set([G.partenaires]),
    });
    expect(resolveGroups({ groups: [], collapsed: [] }, data).checked).toEqual(new Set());
  });
});

describe('resolveWindow and resolveItem', () => {
  it('find the iterations and the item by key', () => {
    expect(resolveWindow({ window: { from: '503', to: '505' } }, data)).toEqual({ from: 3, to: 5 });
    expect(resolveWindow({ window: { from: '505', to: '503' } }, data)).toEqual({ from: 3, to: 5 });
    expect(resolveItem({ item: '1018' }, data)).toBe(idOf('&18'));
    expect(resolveItem({ item: '2110' }, data)).toBe(idOf('#110'));
  });

  it('are null when nothing or something unknown is named', () => {
    expect(resolveWindow({ window: null }, data)).toBeNull();
    expect(resolveWindow({ window: { from: '503', to: '999' } }, data)).toBeNull();
    expect(resolveItem({ item: null }, data)).toBeNull();
    expect(resolveItem({ item: '9999' }, data)).toBeNull();
  });
});

describe('a shared link', () => {
  it('shows the same view in another browser', () => {
    const options = {
      ...DEFAULT_OPTIONS,
      linkTypes: { blocks: true, relates: false, parent: true },
      criticalPath: true,
      showIssues: false,
      labels: ['sécurité'],
    };
    const view = state({
      checked: new Set([G.partenaires, G.api, G.identite]),
      window: { from: 4, to: 8 },
      options,
      query: 'SSO',
      collapsed: new Set([G.api]),
      selectedId: idOf('&12'),
    });
    const opened = roundTrip(view, true);
    expect(opened.checked).toEqual(new Set([G.api, G.partenaires, G.identite]));
    expect(opened.collapsed).toEqual(new Set([G.api]));
    expect(opened.window).toEqual({ from: 4, to: 8 });
    expect(opened.shared.options).toEqual(options);
    expect(opened.shared.query).toBe('SSO');
    expect(opened.selectedId).toBe(idOf('&12'));
    // Opened as is, it gives the same link.
    const again = { ...view, checked: opened.checked, collapsed: opened.collapsed };
    expect(encodeView(again, data, { fixedWindow: true })).toBe(encodeView(view, data, { fixedWindow: true }));
  });

  it('without a window follows the current iteration', () => {
    expect(roundTrip(state()).window).toBeNull();
  });
});

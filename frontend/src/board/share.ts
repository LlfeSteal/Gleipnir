// The view in the page's URL, so that a link shows someone else the same board (ADR-31): the
// checked groups (lanes), the window, the filters and options, the search and the selected
// item. Nothing else remembers it: two tabs on two URLs are two views. Defaults are left out,
// so a plain view has a plain URL; whatever is unknown or invalid falls back to its default,
// field by field. Groups, iterations and items are named by the last segment of their GitLab
// global ID: short, and stable when a group is renamed or moved.

import type { BoardData, LinkType } from '../api/types';
import { findItem, itemIndex } from './items';
import { defaultChecked, groupTree } from './lanes';
import { DEFAULT_OPTIONS, type BoardWindow, type DisplayOptions } from './types';
import { clampWindow, defaultWindow } from './window';

/** A view as the URL tells it, before the board data gives it meaning. */
export interface SharedView {
  /** Keys of the checked groups; null: the default ones. */
  groups: string[] | null;
  /** Keys of the groups whose lane is collapsed. */
  collapsed: string[];
  /** Iteration keys; null: the default window. */
  window: { from: string; to: string } | null;
  options: DisplayOptions;
  query: string;
  /** Work item key of the selected item. */
  item: string | null;
}

/** What the board shows, as the app holds it. */
export interface ViewState {
  checked: ReadonlySet<string>; // group paths
  /** null when the cadence has no iteration. */
  window: BoardWindow | null;
  options: DisplayOptions;
  query: string;
  collapsed: ReadonlySet<string>; // group paths
  selectedId: string | null;
}

const LINK_TYPES: LinkType[] = ['blocks', 'relates', 'parent'];

/** The short key of a GitLab global ID: "gid://gitlab/Iteration/512" → "512". */
export function idKey(id: string): string {
  return id.slice(id.lastIndexOf('/') + 1);
}

const list = (value: string) => [...new Set(value.split(',').filter(Boolean))];

/** The view a query string asks for (with or without its leading "?"). */
export function decodeView(search: string): SharedView {
  const params = new URLSearchParams(search);
  const groups = params.get('groups');
  const from = params.get('from');
  const to = params.get('to');
  const links = params.get('links');
  const checkedLinks = list(links ?? '');
  const types = params.get('types');
  const shownTypes = list(types ?? '');
  return {
    groups: groups === null ? null : list(groups),
    collapsed: list(params.get('fold') ?? ''),
    window: from && to ? { from, to } : null,
    options: {
      linkTypes:
        links === null
          ? { ...DEFAULT_OPTIONS.linkTypes }
          : { blocks: checkedLinks.includes('blocks'), relates: checkedLinks.includes('relates'), parent: checkedLinks.includes('parent') },
      hideClosed: params.get('closed') === 'hide',
      showUnplanned: params.get('unplanned') !== 'hide',
      criticalPath: params.get('critical') === '1',
      showEpics: types === null || shownTypes.includes('epics'),
      showIssues: types === null || shownTypes.includes('issues'),
      labels: [...new Set(params.getAll('label').filter(Boolean))],
      labelMode: params.get('labelMode') === 'all' ? 'all' : 'any',
    },
    query: params.get('q') ?? '',
    item: params.get('item') || null,
  };
}

/** Group paths by key; a group without an id is left out. */
function groupPaths(data: BoardData): Map<string, string> {
  return new Map(groupTree(data).filter((g) => g.id).map((g) => [idKey(g.id), g.path]));
}

/** The checked groups and collapsed lanes of a shared view, as group paths; unknown keys are
 * left out, and without a list the default groups are checked. */
export function resolveGroups(
  view: Pick<SharedView, 'groups' | 'collapsed'>,
  data: BoardData,
): { checked: Set<string>; collapsed: Set<string> } {
  const paths = groupPaths(data);
  const known = (keys: string[]) => keys.flatMap((key) => paths.get(key) ?? []);
  return {
    checked: new Set(view.groups === null ? defaultChecked(data) : known(view.groups)),
    collapsed: new Set(known(view.collapsed)),
  };
}

/** The window of a shared view, null when it names no known iterations (the default applies). */
export function resolveWindow(view: Pick<SharedView, 'window'>, data: BoardData): BoardWindow | null {
  if (!view.window) return null;
  const keys = data.iterations.map((iteration) => idKey(iteration.id));
  const from = keys.indexOf(view.window.from);
  const to = keys.indexOf(view.window.to);
  if (from < 0 || to < 0) return null;
  return clampWindow({ from, to }, data.iterations.length);
}

/** The id of the selected item of a shared view, null when unknown. */
export function resolveItem(view: Pick<SharedView, 'item'>, data: BoardData): string | null {
  if (!view.item) return null;
  for (const id of itemIndex(data).keys()) if (idKey(id) === view.item) return id;
  return null;
}

/** Escapes a query value, keeping "," readable (lists). */
const encode = (value: string) => encodeURIComponent(value).replace(/%2C/gi, ',');

/**
 * The query string of a view, without the leading "?" (empty for the default view). With
 * fixedWindow, the window is always written: a shared link shows the same iterations, even
 * opened once the current one has moved on.
 */
export function encodeView(view: ViewState, data: BoardData, { fixedWindow = false } = {}): string {
  const params: [string, string][] = [];
  // Tree order, so that the same groups give the same URL; a group without an id can't be named.
  const tree = groupTree(data).filter((g) => g.id);
  const checked = tree.filter((g) => view.checked.has(g.path));
  const defaults = defaultChecked(data);
  const plain = view.checked.size === defaults.length && defaults.every((path) => view.checked.has(path));
  if (!plain) params.push(['groups', checked.map((g) => idKey(g.id)).join(',')]);
  const collapsed = checked.filter((g) => view.collapsed.has(g.path));
  if (collapsed.length) params.push(['fold', collapsed.map((g) => idKey(g.id)).join(',')]);

  const win = view.window;
  const preset = defaultWindow(data);
  const from = win && data.iterations[win.from];
  const to = win && data.iterations[win.to];
  if (from && to && (fixedWindow || win.from !== preset.from || win.to !== preset.to)) {
    params.push(['from', idKey(from.id)], ['to', idKey(to.id)]);
  }

  const { linkTypes, hideClosed, showUnplanned, criticalPath, showEpics, showIssues, labels, labelMode } = view.options;
  if (!showEpics || !showIssues) {
    params.push(['types', [showEpics ? 'epics' : '', showIssues ? 'issues' : ''].filter(Boolean).join(',')]);
  }
  for (const label of labels) params.push(['label', label]);
  if (labels.length && labelMode === 'all') params.push(['labelMode', 'all']);
  if (LINK_TYPES.some((type) => linkTypes[type] !== DEFAULT_OPTIONS.linkTypes[type])) {
    params.push(['links', LINK_TYPES.filter((type) => linkTypes[type]).join(',')]);
  }
  if (hideClosed) params.push(['closed', 'hide']);
  if (!showUnplanned) params.push(['unplanned', 'hide']);
  if (criticalPath) params.push(['critical', '1']);
  if (view.query.trim()) params.push(['q', view.query.trim()]);
  if (view.selectedId && findItem(data, view.selectedId)) params.push(['item', idKey(view.selectedId)]);

  return params.map(([key, value]) => `${key}=${encode(value)}`).join('&');
}

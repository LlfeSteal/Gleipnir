// The window: a range of consecutive iterations shown as columns (spec §4.3).

import type { BoardData } from '../api/types';
import { findItem, isEpicUnplanned, isIssueUnplanned } from './items';
import type { BoardWindow } from './types';

export type PresetId = 'around' | 'next' | 'all';

const DEFAULT_WIDTH = 5;

/** Fits a window into [0, count - 1], keeping its width when possible (shifting it back in). */
export function clampWindow(w: BoardWindow, count: number): BoardWindow {
  if (count <= 0) return { from: 0, to: 0 };
  let from = Math.min(w.from, w.to);
  let to = Math.max(w.from, w.to);
  const width = Math.min(to - from, count - 1);
  if (from < 0) from = 0;
  if (from > count - 1) from = count - 1 - width;
  to = from + width;
  if (to > count - 1) {
    to = count - 1;
    from = to - width;
  }
  return { from, to };
}

/** Current - 1 .. current + 3, or the first five iterations when none is current. */
export function defaultWindow(data: BoardData): BoardWindow {
  const count = data.iterations.length;
  const from = data.current >= 0 ? data.current - 1 : 0;
  return clampWindow({ from, to: from + DEFAULT_WIDTH - 1 }, count);
}

/** Moves the window by delta iterations, keeping its width; no-op when it would leave the cadence. */
export function shiftWindow(w: BoardWindow, delta: number, count: number): BoardWindow {
  if (w.from + delta < 0 || w.to + delta > count - 1) return w;
  return { from: w.from + delta, to: w.to + delta };
}

/** Quick settings: "En cours ± 2", "6 prochaines", "Toutes". Truncated at the cadence's ends,
 * like the mockup; without a current iteration they start from the first one. */
export function presetWindow(id: PresetId, data: BoardData): BoardWindow {
  const last = Math.max(0, data.iterations.length - 1);
  const cur = data.current >= 0 ? data.current : 0;
  switch (id) {
    case 'around':
      return { from: Math.max(0, cur - 2), to: Math.min(last, cur + 2) };
    case 'next':
      return { from: cur, to: Math.min(last, cur + 5) };
    case 'all':
      return { from: 0, to: last };
  }
}

const PRESETS: PresetId[] = ['around', 'next', 'all'];

export function activePreset(w: BoardWindow, data: BoardData): PresetId | null {
  for (const id of PRESETS) {
    const p = presetWindow(id, data);
    if (p.from === w.from && p.to === w.to) return id;
  }
  return null;
}

/** Iteration span of an item; null when it is unplanned or unknown. */
export function itemSpan(data: BoardData, id: string): { start: number; end: number } | null {
  const entry = findItem(data, id);
  if (!entry) return null;
  if (entry.kind === 'epic') {
    const e = entry.item;
    return isEpicUnplanned(e) ? null : { start: e.start as number, end: e.end as number };
  }
  const i = entry.item;
  return isIssueUnplanned(i) ? null : { start: i.iteration as number, end: i.iteration as number };
}

/** An epic overlapping the window, an issue inside it; unplanned items are always "in" (they
 * have their own column), unknown ids never are. */
export function isInWindow(data: BoardData, id: string, w: BoardWindow): boolean {
  const entry = findItem(data, id);
  if (!entry) return false;
  const span = itemSpan(data, id);
  if (!span) return true;
  return span.end >= w.from && span.start <= w.to;
}

/** Shifts the window, keeping its width, so that the span shows: its start when it lies before
 * the window, its end when after. Unchanged when the span already overlaps the window. */
export function focusWindow(w: BoardWindow, span: { start: number; end: number }, count: number): BoardWindow {
  if (span.end >= w.from && span.start <= w.to) return w;
  const width = w.to - w.from;
  let from = span.start < w.from ? span.start : Math.max(0, span.end - width);
  from = Math.max(0, Math.min(from, count - 1 - width));
  return { from, to: from + width };
}

/** The window as stored in the browser (gleipnir.window, spec §4.3): its first and last
 * iterations by global ID, so it keeps pointing at the same iterations when the cadence grows. */
export interface StoredWindow {
  from: string;
  to: string;
}

export function storeWindow(w: BoardWindow, data: BoardData): StoredWindow | null {
  const from = data.iterations[w.from];
  const to = data.iterations[w.to];
  return from && to ? { from: from.id, to: to.id } : null;
}

/** The stored window, back as iteration indexes; null when it is missing, malformed or names an
 * iteration the cadence no longer has: the default window then applies. */
export function restoreWindow(value: unknown, data: BoardData): BoardWindow | null {
  if (!value || typeof value !== 'object') return null;
  const { from, to } = value as Record<string, unknown>;
  if (typeof from !== 'string' || typeof to !== 'string') return null;
  const a = data.iterations.findIndex((it) => it.id === from);
  const b = data.iterations.findIndex((it) => it.id === to);
  if (a < 0 || b < 0) return null;
  return { from: Math.min(a, b), to: Math.max(a, b) };
}

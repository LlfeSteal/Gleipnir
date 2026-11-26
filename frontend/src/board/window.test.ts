import { describe, expect, it } from 'vitest';
import { idOf, mockupBoard } from './fixtures';
import {
  activePreset,
  clampWindow,
  defaultWindow,
  focusWindow,
  isInWindow,
  itemSpan,
  presetWindow,
  restoreWindow,
  shiftWindow,
  storeWindow,
} from './window';

const data = mockupBoard(); // 10 iterations, current = 3

describe('defaultWindow', () => {
  it('is current - 1 .. current + 3', () => {
    expect(defaultWindow(data)).toEqual({ from: 2, to: 6 });
  });
  it('keeps 5 columns at the edges', () => {
    expect(defaultWindow({ ...data, current: 0 })).toEqual({ from: 0, to: 4 });
    expect(defaultWindow({ ...data, current: 9 })).toEqual({ from: 5, to: 9 });
  });
  it('shows the first five without a current iteration', () => {
    expect(defaultWindow({ ...data, current: -1 })).toEqual({ from: 0, to: 4 });
  });
  it('fits short cadences', () => {
    expect(defaultWindow({ ...data, iterations: data.iterations.slice(0, 3), current: 1 })).toEqual({ from: 0, to: 2 });
  });
});

describe('clampWindow', () => {
  it('shifts back in, keeping the width', () => {
    expect(clampWindow({ from: -2, to: 2 }, 10)).toEqual({ from: 0, to: 4 });
    expect(clampWindow({ from: 8, to: 12 }, 10)).toEqual({ from: 5, to: 9 });
    expect(clampWindow({ from: 15, to: 17 }, 10)).toEqual({ from: 7, to: 9 });
  });
  it('shrinks when wider than the cadence and orders the bounds', () => {
    expect(clampWindow({ from: 0, to: 20 }, 5)).toEqual({ from: 0, to: 4 });
    expect(clampWindow({ from: 4, to: 2 }, 10)).toEqual({ from: 2, to: 4 });
    expect(clampWindow({ from: 3, to: 5 }, 0)).toEqual({ from: 0, to: 0 });
  });
});

describe('shiftWindow', () => {
  it('moves by delta and keeps the width', () => {
    expect(shiftWindow({ from: 2, to: 6 }, 1, 10)).toEqual({ from: 3, to: 7 });
    expect(shiftWindow({ from: 2, to: 6 }, -2, 10)).toEqual({ from: 0, to: 4 });
  });
  it('is a no-op at the edges', () => {
    const left = { from: 0, to: 4 };
    const right = { from: 5, to: 9 };
    expect(shiftWindow(left, -1, 10)).toBe(left);
    expect(shiftWindow(right, 1, 10)).toBe(right);
  });
});

describe('presets', () => {
  it('computes the three quick settings', () => {
    expect(presetWindow('around', data)).toEqual({ from: 1, to: 5 });
    expect(presetWindow('next', data)).toEqual({ from: 3, to: 8 });
    expect(presetWindow('all', data)).toEqual({ from: 0, to: 9 });
  });
  it('truncates at the cadence ends', () => {
    expect(presetWindow('around', { ...data, current: 0 })).toEqual({ from: 0, to: 2 });
    expect(presetWindow('next', { ...data, current: 7 })).toEqual({ from: 7, to: 9 });
  });
  it('finds the active preset', () => {
    expect(activePreset({ from: 1, to: 5 }, data)).toBe('around');
    expect(activePreset({ from: 3, to: 8 }, data)).toBe('next');
    expect(activePreset({ from: 0, to: 9 }, data)).toBe('all');
    expect(activePreset({ from: 2, to: 6 }, data)).toBeNull();
  });
});

describe('itemSpan and isInWindow', () => {
  const w = { from: 2, to: 6 };
  it('spans epics and issues', () => {
    expect(itemSpan(data, idOf('&13'))).toEqual({ start: 5, end: 7 });
    expect(itemSpan(data, idOf('#110'))).toEqual({ start: 5, end: 5 });
    expect(itemSpan(data, 'nope')).toBeNull();
  });
  it('keeps overlapping epics and issues inside', () => {
    expect(isInWindow(data, idOf('&19'), w)).toBe(true); // 0..3 overlaps
    expect(isInWindow(data, idOf('&16'), w)).toBe(false); // 7..9
    expect(isInWindow(data, idOf('#140'), w)).toBe(false); // It. 13 (index 1)
    expect(isInWindow(data, idOf('#131'), w)).toBe(true); // index 2
    expect(isInWindow(data, 'nope', w)).toBe(false);
  });
  it('treats unplanned items as in the window', () => {
    const d = mockupBoard();
    const e = d.epics[0];
    Object.assign(e, { start: null, end: null, unplanned: true });
    expect(itemSpan(d, e.id)).toBeNull();
    expect(isInWindow(d, e.id, { from: 8, to: 9 })).toBe(true);
  });
});

describe('focusWindow', () => {
  const w = { from: 2, to: 6 };
  it('keeps the window when the span overlaps it', () => {
    expect(focusWindow(w, { start: 6, end: 8 }, 10)).toBe(w);
  });
  it('shifts back to show the start of an earlier item', () => {
    expect(focusWindow(w, { start: 0, end: 1 }, 10)).toEqual({ from: 0, to: 4 });
  });
  it('shifts forward to show the end of a later item', () => {
    expect(focusWindow(w, { start: 8, end: 9 }, 10)).toEqual({ from: 5, to: 9 });
    expect(focusWindow(w, { start: 7, end: 7 }, 10)).toEqual({ from: 3, to: 7 });
  });
  it('stays inside the cadence', () => {
    expect(focusWindow({ from: 0, to: 1 }, { start: 9, end: 9 }, 10)).toEqual({ from: 8, to: 9 });
  });
});

describe('storeWindow / restoreWindow (spec §4.3: the window is remembered)', () => {
  const data = mockupBoard();
  const it500 = (n: number) => `gid://gitlab/Iteration/${500 + n}`;

  it('stores the window by iteration ids, and reads it back', () => {
    expect(storeWindow({ from: 2, to: 6 }, data)).toEqual({ from: it500(2), to: it500(6) });
    expect(restoreWindow({ from: it500(2), to: it500(6) }, data)).toEqual({ from: 2, to: 6 });
    // Swapped ends are put back in order.
    expect(restoreWindow({ from: it500(6), to: it500(2) }, data)).toEqual({ from: 2, to: 6 });
  });

  it('stores nothing outside the cadence', () => {
    expect(storeWindow({ from: 2, to: 40 }, data)).toBeNull();
  });

  it('falls back (null) on anything missing, malformed or unknown', () => {
    for (const value of [null, undefined, 'x', 3, {}, { from: 2, to: 6 }, { from: it500(2) }, { from: it500(2), to: 'gid://gitlab/Iteration/1' }]) {
      expect(restoreWindow(value, data)).toBeNull();
    }
  });
});

import { describe, expect, it } from 'vitest';
import { revealScroll, type ScrollBox } from './reveal';

const view = { railWidth: 220, headerHeight: 56 };
const box = (scrollLeft: number, scrollTop: number): ScrollBox => ({
  scrollLeft,
  scrollTop,
  clientWidth: 800,
  clientHeight: 600,
  scrollWidth: 3000,
  scrollHeight: 2000,
});
const card = (x: number, y: number) => ({ x, y, w: 196, h: 100 });

describe('revealScroll', () => {
  it('does not move for an item already clear of the rail and header', () => {
    expect(revealScroll(card(400, 200), view, box(0, 0))).toEqual({ left: 0, top: 0 });
  });
  it('brings an item hidden under the rail just right of it', () => {
    // At scrollLeft 500 the free area starts at x 720: the card at 600 is under the rail.
    expect(revealScroll(card(600, 200), view, box(500, 0)).left).toBe(600 - 220 - 16);
  });
  it('brings an item cut on the right to the right edge, keeping its start visible', () => {
    expect(revealScroll(card(1000, 200), view, box(0, 0)).left).toBe(1000 + 196 + 16 - 800);
  });
  it('aligns an item wider than the free area on its start', () => {
    const bar = { x: 900, y: 70, w: 1200, h: 28 };
    expect(revealScroll(bar, view, box(0, 0)).left).toBe(900 - 220 - 16);
  });
  it('centers vertically in the area below the header', () => {
    const { top } = revealScroll(card(400, 1200), view, box(0, 0));
    // The card's center lands in the middle of [top + 56, top + 600].
    expect(1200 + 50 - top).toBe(56 + (600 - 56) / 2);
  });
  it('brings an item hidden under the sticky header down', () => {
    const { top } = revealScroll(card(400, 300), view, box(0, 280));
    expect(300 - top).toBeGreaterThanOrEqual(56);
  });
  it('moves as little as possible vertically in nearest mode', () => {
    // Below the visible area: its bottom lands at the bottom edge, minus the margin.
    expect(revealScroll(card(400, 700), view, box(0, 0), 'nearest').top).toBe(700 + 100 + 16 - 600);
    // Under the header: its top lands just below it.
    expect(revealScroll(card(400, 300), view, box(0, 280), 'nearest').top).toBe(300 - 56 - 16);
  });
  it('clamps to the scroll range', () => {
    expect(revealScroll(card(240, 60), view, box(900, 900))).toEqual({ left: 4, top: 0 });
    expect(revealScroll(card(2900, 1950), view, box(0, 0))).toEqual({ left: 2200, top: 1400 });
  });
});

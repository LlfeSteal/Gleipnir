// Where to scroll the board so that an item shows entirely in the area left free by the
// sticky lane rail (left) and column header (top). Pure, so it is tested without a DOM.

import type { BoardView, Rect } from './types';

/** The scroll container's geometry (an HTMLElement fits). */
export interface ScrollBox {
  scrollLeft: number;
  scrollTop: number;
  clientWidth: number;
  clientHeight: number;
  scrollWidth: number;
  scrollHeight: number;
}

/** Margin kept between a revealed item and the rail, the header or the far edges. */
const REVEAL_MARGIN = 16;

/** The scroll position that shows rect entirely in the part of the scroller not covered by the
 * sticky rail (left) and header (top), moving as little as possible horizontally. Vertically,
 * 'center' centers an item that is not fully visible (reveal from the inspector) and 'nearest'
 * moves as little as possible (keyboard focus). An item larger than that area is aligned on its
 * start. Clamped to the scroll range. */
export function revealScroll(
  rect: Rect,
  view: Pick<BoardView, 'railWidth' | 'headerHeight'>,
  scroller: ScrollBox,
  vertical: 'center' | 'nearest' = 'center',
): { left: number; top: number } {
  const m = REVEAL_MARGIN;
  const maxLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
  const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));

  // Horizontally: the free area is [left + railWidth, left + clientWidth].
  const startLeft = rect.x - view.railWidth - m; // item start just right of the rail
  const endLeft = rect.x + rect.w + m - scroller.clientWidth; // item end at the right edge
  let left = scroller.scrollLeft;
  if (left > startLeft || endLeft > startLeft) left = startLeft;
  else if (left < endLeft) left = endLeft;

  // Vertically: the free area is [top + headerHeight, top + clientHeight].
  const free = scroller.clientHeight - view.headerHeight;
  let top = scroller.scrollTop;
  if (rect.y - m < top + view.headerHeight || rect.y + rect.h + m > top + scroller.clientHeight) {
    const startTop = rect.y - view.headerHeight - m; // item top just below the header
    if (rect.h + 2 * m > free) top = startTop;
    else if (vertical === 'center') top = rect.y + rect.h / 2 - view.headerHeight - free / 2;
    else top = top > startTop ? startTop : rect.y + rect.h + m - scroller.clientHeight;
  }
  return { left: clamp(left, maxLeft), top: clamp(top, maxTop) };
}

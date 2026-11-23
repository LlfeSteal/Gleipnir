import { useCallback, useEffect, useMemo, useRef, type FocusEvent, type MouseEvent } from 'react';
import type { BoardData } from '../../api/types';
import { itemIndex } from '../../board/items';
import type { BoardView } from '../../board/types';
import { revealScroll } from '../../board/reveal';
import { connectedIds, isCompactView, LAYOUT } from '../../board/view';
import { BOARD } from '../../strings/board';
import { ColumnHeaders } from './ColumnHeaders';
import { EpicBar } from './EpicBar';
import { IssueCard } from './IssueCard';
import { LaneRail } from './LaneRail';
import { LinkLayer } from './LinkLayer';

export interface BoardCanvasProps {
  data: BoardData;
  view: BoardView;
  selectedId: string | null;
  onSelect(id: string | null): void;
  onToggleLane(laneId: string): void;
  onEditLane(laneId: string): void;
  revealId: string | null;
  onRevealed(): void;
  criticalPath: boolean;
}

const NO_IDS: string[] = [];

/** The board: one scroll container (both axes) holding a canvas of view.width × view.height.
 * The column headers stick to the top, the lane rail to the left; columns, links and items are
 * absolutely placed from the computed view. Selection and the critical path dim the rest
 * through data attributes on the canvas (see board.css). */
export function BoardCanvas({
  data,
  view,
  selectedId,
  onSelect,
  onToggleLane,
  onEditLane,
  revealId,
  onRevealed,
  criticalPath,
}: BoardCanvasProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const index = itemIndex(data);

  // Stable callbacks so the memoized items only re-render when their own state changes.
  const latest = useRef({ selectedId, onSelect, onRevealed });
  useEffect(() => {
    latest.current = { selectedId, onSelect, onRevealed };
  });
  const toggle = useCallback((id: string) => {
    const { selectedId: current, onSelect: select } = latest.current;
    select(current === id ? null : id);
  }, []);

  const placedIds = useMemo(() => new Set(view.items.map((p) => p.itemId)), [view]);
  const selection = selectedId !== null && placedIds.has(selectedId) ? selectedId : null;
  const related = useMemo(() => (selection ? connectedIds(view, selection) : null), [view, selection]);
  const critical = useMemo(() => new Set(data.criticalPath), [data]);
  const offRefs = useMemo(() => {
    const refs = new Map<string, string[]>();
    for (const p of view.items) {
      if (p.offWindow.length === 0) continue;
      const list: string[] = [];
      for (const id of p.offWindow) {
        const entry = index.get(id);
        if (entry) list.push(entry.item.ref);
      }
      refs.set(p.key, list);
    }
    return refs;
  }, [view, index]);

  // Click on the empty canvas clears the selection.
  const onBackgroundClick = (e: MouseEvent<HTMLDivElement>) => {
    if (selectedId === null) return;
    if ((e.target as Element).closest('button')) return;
    onSelect(null);
  };

  // Brings the first occurrence of revealId into view, fully visible in the area left free by
  // the sticky rail and header: horizontally just right of the rail when it is cut, vertically
  // centered when it is outside. When the page itself scrolls too (the container isn't
  // height-bound, or a short phone screen), the page follows to where the item will be.
  useEffect(() => {
    if (!revealId) return;
    const scroller = scrollRef.current;
    const placed = view.items.find((p) => p.itemId === revealId);
    if (scroller && placed) {
      const { left, top } = revealScroll(placed.rect, view, scroller);
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const behavior: ScrollBehavior = reduce ? 'auto' : 'smooth';
      const box = scroller.getBoundingClientRect();
      scroller.scrollTo({ left, top, behavior });
      const itemTop = box.top + placed.rect.y - top;
      const itemBottom = itemTop + placed.rect.h;
      if (itemTop < 0 || itemBottom > window.innerHeight) {
        window.scrollBy({ top: (itemTop + itemBottom - window.innerHeight) / 2, behavior });
      }
    }
    latest.current.onRevealed();
  }, [revealId, view]);

  // An item reached with the keyboard scrolls clear of the sticky rail and header (the
  // browser's own focus scrolling ignores sticky elements, scroll-padding is not enough on every
  // engine). Pointer focus is left alone: the item is already under the pointer.
  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    const scroller = scrollRef.current;
    const target = e.target as HTMLElement;
    const key = target.dataset?.itemKey;
    if (!scroller || !key || !isFocusVisible(target)) return;
    const placed = view.items.find((p) => p.key === key);
    if (!placed) return;
    const { left, top } = revealScroll(placed.rect, view, scroller, 'nearest');
    if (left !== scroller.scrollLeft || top !== scroller.scrollTop) scroller.scrollTo({ left, top });
  };

  const compact = isCompactView(view);
  return (
    <div
      className="board-scroll"
      ref={scrollRef}
      onClick={onBackgroundClick}
      onFocus={onFocus}
      // Keyboard focus and scrollIntoView keep items clear of the sticky rail and header.
      style={{ scrollPaddingLeft: view.railWidth + 8, scrollPaddingTop: view.headerHeight + 8 }}
    >
      <div
        className="board-canvas"
        style={{ width: view.width, height: view.height }}
        data-compact={compact || undefined}
        data-selection={selection !== null || undefined}
        data-critical-path={criticalPath || undefined}
      >
        <ColumnHeaders view={view} />
        <LaneRail view={view} data={data} onToggleLane={onToggleLane} onEditLane={onEditLane} />
        {view.columns.map((c) => (
          <div
            key={c.key}
            className="board-column"
            style={{ left: c.x, width: c.width, height: view.height }}
            data-current={c.current || undefined}
            data-unplanned={c.iteration === null || undefined}
            aria-hidden="true"
          />
        ))}
        {view.lanes.slice(0, -1).map((b) => (
          <div
            key={b.lane.id}
            className="lane-separator"
            style={{ left: view.railWidth, top: b.top + b.height, width: view.width - view.railWidth }}
            aria-hidden="true"
          />
        ))}
        {view.lanes
          .filter((b) => b.empty && !b.collapsed)
          .map((b) => (
            <p
              key={b.lane.id}
              className="lane-empty"
              style={{ left: view.railWidth + 16, top: b.top + LAYOUT.lanePaddingTop + 4 }}
            >
              {BOARD.emptyLane}
            </p>
          ))}
        <LinkLayer links={view.links} width={view.width} height={view.height} selectedId={selection} />
        {view.items.map((p) => {
          const entry = index.get(p.itemId);
          if (!entry) return null;
          const common = {
            placed: p,
            data,
            selected: p.itemId === selectedId,
            related: related?.has(p.itemId) ?? false,
            critical: critical.has(p.itemId),
            offWindowRefs: offRefs.get(p.key) ?? NO_IDS,
            onToggle: toggle,
          };
          return entry.kind === 'epic' ? (
            <EpicBar key={p.key} {...common} epic={entry.item} />
          ) : (
            <IssueCard key={p.key} {...common} issue={entry.item} />
          );
        })}
      </div>
    </div>
  );
}

function isFocusVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return false; // an engine without :focus-visible
  }
}

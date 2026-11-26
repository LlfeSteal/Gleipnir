import { memo } from 'react';
import type { BoardData, Epic } from '../../api/types';
import { shortIterationLabel } from '../../board/format';
import type { PlacedItem } from '../../board/types';
import { BOARD } from '../../strings/board';
import { ChevronLeftIcon, ChevronRightIcon, EpicIcon } from '../ui/Icons';
import { OffLanesPill } from './OffLanesPill';
import { OffWindowPill } from './OffWindowPill';

export interface ItemProps {
  placed: PlacedItem;
  data: BoardData;
  selected: boolean;
  /** Linked to the selected item (or the selection itself): not dimmed. */
  related: boolean;
  critical: boolean;
  offWindowRefs: string[];
  /** Refs of the dependencies in no active lane (spec §4.5). */
  offLanesRefs: string[];
  onToggle(id: string): void;
}

/** The tooltip-like description of an item's badges, for assistive technologies. */
export function badgesDescription(offWindowRefs: string[], offLanesRefs: string[]): string | undefined {
  const parts = [
    offWindowRefs.length ? BOARD.offWindowTitle(offWindowRefs) : '',
    offLanesRefs.length ? BOARD.offLanesTitle(offLanesRefs) : '',
  ].filter(Boolean);
  return parts.length ? parts.join('. ') : undefined;
}

/** An epic: a purple bar from its first to its last iteration in the window. A side cut by the
 * window is square with a chevron whose tooltip gives the real start or end. */
export const EpicBar = memo(function EpicBar({ placed, epic, data, selected, related, critical, offWindowRefs, offLanesRefs, onToggle }: ItemProps & { epic: Epic }) {
  const { rect } = placed;
  const closed = epic.state === 'closed';
  const label = (index: number | null) => {
    const it = index === null ? undefined : data.iterations[index];
    return it ? shortIterationLabel(it) : '';
  };
  return (
    <button
      type="button"
      className="board-item epic-bar"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      data-item-key={placed.key}
      data-clipped-start={placed.clippedStart || undefined}
      data-clipped-end={placed.clippedEnd || undefined}
      data-unplanned={placed.unplanned || undefined}
      data-closed={closed || undefined}
      data-related={related || undefined}
      data-critical={critical || undefined}
      data-search-context={placed.searchContext || undefined}
      aria-pressed={selected}
      aria-label={BOARD.epicLabel(epic.ref, epic.title, closed)}
      aria-description={badgesDescription(offWindowRefs, offLanesRefs)}
      onClick={() => onToggle(epic.id)}
    >
      {placed.clippedStart && (
        <span className="epic-clip" title={BOARD.startsIn(label(epic.start))}>
          <ChevronLeftIcon size={12} />
        </span>
      )}
      <EpicIcon size={13} className="epic-icon" />
      <span className="item-ref">{epic.ref}</span>
      <span className="epic-title" title={epic.title}>
        {epic.title}
      </span>
      <OffWindowPill refs={offWindowRefs} />
      <OffLanesPill refs={offLanesRefs} />
      {placed.clippedEnd && (
        <span className="epic-clip" title={BOARD.endsIn(label(epic.end))}>
          <ChevronRightIcon size={12} />
        </span>
      )}
    </button>
  );
});

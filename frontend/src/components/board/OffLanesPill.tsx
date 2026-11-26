import { BOARD } from '../../strings/board';
import { ExitIcon } from '../ui/Icons';

/** Dependencies of the item that match no active lane (spec §4.5): dotted, with an exit icon.
 * On an epic it reads "2 hors couloirs"; on an issue card (compact) only the icon and the
 * number, the tooltip giving the label and the refs. */
export function OffLanesPill({ refs, compact = false }: { refs: string[]; compact?: boolean }) {
  if (refs.length === 0) return null;
  return (
    <span className="pill off-lanes-pill" data-compact={compact || undefined} title={BOARD.offLanesTitle(refs)}>
      <ExitIcon size={11} />
      {compact ? refs.length : BOARD.offLanesPill(refs.length)}
    </span>
  );
}

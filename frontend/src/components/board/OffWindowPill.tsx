import { BOARD } from '../../strings/board';

/** "› 2": dependencies of the item that match its lane but sit outside the window (spec §4.5).
 * The tooltip lists them; the inspector lets the user jump to them. */
export function OffWindowPill({ refs }: { refs: string[] }) {
  if (refs.length === 0) return null;
  return (
    <span className="pill off-pill" title={BOARD.offWindowTitle(refs)}>
      {BOARD.offWindowPill(refs.length)}
    </span>
  );
}

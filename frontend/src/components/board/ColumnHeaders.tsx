import { memo } from 'react';
import { formatIterationDates } from '../../board/format';
import type { BoardView } from '../../board/types';
import { BOARD } from '../../strings/board';

/** The sticky header row: the "Couloirs" corner (sticky both ways), then one cell per column
 * with the iteration's name and dates. The current iteration is blue with an "En cours" label:
 * red is kept for conflicts. */
export const ColumnHeaders = memo(function ColumnHeaders({ view }: { view: BoardView }) {
  return (
    <div className="board-header" style={{ width: view.width, height: view.headerHeight }}>
      <div className="board-corner" style={{ width: view.railWidth }}>
        <span className="section-header">{BOARD.lanesCorner}</span>
      </div>
      {view.columns.map((c) => (
        <div
          key={c.key}
          className="column-header"
          style={{ width: c.width }}
          data-current={c.current || undefined}
          data-unplanned={c.iteration === null || undefined}
          aria-current={c.current ? 'date' : undefined}
        >
          {c.iteration ? (
            <>
              <span className="column-title">
                <span className="column-name" title={c.iteration.title}>
                  {c.iteration.title}
                </span>
                {c.current && <span className="column-current">{BOARD.current}</span>}
              </span>
              <span className="column-dates">{formatIterationDates(c.iteration)}</span>
            </>
          ) : (
            <span className="column-title">
              <span className="column-name">{BOARD.unplanned}</span>
            </span>
          )}
        </div>
      ))}
    </div>
  );
});

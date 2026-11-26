import { Fragment } from 'react';
import type { BoardStats } from '../board/types';
import { APP } from '../strings';

interface Part {
  key: string;
  value: number;
  text: string;
  alert?: boolean;
}

/** "4 couloirs · 10 epics · 9 issues · 12 blocages · 2 conflits": unique counts of
 * what the board shows (spec §4.7). No pills: numbers in --text, words in secondary. */
export function SummaryLine({ stats }: { stats: BoardStats }) {
  const parts: Part[] = [
    { key: 'lanes', value: stats.lanes, text: APP.summary.lanes(stats.lanes) },
    { key: 'epics', value: stats.epics, text: APP.summary.epics(stats.epics) },
    { key: 'issues', value: stats.issues, text: APP.summary.issues(stats.issues) },
    { key: 'blocks', value: stats.blocks, text: APP.summary.blocks(stats.blocks) },
    { key: 'conflicts', value: stats.conflicts, text: APP.summary.conflicts(stats.conflicts), alert: true },
  ];
  // Epics and issues always show, even at 0; the other parts only when there is something.
  const shown = parts.filter((part) => part.value > 0 || part.key === 'epics' || part.key === 'issues');
  return (
    <p className="summary-line">
      {shown.map((part, index) => (
        <Fragment key={part.key}>
          {index > 0 && <span aria-hidden="true"> · </span>}
          <span className="summary-part" data-part={part.key} data-alert={part.alert && part.value > 0 ? 'true' : undefined}>
            <strong>{part.value}</strong> {part.text}
          </span>
        </Fragment>
      ))}
    </p>
  );
}

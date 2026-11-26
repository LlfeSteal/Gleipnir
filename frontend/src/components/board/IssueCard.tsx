import { memo, type CSSProperties } from 'react';
import type { Issue } from '../../api/types';
import { labelColors, refsOf } from '../../board/items';
import { BOARD } from '../../strings/board';
import { BlockIcon, IssueClosedIcon, IssueOpenIcon } from '../ui/Icons';
import { badgesDescription, type ItemProps } from './EpicBar';
import { OffLanesPill } from './OffLanesPill';
import { OffWindowPill } from './OffWindowPill';

const MAX_LABELS = 2;

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const first = words[0][0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1][0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** An issue: a card with its state, ref, assignee, title on two lines, the epics it blocks (or
 * « Ne bloque aucun epic ») and up to two labels. A closed issue stays (a lifted blocker), in
 * secondary text. */
export const IssueCard = memo(function IssueCard({ placed, issue, data, selected, related, critical, offWindowRefs, offLanesRefs, onToggle }: ItemProps & { issue: Issue }) {
  const { rect } = placed;
  const closed = issue.state === 'closed';
  const blocks = refsOf(data, issue.blocksEpics);
  const colors = labelColors(data);
  const shown = issue.labels.slice(0, MAX_LABELS);
  const more = issue.labels.length - shown.length;
  return (
    <button
      type="button"
      className="board-item issue-card"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      data-item-key={placed.key}
      data-unplanned={placed.unplanned || undefined}
      data-closed={closed || undefined}
      data-related={related || undefined}
      data-critical={critical || undefined}
      data-search-context={placed.searchContext || undefined}
      aria-pressed={selected}
      aria-label={BOARD.issueLabel(issue.ref, issue.title, closed)}
      aria-description={badgesDescription(offWindowRefs, offLanesRefs)}
      onClick={() => onToggle(issue.id)}
    >
      <span className="issue-head">
        {closed ? <IssueClosedIcon size={14} className="issue-state" /> : <IssueOpenIcon size={14} className="issue-state" />}
        <span className="item-ref">{issue.ref}</span>
        {closed && <span className="issue-closed">{BOARD.closedIssue}</span>}
        <span className="issue-spacer" />
        <OffWindowPill refs={offWindowRefs} />
        <OffLanesPill refs={offLanesRefs} compact />
        {issue.assignee && (
          <span className="avatar" title={issue.assignee.name}>
            {initials(issue.assignee.name)}
          </span>
        )}
      </span>
      <span className="issue-title" title={issue.title}>
        {issue.title}
      </span>
      <span className="issue-blocks" data-none={blocks.length === 0 || undefined}>
        {blocks.length > 0 && <BlockIcon size={11} />}
        <span className="issue-blocks-text">{blocks.length > 0 ? BOARD.blocks(blocks) : BOARD.blocksNoEpic}</span>
      </span>
      {shown.length > 0 && (
        <span className="issue-labels">
          {shown.map((title) => (
            <span key={title} className="issue-label" style={{ '--label-color': colors.get(title) } as CSSProperties}>
              <span className="label-dot" />
              <span className="issue-label-text">{title}</span>
            </span>
          ))}
          {more > 0 && <span className="issue-label-more">{BOARD.moreLabels(more)}</span>}
        </span>
      )}
    </button>
  );
});

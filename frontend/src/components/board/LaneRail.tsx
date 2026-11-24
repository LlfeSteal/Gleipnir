import { memo } from 'react';
import type { BoardView, LaneBlock } from '../../board/types';
import { BOARD } from '../../strings/board';
import { ChevronRightIcon } from '../ui/Icons';
import { ItemGlyph } from './ItemGlyph';

interface LaneActions {
  onToggleLane(laneId: string): void;
}

/** The sticky left rail: one header per lane (a checked GitLab group, read only), with its
 * color edge, collapse chevron, name, group path and counts. */
export const LaneRail = memo(function LaneRail({ view, onToggleLane }: { view: BoardView } & LaneActions) {
  return (
    <div className="lane-rail" style={{ width: view.railWidth, height: view.height - view.headerHeight }}>
      {view.lanes.map((block) => (
        <LaneHeader key={block.lane.id} block={block} top={block.top - view.headerHeight} onToggleLane={onToggleLane} />
      ))}
    </div>
  );
});

function LaneHeader({ block, top, onToggleLane }: { block: LaneBlock; top: number } & LaneActions) {
  const { lane, collapsed, counts } = block;
  return (
    <section
      className="lane-header"
      data-lane-color={lane.color}
      data-collapsed={collapsed || undefined}
      style={{ top, height: block.height }}
      aria-label={lane.name}
    >
      <div className="lane-header-top">
        <button
          type="button"
          className="lane-button lane-chevron"
          aria-expanded={!collapsed}
          aria-label={collapsed ? BOARD.expandLane(lane.name) : BOARD.collapseLane(lane.name)}
          onClick={() => onToggleLane(lane.id)}
        >
          <ChevronRightIcon size={14} />
        </button>
        <span className="lane-name" title={lane.title}>
          {lane.name}
        </span>
      </div>
      {!collapsed && (
        // A sublane says where it sits: "API et intégrations › Partenaires".
        <div className="lane-meta" title={lane.id}>
          {lane.depth > 1 ? lane.title : lane.id}
        </div>
      )}
      <div className="lane-counts">
        <span className="lane-count" title={BOARD.laneEpics(counts.epics)}>
          <ItemGlyph kind="epic" size="small" />
          {counts.epics}
          <span className="visually-hidden"> {BOARD.typeEpics}</span>
        </span>
        <span className="lane-count" title={BOARD.laneIssues(counts.issues)}>
          <ItemGlyph kind="issue" size="small" />
          {counts.issues}
          <span className="visually-hidden"> {BOARD.typeIssues}</span>
        </span>
        {counts.outside > 0 && <span className="lane-outside">{BOARD.outside(counts.outside)}</span>}
      </div>
    </section>
  );
}

import { memo, type CSSProperties } from 'react';
import type { BoardData } from '../../api/types';
import { labelColors } from '../../board/items';
import { groupName } from '../../board/lanes';
import type { BoardView, LaneBlock } from '../../board/types';
import { BOARD } from '../../strings/board';
import { ChevronRightIcon, PencilIcon } from '../ui/Icons';
import { ItemGlyph } from './ItemGlyph';

interface LaneActions {
  onToggleLane(laneId: string): void;
  onEditLane(laneId: string): void;
}

/** The sticky left rail: one header per lane, with its color edge, collapse chevron, name,
 * filters, counts and an edit button shown on hover or focus. */
export const LaneRail = memo(function LaneRail({ view, data, onToggleLane, onEditLane }: { view: BoardView; data: BoardData } & LaneActions) {
  return (
    <div className="lane-rail" style={{ width: view.railWidth, height: view.height - view.headerHeight }}>
      {view.lanes.map((block) => (
        <LaneHeader
          key={block.lane.id}
          block={block}
          top={block.top - view.headerHeight}
          data={data}
          onToggleLane={onToggleLane}
          onEditLane={onEditLane}
        />
      ))}
    </div>
  );
});

function LaneHeader({ block, top, data, onToggleLane, onEditLane }: { block: LaneBlock; top: number; data: BoardData } & LaneActions) {
  const { lane, collapsed, counts } = block;
  const colors = labelColors(data);
  const groups = lane.groups.length ? lane.groups.map((p) => groupName(p, data.groups)).join(', ') : BOARD.noGroup;
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
        <span className="lane-name" title={lane.name}>
          {lane.name}
        </span>
        <button type="button" className="lane-button lane-edit" aria-label={BOARD.editLane(lane.name)} onClick={() => onEditLane(lane.id)}>
          <PencilIcon size={14} />
        </button>
      </div>
      {!collapsed && (
        <>
          <div className="lane-meta" title={groups}>
            {groups}
            {lane.includeSubgroups && lane.groups.length > 0 && <span className="lane-subgroups"> {BOARD.subgroups}</span>}
          </div>
          {lane.labels.length > 0 && (
            <div className="lane-meta lane-labels">
              {lane.labels.map((title) => (
                <span key={title} className="lane-label" style={{ '--label-color': colors.get(title) } as CSSProperties}>
                  <span className="label-dot" />
                  {title}
                </span>
              ))}
              <span className="lane-label-mode">· {lane.labelMode === 'all' ? BOARD.labelModeAll : BOARD.labelModeAny}</span>
            </div>
          )}
        </>
      )}
      <div className="lane-counts">
        {lane.showEpics && (
          <span className="lane-count" title={BOARD.laneEpics(counts.epics)}>
            <ItemGlyph kind="epic" size="small" />
            {counts.epics}
            <span className="visually-hidden"> {BOARD.typeEpics}</span>
          </span>
        )}
        {lane.showIssues && (
          <span className="lane-count" title={BOARD.laneIssues(counts.issues)}>
            <ItemGlyph kind="issue" size="small" />
            {counts.issues}
            <span className="visually-hidden"> {BOARD.typeIssues}</span>
          </span>
        )}
        {counts.outside > 0 && <span className="lane-outside">{BOARD.outside(counts.outside)}</span>}
      </div>
    </section>
  );
}

import type { BoardData, LinkType } from '../api/types';
import type { BoardView, DisplayOptions, Lane } from '../board/types';
import { Checkbox } from './ui/Checkbox';
import { Switch } from './ui/Switch';
import { CloseIcon, ExitIcon, PencilIcon, PlusIcon } from './ui/Icons';
import { LinkSwatch } from './board/LinkSwatch';
import { APP } from '../strings';

const LINK_TYPES: LinkType[] = ['blocks', 'relates', 'parent'];

interface Props {
  id: string;
  data: BoardData;
  view: BoardView | null;
  lanes: Lane[];
  onToggleLane: (laneId: string) => void;
  onEditLane: (laneId: string) => void;
  onNewLane: () => void;
  onConfigure: () => void;
  options: DisplayOptions;
  onOptionsChange: (next: DisplayOptions) => void;
  /** ≤ 760 px: shown as an overlay sheet, with a header and a close button. */
  overlay: boolean;
  onClose: () => void;
}

/** The source list (240 px, spec §4.8): the lanes (a checkbox shows or hides one, the pencil
 * edits it), « Nouveau couloir », then the link types and display options, all board-wide. */
export function Sidebar({
  id,
  data,
  view,
  lanes,
  onToggleLane,
  onEditLane,
  onNewLane,
  onConfigure,
  options,
  onOptionsChange,
  overlay,
  onClose,
}: Props) {
  const blocks = new Map(view?.lanes.map((block) => [block.lane.id, block]) ?? []);
  const setOption = <K extends keyof DisplayOptions>(key: K, value: DisplayOptions[K]) =>
    onOptionsChange({ ...options, [key]: value });
  const blocking = data.issues.filter((issue) => issue.blocksEpics.length > 0).length;

  return (
    <aside id={id} className="sidebar" data-overlay={overlay || undefined} aria-label={APP.sidebar.label}>
      {overlay && (
        <div className="sidebar-header">
          <h2>{APP.sidebar.label}</h2>
          <button type="button" className="button icon" aria-label={APP.sidebar.close} onClick={onClose}>
            <CloseIcon size={14} />
          </button>
        </div>
      )}

      <section className="sidebar-section" aria-labelledby={`${id}-lanes`}>
        <h2 id={`${id}-lanes`} className="section-header">
          {APP.sidebar.lanes}
        </h2>
        {lanes.length === 0 && <p className="hint">{APP.sidebar.noLane}</p>}
        <ul className="sidebar-list">
          {lanes.map((lane) => {
            const block = blocks.get(lane.id);
            const count = block ? block.counts.epics + block.counts.issues : null;
            return (
              <li key={lane.id} className="sidebar-lane" data-lane-color={lane.color} data-checked={lane.active || undefined}>
                <Checkbox
                  checked={lane.active}
                  onChange={() => onToggleLane(lane.id)}
                  aria-label={APP.sidebar.showLane(lane.name)}
                  label={
                    <span className="sidebar-lane-name">
                      <span className="lane-dot" aria-hidden="true" />
                      <span className="sidebar-lane-text">{lane.name}</span>
                    </span>
                  }
                  detail={
                    count === null ? undefined : (
                      <span className="sidebar-count" title={APP.sidebar.laneCount(count)}>
                        {count}
                      </span>
                    )
                  }
                />
                <button
                  type="button"
                  className="button icon sidebar-edit"
                  aria-label={APP.sidebar.editLane(lane.name)}
                  title={APP.sidebar.editLane(lane.name)}
                  onClick={() => onEditLane(lane.id)}
                >
                  <PencilIcon size={13} />
                </button>
              </li>
            );
          })}
        </ul>
        <div className="sidebar-actions">
          <button type="button" className="button plain" onClick={onNewLane}>
            <PlusIcon size={13} />
            {APP.sidebar.newLane}
          </button>
          <button type="button" className="button plain" onClick={onConfigure}>
            {APP.sidebar.configure}
          </button>
        </div>
        {data.issues.length > 0 && <p className="hint">{APP.sidebar.blockingIssues(blocking, data.issues.length)}</p>}
      </section>

      <section className="sidebar-section" aria-labelledby={`${id}-links`}>
        <h2 id={`${id}-links`} className="section-header">
          {APP.sidebar.links}
        </h2>
        <ul className="sidebar-list">
          {LINK_TYPES.map((type) => (
            <li key={type} className="sidebar-link">
              <Checkbox
                checked={options.linkTypes[type]}
                onChange={(checked) => setOption('linkTypes', { ...options.linkTypes, [type]: checked })}
                aria-label={APP.sidebar.linkTypes[type]}
                label={
                  <span className="sidebar-link-name">
                    <LinkSwatch type={type} />
                    {APP.sidebar.linkTypes[type]}
                  </span>
                }
                detail={<span className="sidebar-count">{view?.linkCounts[type] ?? 0}</span>}
              />
            </li>
          ))}
        </ul>
      </section>

      <section className="sidebar-section" aria-labelledby={`${id}-display`}>
        <h2 id={`${id}-display`} className="section-header">
          {APP.sidebar.display}
        </h2>
        <div className="sidebar-switches">
          <Switch
            checked={options.hideClosed}
            onChange={(value) => setOption('hideClosed', value)}
            label={APP.sidebar.hideClosed}
          />
          <Switch
            checked={options.showUnplanned}
            onChange={(value) => setOption('showUnplanned', value)}
            label={APP.sidebar.showUnplanned}
          />
          <Switch
            checked={options.criticalPath}
            onChange={(value) => setOption('criticalPath', value)}
            label={APP.sidebar.criticalPath}
            description={APP.sidebar.criticalPathHelp}
          />
        </div>
      </section>

      <section className="sidebar-section" aria-labelledby={`${id}-legend`}>
        <h2 id={`${id}-legend`} className="section-header">
          {APP.sidebar.legend}
        </h2>
        <ul className="sidebar-legend">
          <li>
            <span className="pill off-pill" aria-hidden="true">
              ›
            </span>
            {APP.sidebar.legendOffWindow}
          </li>
          <li>
            <span className="pill off-lanes-pill" aria-hidden="true">
              <ExitIcon size={11} />
            </span>
            {APP.sidebar.legendOffLanes}
          </li>
        </ul>
      </section>

      <footer className="sidebar-footer">
        <p className="hint">{APP.sidebar.touchHint}</p>
      </footer>
    </aside>
  );
}

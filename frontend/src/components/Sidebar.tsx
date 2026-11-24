import { useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { BoardData, LinkType } from '../api/types';
import type { BoardView, DisplayOptions, GroupNode, LabelMode } from '../board/types';
import { groupTree, laneColor } from '../board/lanes';
import { Checkbox } from './ui/Checkbox';
import { Switch } from './ui/Switch';
import { CopyLinkButton } from './ui/CopyLinkButton';
import { ChevronRightIcon, CloseIcon } from './ui/Icons';
import { Popover } from './ui/Popover';
import { SelectList } from './ui/SelectList';
import { SegmentedControl } from './ui/SegmentedControl';
import { LinkSwatch } from './board/LinkSwatch';
import { APP } from '../strings';

const LINK_TYPES: LinkType[] = ['blocks', 'relates', 'parent'];

interface Props {
  id: string;
  data: BoardData;
  view: BoardView | null;
  /** The checked groups (paths): the lanes. */
  checked: ReadonlySet<string>;
  onToggleGroup: (path: string) => void;
  options: DisplayOptions;
  onOptionsChange: (next: DisplayOptions) => void;
  /** ≤ 760 px: shown as an overlay sheet, with a header and a close button. */
  overlay: boolean;
  onClose: () => void;
  /** The link of the view: as an overlay (phones), its header holds the copy button, which has
   * no room in the compact toolbar. */
  shareLink?: (() => string) | null;
}

/** The source list (240 px): the GitLab group tree (a checked group is a lane), the item
 * filters, link types and display options, all board-wide. Read only: lanes come from GitLab. */
export function Sidebar({
  id,
  data,
  view,
  checked,
  onToggleGroup,
  options,
  onOptionsChange,
  overlay,
  onClose,
  shareLink = null,
}: Props) {
  const blocks = new Map(view?.lanes.map((block) => [block.lane.id, block]) ?? []);
  const setOption = <K extends keyof DisplayOptions>(key: K, value: DisplayOptions[K]) =>
    onOptionsChange({ ...options, [key]: value });
  const tree = groupTree(data);
  // Unfolded branches, for this session: the root, and those leading to a checked group.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => {
    const open = new Set([tree[0].path]);
    const byPath = new Map(tree.map((node) => [node.path, node]));
    for (const path of checked) {
      for (let p = byPath.get(path)?.parent; p; p = byPath.get(p)?.parent) open.add(p);
    }
    return open;
  });
  const toggleExpanded = (path: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  const shown = useMemo(() => visibleNodes(tree, expanded), [tree, expanded]);

  return (
    <aside id={id} className="sidebar" data-overlay={overlay || undefined} aria-label={APP.sidebar.label}>
      {overlay && (
        <div className="sidebar-header">
          <h2>{APP.sidebar.label}</h2>
          <div className="sidebar-header-actions">
            {shareLink && <CopyLinkButton link={shareLink} />}
            <button type="button" className="button icon" aria-label={APP.sidebar.close} onClick={onClose}>
              <CloseIcon size={14} />
            </button>
          </div>
        </div>
      )}

      <section className="sidebar-section" aria-labelledby={`${id}-lanes`}>
        <h2 id={`${id}-lanes`} className="section-header">
          {APP.sidebar.lanes}
        </h2>
        <ul className="sidebar-list" aria-label={APP.sidebar.groups}>
          {shown.map((node) => {
            const isChecked = checked.has(node.path);
            const block = blocks.get(node.path);
            const count = block ? block.counts.epics + block.counts.issues : null;
            const open = expanded.has(node.path);
            return (
              <li
                key={node.path}
                className="sidebar-lane"
                data-lane-color={laneColor(data, node.path)}
                data-checked={isChecked || undefined}
                style={{ '--depth': node.depth } as CSSProperties}
              >
                {node.children.length > 0 ? (
                  <button
                    type="button"
                    className="sidebar-disclosure"
                    aria-expanded={open}
                    aria-label={open ? APP.sidebar.collapseGroup(node.name) : APP.sidebar.expandGroup(node.name)}
                    title={open ? APP.sidebar.collapseGroup(node.name) : APP.sidebar.expandGroup(node.name)}
                    onClick={() => toggleExpanded(node.path)}
                  >
                    <ChevronRightIcon size={12} />
                  </button>
                ) : (
                  <span className="sidebar-disclosure" aria-hidden="true" />
                )}
                <Checkbox
                  checked={isChecked}
                  onChange={() => onToggleGroup(node.path)}
                  aria-label={node.name}
                  label={
                    <span className="sidebar-lane-name" title={node.path}>
                      <span className="lane-dot" aria-hidden="true" />
                      <span className="sidebar-lane-text">{node.name}</span>
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
              </li>
            );
          })}
        </ul>
        <p className="hint">{APP.sidebar.lanesHelp}</p>
      </section>

      <section className="sidebar-section" aria-labelledby={`${id}-items`}>
        <h2 id={`${id}-items`} className="section-header">
          {APP.sidebar.items}
        </h2>
        <div className="sidebar-switches">
          <Switch checked={options.showEpics} onChange={(value) => setOption('showEpics', value)} label={APP.sidebar.epics} />
          <Switch checked={options.showIssues} onChange={(value) => setOption('showIssues', value)} label={APP.sidebar.issues} />
          <LabelFilter
            data={data}
            labels={options.labels}
            mode={options.labelMode}
            onChange={(labels, labelMode) => onOptionsChange({ ...options, labels, labelMode })}
          />
        </div>
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

      <footer className="sidebar-footer">
        {data.ignoredIssues > 0 && <p className="hint">{APP.sidebar.ignored(data.ignoredIssues)}</p>}
        <p className="hint">{APP.sidebar.touchHint}</p>
      </footer>
    </aside>
  );
}

/** The nodes whose ancestors are all unfolded, in tree order. */
function visibleNodes(tree: GroupNode[], expanded: ReadonlySet<string>): GroupNode[] {
  const visible = new Set<string>();
  return tree.filter((node) => {
    const show = node.parent === null || (visible.has(node.parent) && expanded.has(node.parent));
    if (show) visible.add(node.path);
    return show;
  });
}

/** The label filter: a button naming the labels picked, opening a list of every label of the
 * board and the match mode. */
function LabelFilter({
  data,
  labels,
  mode,
  onChange,
}: {
  data: BoardData;
  labels: string[];
  mode: LabelMode;
  onChange: (labels: string[], mode: LabelMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) button.current?.focus();
  };
  const text = APP.sidebar.labelsButton(labels);
  return (
    <div className="menu-anchor sidebar-labels">
      <span className="sidebar-labels-term">{APP.sidebar.labels}</span>
      <button
        ref={button}
        type="button"
        className="button sidebar-labels-button"
        aria-label={`${APP.sidebar.labels}\u00a0: ${text}`}
        title={text}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-active={labels.length > 0 || undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="sidebar-labels-text">{text}</span>
      </button>
      <Popover open={open} onClose={close} label={APP.sidebar.labels} role="dialog" className="sidebar-labels-popover">
        <SelectList
          label={APP.sidebar.labels}
          options={data.labels.map((label) => ({ value: label.title, label: label.title, color: label.color }))}
          selected={labels}
          onChange={(next) => onChange(next, mode)}
          searchPlaceholder={APP.sidebar.labelsSearch}
          emptyText={APP.sidebar.noLabel}
        />
        <SegmentedControl<LabelMode>
          label={APP.sidebar.labelMode}
          size="small"
          options={[
            { value: 'any', label: APP.sidebar.labelModes.any },
            { value: 'all', label: APP.sidebar.labelModes.all },
          ]}
          value={mode}
          onChange={(next) => onChange(labels, next)}
        />
        {labels.length > 0 && (
          <button type="button" className="button plain" onClick={() => onChange([], mode)}>
            {APP.sidebar.clearLabels}
          </button>
        )}
      </Popover>
    </div>
  );
}

import { useMemo, useRef } from 'react';
import type { CSSProperties, PointerEvent, ReactNode } from 'react';
import type { BoardData } from '../api/types';
import type { BoardWindow, ItemKind, Lane } from '../board/types';
import { groupName, laneMatcher } from '../board/lanes';
import { itemIndex } from '../board/items';
import type { BoardItem } from '../board/items';
import { isInWindow } from '../board/window';
import { formatIterationDates, formatPeriod, shortIterationLabel } from '../board/format';
import { ItemGlyph } from './board/ItemGlyph';
import { ChevronRightIcon, CloseIcon, ExternalIcon } from './ui/Icons';
import { APP } from '../strings';

type Entry = BoardItem;

interface Dependency {
  id: string;
  conflict: boolean;
}

interface DependencyGroup {
  key: string;
  title: string;
  items: Dependency[];
}

/** Dependencies of an item, grouped as in spec §4.6. Unknown ids are skipped, duplicates merged. */
function dependencyGroups(data: BoardData, index: Map<string, Entry>, id: string, kind: ItemKind): DependencyGroup[] {
  const blocks: Dependency[] = [];
  const blockedByEpics: Dependency[] = [];
  const blockedByIssues: Dependency[] = [];
  const relates: Dependency[] = [];
  const add = (list: Dependency[], other: string, conflict: boolean) => {
    if (other === id || !index.has(other)) return;
    const existing = list.find((dep) => dep.id === other);
    if (existing) existing.conflict ||= conflict;
    else list.push({ id: other, conflict });
  };
  for (const link of data.links) {
    if (link.type === 'blocks') {
      if (link.source === id) add(blocks, link.target, link.conflict);
      else if (link.target === id) {
        add(index.get(link.source)?.kind === 'epic' ? blockedByEpics : blockedByIssues, link.source, link.conflict);
      }
    } else if (link.type === 'relates') {
      if (link.source === id) add(relates, link.target, false);
      else if (link.target === id) add(relates, link.source, false);
    }
  }
  const groups: DependencyGroup[] =
    kind === 'epic'
      ? [
          { key: 'blocks', title: APP.inspector.blocks, items: blocks },
          { key: 'blockedByEpics', title: APP.inspector.blockedByEpics, items: blockedByEpics },
          { key: 'blockedByIssues', title: APP.inspector.blockedByIssues, items: blockedByIssues },
          { key: 'relates', title: APP.inspector.relates, items: relates },
        ]
      : [
          { key: 'blocks', title: APP.inspector.blocks, items: blocks },
          // Not in the spec's list for issues, but issue → issue blocks exist: shown when any.
          { key: 'blockedBy', title: APP.inspector.blockedBy, items: [...blockedByEpics, ...blockedByIssues] },
          { key: 'relates', title: APP.inspector.relates, items: relates },
        ];
  return groups.filter((group) => group.items.length > 0);
}

/** Where an item sits in time, short: "It. 13", "It. 13 → It. 16", or "Non planifié". */
function whenLabel(data: BoardData, entry: Entry): string {
  if (entry.kind === 'issue') {
    const it = entry.item.iteration;
    return it === null || entry.item.unplanned ? APP.inspector.unplanned : shortIterationLabel(data.iterations[it]);
  }
  const { start, end } = entry.item;
  return start === null || end === null || entry.item.unplanned ? APP.inspector.unplanned : formatPeriod(data, start, end);
}

/** Phones: the inspector is a bottom sheet, and pulling its grabber or header down by more
 * than a third of it (or flicking it) dismisses it, like an iOS sheet. Inert where the grabber
 * is hidden (the side panel) and for a mouse, which has the close button. */
function useSheetDrag(onClose: () => void) {
  const panel = useRef<HTMLElement>(null);
  const drag = useRef<{ id: number; y: number; t: number; dy: number } | null>(null);

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    const element = panel.current;
    const grabber = element?.querySelector('.inspector-grabber');
    if (!element || event.pointerType === 'mouse' || !grabber || getComputedStyle(grabber).display === 'none') return;
    // The close button keeps its own tap.
    if ((event.target as Element).closest('button')) return;
    drag.current = { id: event.pointerId, y: event.clientY, t: event.timeStamp, dy: 0 };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    element.style.transition = 'none';
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const state = drag.current;
    if (!state || state.id !== event.pointerId || !panel.current) return;
    // Upwards it barely moves (rubber band), downwards it follows the finger.
    const raw = event.clientY - state.y;
    state.dy = raw > 0 ? raw : raw / 6;
    panel.current.style.transform = `translateY(${state.dy}px)`;
  };
  const onPointerEnd = (event: PointerEvent<HTMLElement>) => {
    const state = drag.current;
    const element = panel.current;
    if (!state || state.id !== event.pointerId || !element) return;
    drag.current = null;
    const speed = state.dy / Math.max(1, event.timeStamp - state.t); // px per ms
    const dismiss = event.type === 'pointerup' && (state.dy > element.offsetHeight / 3 || (state.dy > 24 && speed > 0.6));
    // Back in place (with the CSS transition) unless it goes away.
    element.style.transition = '';
    element.style.transform = '';
    if (dismiss) onClose();
  };
  return {
    panel,
    handlers: { onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd },
  };
}

/** Only http(s) links go to GitLab: a stored javascript: URL must never become clickable. */
function safeUrl(url: string): string | undefined {
  return /^https?:\/\//i.test(url) ? url : undefined;
}

interface Props {
  data: BoardData;
  itemId: string;
  lanes: Lane[];
  window: BoardWindow;
  onSelect: (id: string) => void;
  onClose: () => void;
}

/** Detail of the selected item (spec §4.6): a right panel, a bottom sheet on mobile. All
 * GitLab content is rendered as plain text. */
export function Inspector({ data, itemId, lanes, window: win, onSelect, onClose }: Props) {
  const index = itemIndex(data);
  const sheetDrag = useSheetDrag(onClose);
  const entry = index.get(itemId);
  const groups = useMemo(
    () => (entry ? dependencyGroups(data, index, itemId, entry.kind) : []),
    [data, index, itemId, entry],
  );
  if (!entry) return null;

  const { kind, item } = entry;
  const closed = item.state === 'closed';
  const group = data.groups.find((g) => g.path === item.groupPath);
  // Every active lane the item matches (they may overlap); a dependency in none is "hors
  // couloirs": not on the board, so not a button.
  const matchers = lanes.filter((lane) => lane.active).map((lane) => ({ lane, matches: laneMatcher(lane, data) }));
  const laneNames = matchers.filter(({ matches }) => matches(item, kind)).map(({ lane }) => lane);
  const inLanes = (other: Entry) => matchers.some(({ matches }) => matches(other.item, other.kind));
  const labelColors = new Map(data.labels.map((label) => [label.title, label.color]));
  const url = safeUrl(item.webUrl);

  const facts: { key: string; term: string; value: ReactNode }[] = [
    {
      key: 'group',
      term: APP.inspector.group,
      value: (
        <span title={item.groupPath}>
          {group?.name ?? item.groupPath}
          {group && <span className="inspector-secondary"> {item.groupPath}</span>}
        </span>
      ),
    },
    {
      key: 'lanes',
      term: APP.inspector.lanes,
      value: laneNames.length ? (
        <span className="inspector-lanes">
          {laneNames.map((lane) => (
            <span key={lane.id} className="inspector-lane" data-lane-color={lane.color}>
              <span className="lane-dot" aria-hidden="true" />
              {lane.name}
            </span>
          ))}
        </span>
      ) : (
        APP.inspector.none
      ),
    },
  ];
  if (entry.kind === 'issue') {
    const issue = entry.item;
    const it = issue.iteration === null ? null : data.iterations[issue.iteration];
    const parent = issue.parentEpic ? index.get(issue.parentEpic) : undefined;
    facts.push(
      {
        key: 'iteration',
        term: APP.inspector.iteration,
        value: it ? (
          <span>
            {it.title}
            <span className="inspector-secondary"> {formatIterationDates(it)}</span>
          </span>
        ) : (
          APP.inspector.unplanned
        ),
      },
      {
        key: 'parent',
        term: APP.inspector.parent,
        value: parent ? (
          <button type="button" className="inspector-inline-link" onClick={() => onSelect(parent.item.id)}>
            <strong>{parent.item.ref}</strong> {parent.item.title}
          </button>
        ) : (
          APP.inspector.none
        ),
      },
      { key: 'assignee', term: APP.inspector.assignee, value: issue.assignee?.name || APP.inspector.none },
    );
  } else {
    const epic = entry.item;
    const planned = !epic.unplanned && epic.start !== null && epic.end !== null;
    facts.push({
      key: 'period',
      term: APP.inspector.period,
      value: planned ? (
        <span>
          {formatPeriod(data, epic.start!, epic.end!)}
          {epic.datesFromChildren && <span className="inspector-note">{APP.inspector.inherited}</span>}
        </span>
      ) : (
        APP.inspector.unplanned
      ),
    });
  }

  return (
    <aside ref={sheetDrag.panel} className="inspector" aria-label={APP.inspector.label} data-kind={kind}>
      <div className="inspector-grabber" aria-hidden="true" {...sheetDrag.handlers} />
      <header className="inspector-header" {...sheetDrag.handlers}>
        <ItemGlyph kind={kind} closed={closed} />
        <span className="inspector-type">{kind === 'epic' ? APP.inspector.epic : APP.inspector.issue}</span>
        <span className="inspector-ref">{item.ref}</span>
        <span className="state-pill" data-state={item.state}>
          {APP.inspector.state[kind][item.state]}
        </span>
        <button type="button" className="button icon inspector-close" aria-label={APP.inspector.close} onClick={onClose}>
          <CloseIcon size={14} />
        </button>
      </header>
      <div className="inspector-body">
        <h2 className="inspector-title">{item.title}</h2>

        <dl className="inset-list">
          {facts.map((fact) => (
            <div key={fact.key} className="inset-row">
              <dt>{fact.term}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>

        {item.labels.length > 0 && (
          <section className="inspector-section">
            <h3 className="section-header">{APP.inspector.labels}</h3>
            <ul className="inspector-labels">
              {item.labels.map((title) => (
                <li key={title} className="inspector-label">
                  <span
                    className="label-dot"
                    aria-hidden="true"
                    style={{ '--label-color': labelColors.get(title) } as CSSProperties}
                  />
                  {title}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="inspector-section">
          <h3 className="section-header">{APP.inspector.dependencies}</h3>
          {groups.length === 0 && <p className="hint">{APP.inspector.noDependency}</p>}
          {groups.map((dependencies) => (
            <div key={dependencies.key} className="dependency-group" role="group" aria-label={dependencies.title}>
              <h4 className="dependency-group-title">
                {dependencies.title}
                <span className="pill">{dependencies.items.length}</span>
              </h4>
              <ul className="dependency-list">
                {dependencies.items.map((dep) => {
                  const other = index.get(dep.id)!;
                  const closedOther = other.item.state === 'closed';
                  const conflict = dep.conflict && (
                    <span className="conflict-tag" title={APP.inspector.conflictHelp}>
                      {APP.inspector.conflict}
                    </span>
                  );
                  if (!inLanes(other)) {
                    return (
                      <li key={dep.id}>
                        <div className="dependency-row" data-off-lanes="true" data-closed={closedOther || undefined} title={APP.inspector.outsideLanesHelp}>
                          <ItemGlyph kind={other.kind} closed={closedOther} size="small" />
                          <span className="dependency-ref">{other.item.ref}</span>
                          <span className="dependency-title">{other.item.title}</span>
                          <span className="dependency-when">
                            {APP.inspector.outsideLanes(groupName(other.item.groupPath, data.groups))}
                          </span>
                          {conflict}
                        </div>
                      </li>
                    );
                  }
                  const inside = isInWindow(data, dep.id, win);
                  return (
                    <li key={dep.id}>
                      <button
                        type="button"
                        className="dependency-row"
                        data-closed={closedOther || undefined}
                        onClick={() => onSelect(dep.id)}
                      >
                        <ItemGlyph kind={other.kind} closed={closedOther} size="small" />
                        <span className="dependency-ref">{other.item.ref}</span>
                        <span className="dependency-title">{other.item.title}</span>
                        {!inside && (
                          <span className="dependency-when" title={APP.inspector.outside}>
                            {whenLabel(data, other)}
                          </span>
                        )}
                        {conflict}
                        <ChevronRightIcon size={12} className="dependency-chevron" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>

        {url && (
          <a className="button inspector-open" href={url} target="_blank" rel="noopener noreferrer">
            {APP.inspector.openInGitLab}
            <ExternalIcon size={13} />
          </a>
        )}
      </div>
    </aside>
  );
}

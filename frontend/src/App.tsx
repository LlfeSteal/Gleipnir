import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { BoardWindow, DisplayOptions } from './board/types';
import { defaultChecked, laneOf, lanesOf, refreshScope, scopeSyncedAt } from './board/lanes';
import { decodeView, encodeView, resolveGroups, resolveItem, resolveWindow } from './board/share';
import { clampWindow, defaultWindow, focusWindow, isInWindow, itemSpan, presetWindow } from './board/window';
import { shortIterationLabel } from './board/format';
import { findItem, isUnplanned } from './board/items';
import { computeBoardView, layoutFor } from './board/view';
import { errorMessage } from './api/client';
import { useBoard } from './hooks/useBoard';
import { useAppearance } from './hooks/useAppearance';
import { useStoredState } from './hooks/usePreferences';
import { BoardCanvas } from './components/board/BoardCanvas';
import { EmptyState, ErrorBanner, Skeleton } from './components/ui/StateViews';
import { Toolbar } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { SummaryLine } from './components/SummaryLine';
import { Inspector } from './components/Inspector';
import { APP } from './strings';

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (!list) return;
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/** Text fields and open menus or sheets handle Escape themselves. */
function ownsEscape(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLInputElement) return target.type !== 'checkbox' && target.type !== 'radio';
  return !!target.closest('textarea, select, dialog, [role="menu"], [role="dialog"]');
}

export default function App() {
  const { data, error, loading, refreshing, fetchedAt, reload } = useBoard();
  const { appearance, setAppearance } = useAppearance();
  const compact = useMediaQuery('(max-width: 760px)');

  // Remembered in the browser: how the app looks, not what it shows.
  const [sidebarCollapsed, setSidebarCollapsed] = useStoredState<boolean>('gleipnir.sidebar', false, isBoolean);
  // The view lives in the URL (ADR-31): read once; the groups, window and selection when the
  // first data gives them meaning.
  const [initialView] = useState(() => decodeView(window.location.search));
  const [viewResolved, setViewResolved] = useState(false);
  // The checked groups, by path: the lanes (ADR-32). null until the data has come.
  const [checked, setChecked] = useState<ReadonlySet<string> | null>(null);
  const [windowState, setWindowState] = useState<BoardWindow | null>(null); // null: the default window
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [options, setOptions] = useState<DisplayOptions>(initialView.options);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [query, setQuery] = useState(initialView.query);
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [revealId, setRevealId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // Typing stays smooth on a large board: the layout follows the query a bit later.
  const deferredQuery = useDeferredValue(query.trim());
  // Width of the board's scroll container, measured by the canvas; a resize relays out later
  // too, so dragging the window edge stays smooth on a large board.
  const [boardWidth, setBoardWidth] = useState(0);
  const deferredWidth = useDeferredValue(boardWidth);

  // Applied while rendering the first data, so the board never shows the default view first.
  if (data && !viewResolved) {
    const selection = resolveItem(initialView, data);
    const groups = resolveGroups(initialView, data);
    setViewResolved(true);
    setChecked(groups.checked);
    setCollapsed(groups.collapsed);
    setWindowState(resolveWindow(initialView, data));
    setSelectedId(selection);
    setRevealId(selection);
  }
  const checkedGroups = useMemo(() => checked ?? new Set<string>(), [checked]);
  const lanes = useMemo(() => (data ? lanesOf(data, checkedGroups) : []), [data, checkedGroups]);

  const iterationCount = data?.iterations.length ?? 0;
  const boardWindow = useMemo(
    () => (data && iterationCount > 0 ? clampWindow(windowState ?? defaultWindow(data), iterationCount) : null),
    [data, windowState, iterationCount],
  );
  const setWindow = useCallback((next: BoardWindow) => setWindowState(next), []);

  // The address bar follows the view, defaults left out; replaceState, so that Back isn't
  // flooded with every change. Untouched until the data has come: a link that fails to load
  // keeps what it asks for.
  const viewState = useMemo(
    () => ({ checked: checkedGroups, window: boardWindow, options, query: deferredQuery, collapsed, selectedId }),
    [checkedGroups, boardWindow, options, deferredQuery, collapsed, selectedId],
  );
  const viewQuery = useMemo(() => (data && checked ? encodeView(viewState, data) : null), [data, checked, viewState]);
  useEffect(() => {
    if (viewQuery === null || viewQuery === window.location.search.slice(1)) return;
    const { pathname, hash } = window.location;
    window.history.replaceState(window.history.state, '', `${pathname}${viewQuery ? `?${viewQuery}` : ''}${hash}`);
  }, [viewQuery]);
  // A shared link always names its iterations: opened later, it shows the same ones. It takes
  // the query as typed, not the deferred one.
  const shareLink = () =>
    data
      ? `${window.location.origin}${window.location.pathname}?${encodeView({ ...viewState, query }, data, { fixedWindow: true })}`
      : '';

  const view = useMemo(
    () =>
      data && boardWindow
        ? computeBoardView(
            { data, lanes, window: boardWindow, options, query: deferredQuery, collapsed, availableWidth: deferredWidth },
            // Phones: a narrow rail and columns, so the board shows more than the rail.
            layoutFor(compact),
          )
        : null,
    [data, lanes, boardWindow, options, deferredQuery, collapsed, compact, deferredWidth],
  );

  // A selected item that leaves the board (filters, window, lanes, refresh) is deselected. One
  // that was never on it (a dependency outside every lane, picked in the inspector) stays
  // shown in the inspector.
  const seenOnBoard = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedId || !view || !data) return;
    const exists = findItem(data, selectedId) !== null;
    const shown = view.items.some((item) => item.itemId === selectedId);
    if (shown) seenOnBoard.current = selectedId;
    else if (!exists || seenOnBoard.current === selectedId) {
      seenOnBoard.current = null;
      setSelectedId(null);
    }
  }, [selectedId, view, data]);

  /** From the inspector: bring the item into the window (same width), select it and scroll
   * to it (spec §4.6). */
  const navigateTo = useCallback(
    (id: string) => {
      if (!data || !boardWindow) return;
      if (!isInWindow(data, id, boardWindow)) {
        const span = itemSpan(data, id);
        if (span) setWindow(focusWindow(boardWindow, span, iterationCount));
      }
      const entry = findItem(data, id);
      if (entry) {
        // Unplanned items live in their own column: show it, and open the lane hiding the item.
        if (isUnplanned(entry) && !options.showUnplanned) setOptions((o) => ({ ...o, showUnplanned: true }));
        const lane = laneOf(entry.item.groupPath, checkedGroups);
        if (lane && collapsed.has(lane)) {
          setCollapsed((current) => {
            const next = new Set(current);
            next.delete(lane);
            return next;
          });
        }
      }
      setSelectedId(id);
      setRevealId(id);
    },
    [data, boardWindow, iterationCount, setWindow, options.showUnplanned, checkedGroups, collapsed],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'f') {
        // ⌘F / Ctrl+F: the board's own search rather than the browser's.
        event.preventDefault();
        // On a phone the field may be folded: unfolding it focuses it (see Toolbar).
        if (compact) setSearchOpen(true);
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (event.key !== 'Escape' || event.defaultPrevented || ownsEscape(event.target)) return;
      if (overlayOpen && compact) setOverlayOpen(false);
      else setSelectedId(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [overlayOpen, compact]);

  const toggleGroup = useCallback((path: string) => {
    setChecked((current) => {
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  }, []);
  const toggleCollapsed = useCallback((laneId: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(laneId)) next.add(laneId);
      return next;
    });
  }, []);
  const onRevealed = useCallback(() => setRevealId(null), []);

  const sidebarOpen = compact ? overlayOpen : !sidebarCollapsed;
  const toggleSidebar = () => (compact ? setOverlayOpen((open) => !open) : setSidebarCollapsed(!sidebarCollapsed));

  const activeLanes = lanes.length;
  // Synchroniser only reads the groups the user looks at: the whole group is read in the
  // background by the backend, every CACHE_TTL.
  const scope = useMemo(() => refreshScope(checkedGroups), [checkedGroups]);
  const refresh = scope.length > 0 ? () => void reload(scope) : null;
  const shownSyncedAt = useMemo(() => (data ? scopeSyncedAt(data, checkedGroups) : null), [data, checkedGroups]);
  const nothingShown = !!view && view.lanes.length > 0 && view.lanes.every((block) => block.empty);
  const selected = selectedId && data && boardWindow ? selectedId : null;
  const failure = error ? errorMessage(error) : null;

  let board: ReactNode = null;
  if (data && !boardWindow) {
    board = <EmptyState title={APP.states.noIterationTitle} message={APP.states.noIterationMessage(data.cadence.title)} />;
  } else if (data && view && boardWindow) {
    if (activeLanes === 0) {
      board = (
        <EmptyState
          title={APP.states.noLaneTitle}
          message={APP.states.noLaneMessage}
          action={
            <button type="button" className="button" onClick={() => setChecked(new Set(defaultChecked(data)))}>
              {APP.states.defaultLanes}
            </button>
          }
        />
      );
    } else if (nothingShown && deferredQuery) {
      board = (
        <EmptyState
          title={APP.states.noMatchTitle}
          message={APP.states.noMatchMessage(deferredQuery)}
          action={
            <button type="button" className="button" onClick={() => setQuery('')}>
              {APP.states.clearSearch}
            </button>
          }
        />
      );
    } else if (nothingShown) {
      const range = APP.window.range(
        shortIterationLabel(data.iterations[boardWindow.from]),
        shortIterationLabel(data.iterations[boardWindow.to]),
      );
      board = (
        <EmptyState
          title={APP.states.emptyWindowTitle}
          message={APP.states.emptyWindowMessage(range)}
          action={
            <button type="button" className="button" onClick={() => setWindow(presetWindow('all', data))}>
              {APP.states.showAll}
            </button>
          }
        />
      );
    } else {
      board = (
        <div className="board-card card">
          <BoardCanvas
            data={data}
            view={view}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onToggleLane={toggleCollapsed}
            revealId={revealId}
            onRevealed={onRevealed}
            criticalPath={options.criticalPath}
            onViewportWidth={setBoardWidth}
          />
        </div>
      );
    }
  }

  return (
    <div className="app" data-sidebar={sidebarOpen ? 'open' : 'closed'}>
      <Toolbar
        data={data}
        window={boardWindow}
        onWindowChange={setWindow}
        query={query}
        onQueryChange={setQuery}
        searchRef={searchRef}
        fetchedAt={shownSyncedAt ?? fetchedAt}
        refreshing={refreshing}
        onRefresh={refresh}
        appearance={appearance}
        onAppearanceChange={setAppearance}
        sidebarOpen={sidebarOpen}
        compact={compact}
        onToggleSidebar={toggleSidebar}
        searchOpen={compact && searchOpen}
        onSearchOpenChange={setSearchOpen}
        shareLink={data ? shareLink : null}
      />
      <div className="app-body">
        {data && sidebarOpen && (
          <>
            {compact && (
              <button
                type="button"
                className="sidebar-scrim"
                aria-label={APP.sidebar.close}
                tabIndex={-1}
                onClick={() => setOverlayOpen(false)}
              />
            )}
            <Sidebar
              id="sidebar"
              data={data}
              view={view}
              checked={checkedGroups}
              onToggleGroup={toggleGroup}
              options={options}
              onOptionsChange={setOptions}
              overlay={compact}
              onClose={() => setOverlayOpen(false)}
              shareLink={shareLink}
            />
          </>
        )}
        <main className="app-main" aria-busy={loading || undefined}>
          {failure && (
            <ErrorBanner
              title={failure.title}
              message={failure.message}
              onRetry={() => void reload(data && scope.length > 0 ? scope : null)}
            />
          )}
          {loading && <Skeleton />}
          {data && view && activeLanes > 0 && <SummaryLine stats={view.stats} />}
          {data && (
            <div className="board-area" data-inspector={selected ? 'open' : undefined}>
              {board}
              {selected && boardWindow && (
                <Inspector
                  data={data}
                  itemId={selected}
                  lanes={lanes}
                  window={boardWindow}
                  onSelect={navigateTo}
                  onClose={() => setSelectedId(null)}
                />
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

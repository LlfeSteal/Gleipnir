import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { BoardData } from './api/types';
import type { BoardWindow, DisplayOptions, Lane } from './board/types';
import { DEFAULT_OPTIONS, LANE_COLORS } from './board/types';
import { defaultLanes, matchLane, refreshScope, scopeSyncedAt } from './board/lanes';
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
import { LaneSettingsSheet } from './components/LaneSettingsSheet';
import type { LaneSettingsFocus } from './components/LaneSettingsSheet';
import { APP } from './strings';

// ---------- Stored preferences, validated on read (anything else falls back to the default) ----------

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

function isLane(value: unknown): value is Lane {
  if (!value || typeof value !== 'object') return false;
  const lane = value as Record<string, unknown>;
  return (
    typeof lane.id === 'string' &&
    typeof lane.name === 'string' &&
    (LANE_COLORS as readonly unknown[]).includes(lane.color) &&
    isStringArray(lane.groups) &&
    typeof lane.includeSubgroups === 'boolean' &&
    typeof lane.showEpics === 'boolean' &&
    typeof lane.showIssues === 'boolean' &&
    isStringArray(lane.labels) &&
    (lane.labelMode === 'any' || lane.labelMode === 'all') &&
    typeof lane.active === 'boolean'
  );
}

/** null: nothing stored yet, the default lanes apply. */
const isStoredLanes = (value: unknown): value is Lane[] | null =>
  value === null || (Array.isArray(value) && value.every(isLane));

const isStoredWindow = (value: unknown): value is BoardWindow | null => {
  if (value === null) return true;
  if (!value || typeof value !== 'object') return false;
  const { from, to } = value as Record<string, unknown>;
  return Number.isInteger(from) && Number.isInteger(to) && (from as number) >= 0 && (from as number) <= (to as number);
};

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

/** Lanes keep only the groups that still exist under the root group. */
function withKnownGroups(lanes: Lane[], data: BoardData): Lane[] {
  const known = new Set(data.groups.map((group) => group.path));
  let changed = false;
  const next = lanes.map((lane) => {
    if (lane.groups.every((path) => known.has(path))) return lane;
    changed = true;
    return { ...lane, groups: lane.groups.filter((path) => known.has(path)) };
  });
  return changed ? next : lanes;
}

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

  // Remembered in the browser (spec §7).
  const [storedLanes, setStoredLanes] = useStoredState<Lane[] | null>('gleipnir.lanes', null, isStoredLanes);
  const [storedWindow, setStoredWindow] = useStoredState<BoardWindow | null>('gleipnir.window', null, isStoredWindow);
  const [sidebarCollapsed, setSidebarCollapsed] = useStoredState<boolean>('gleipnir.sidebar', false, isBoolean);
  // Session only.
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [options, setOptions] = useState<DisplayOptions>(DEFAULT_OPTIONS);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [revealId, setRevealId] = useState<string | null>(null);
  const [settings, setSettings] = useState<{ focus: LaneSettingsFocus } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // Typing stays smooth on a large board: the layout follows the query a bit later.
  const deferredQuery = useDeferredValue(query.trim());
  // Width of the board's scroll container, measured by the canvas; a resize relays out later
  // too, so dragging the window edge stays smooth on a large board.
  const [boardWidth, setBoardWidth] = useState(0);
  const deferredWidth = useDeferredValue(boardWidth);

  // The first time data arrives with nothing valid stored, the default lanes are kept, so
  // their ids (collapsed lanes, selection) stay stable across reloads.
  useEffect(() => {
    if (data && storedLanes === null) setStoredLanes(defaultLanes(data));
  }, [data, storedLanes, setStoredLanes]);
  const fallbackLanes = useMemo(() => (data ? defaultLanes(data) : []), [data]);
  const lanes = useMemo(
    () => (data ? withKnownGroups(storedLanes ?? fallbackLanes, data) : []),
    [data, storedLanes, fallbackLanes],
  );

  const iterationCount = data?.iterations.length ?? 0;
  const boardWindow = useMemo(
    () => (data && iterationCount > 0 ? clampWindow(storedWindow ?? defaultWindow(data), iterationCount) : null),
    [data, storedWindow, iterationCount],
  );
  const setWindow = useCallback((next: BoardWindow) => setStoredWindow(next), [setStoredWindow]);

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
        // Unplanned items live in their own column: show it, and open the lanes hiding the item.
        if (isUnplanned(entry) && !options.showUnplanned) setOptions((o) => ({ ...o, showUnplanned: true }));
        const hiding = lanes.filter(
          (lane) => lane.active && collapsed.has(lane.id) && matchLane(lane, entry.item, entry.kind),
        );
        if (hiding.length) {
          setCollapsed((current) => {
            const next = new Set(current);
            hiding.forEach((lane) => next.delete(lane.id));
            return next;
          });
        }
      }
      setSelectedId(id);
      setRevealId(id);
    },
    [data, boardWindow, iterationCount, setWindow, options.showUnplanned, lanes, collapsed],
  );

  const settingsOpen = settings !== null;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'f') {
        // ⌘F / Ctrl+F: the board's own search rather than the browser's.
        if (settingsOpen) return;
        event.preventDefault();
        // On a phone the field may be folded: unfolding it focuses it (see Toolbar).
        if (compact) setSearchOpen(true);
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (event.key !== 'Escape' || event.defaultPrevented || settingsOpen || ownsEscape(event.target)) return;
      if (overlayOpen && compact) setOverlayOpen(false);
      else setSelectedId(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [settingsOpen, overlayOpen, compact]);

  const setLanes = useCallback((next: Lane[]) => setStoredLanes(next), [setStoredLanes]);
  const toggleLaneActive = (laneId: string) =>
    setLanes(lanes.map((lane) => (lane.id === laneId ? { ...lane, active: !lane.active } : lane)));
  const toggleCollapsed = useCallback((laneId: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(laneId)) next.add(laneId);
      return next;
    });
  }, []);
  const openSettings = useCallback((focus: LaneSettingsFocus) => {
    setOverlayOpen(false);
    setSettings({ focus });
  }, []);
  const editLane = useCallback((laneId: string) => openSettings({ laneId }), [openSettings]);
  const onRevealed = useCallback(() => setRevealId(null), []);

  const sidebarOpen = compact ? overlayOpen : !sidebarCollapsed;
  const toggleSidebar = () => (compact ? setOverlayOpen((open) => !open) : setSidebarCollapsed(!sidebarCollapsed));

  const activeLanes = lanes.filter((lane) => lane.active).length;
  // Synchroniser only reads the groups the user looks at: the whole group is read in the
  // background by the backend, every CACHE_TTL.
  const scope = useMemo(() => refreshScope(lanes), [lanes]);
  const refresh = scope.length > 0 ? () => void reload(scope) : null;
  const shownSyncedAt = useMemo(() => (data ? scopeSyncedAt(data, lanes) : null), [data, lanes]);
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
            <button type="button" className="button" onClick={() => openSettings(null)}>
              {APP.states.configure}
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
            onEditLane={editLane}
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
              lanes={lanes}
              onToggleLane={toggleLaneActive}
              onEditLane={editLane}
              onNewLane={() => openSettings({ newLane: true })}
              onConfigure={() => openSettings(null)}
              options={options}
              onOptionsChange={setOptions}
              overlay={compact}
              onClose={() => setOverlayOpen(false)}
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
      {settings && data && (
        <LaneSettingsSheet
          data={data}
          lanes={lanes}
          focus={settings.focus}
          onApply={(next) => {
            setLanes(next);
            setSettings(null);
          }}
          onClose={() => setSettings(null)}
        />
      )}
    </div>
  );
}

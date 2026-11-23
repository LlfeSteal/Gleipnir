import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent, Ref } from 'react';
import type { BoardData } from '../api/types';
import type { BoardWindow } from '../board/types';
import type { Appearance } from '../hooks/useAppearance';
import { formatRelativeTime } from '../board/format';
import { AppGlyph, RefreshIcon, SearchIcon, SidebarIcon } from './ui/Icons';
import { SearchField } from './ui/SearchField';
import { AppearanceMenu } from './ui/AppearanceMenu';
import { WindowControl } from './WindowControl';
import { APP } from '../strings';

interface Props {
  data: BoardData | null;
  window: BoardWindow | null;
  onWindowChange: (next: BoardWindow) => void;
  query: string;
  onQueryChange: (query: string) => void;
  searchRef: Ref<HTMLInputElement>;
  fetchedAt: string | null;
  refreshing: boolean;
  /** Reads the groups of the active lanes again; null when there are none. */
  onRefresh: (() => void) | null;
  appearance: Appearance;
  onAppearanceChange: (appearance: Appearance) => void;
  sidebarOpen: boolean;
  /** ≤ 760 px: the sidebar is an overlay named "Filtres", the search collapses to a button. */
  compact: boolean;
  onToggleSidebar: () => void;
  /** Compact only: the search field replaces the first row (iOS). Ignored on wider screens. */
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
}

/** "Mis à jour il y a 3 min" stays true while the page stays open. */
function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** The sticky translucent bar: sidebar toggle and title, the iteration window in the middle,
 * search, sync and appearance on the right. On a phone, like an iOS navigation bar: the
 * Filtres button, the centered title and the actions on a first row, the window on a second;
 * the search is a button that unfolds a full-width field with "Annuler". */
export function Toolbar({
  data,
  window: win,
  onWindowChange,
  query,
  onQueryChange,
  searchRef,
  fetchedAt,
  refreshing,
  onRefresh,
  appearance,
  onAppearanceChange,
  sidebarOpen,
  compact,
  onToggleSidebar,
  searchOpen,
  onSearchOpenChange,
}: Props) {
  const now = useNow(30_000);
  const sidebarLabel = compact ? APP.toolbar.filters : sidebarOpen ? APP.toolbar.hideSidebar : APP.toolbar.showSidebar;
  const updated = refreshing
    ? APP.toolbar.syncing
    : fetchedAt
      ? APP.toolbar.updated(formatRelativeTime(fetchedAt, now))
      : '';

  // A typed query keeps the field unfolded: the board is filtered, the field says by what.
  const searchUnfolded = compact && (searchOpen || query !== '');
  const input = useRef<HTMLInputElement | null>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const setInput = (element: HTMLInputElement | null) => {
    input.current = element;
    if (typeof searchRef === 'function') searchRef(element);
    else if (searchRef) searchRef.current = element;
  };

  // Unfolding (the button, ⌘F) focuses the field; folding back from the keyboard returns the
  // focus to the button, so it never falls to <body>.
  const wasUnfolded = useRef(searchUnfolded);
  const refocusButton = useRef(false);
  useLayoutEffect(() => {
    if (searchUnfolded && !wasUnfolded.current) input.current?.focus();
    if (!searchUnfolded && wasUnfolded.current && refocusButton.current) searchButton.current?.focus();
    refocusButton.current = false;
    wasUnfolded.current = searchUnfolded;
  }, [searchUnfolded]);

  const fold = (restoreFocus: boolean) => {
    refocusButton.current = restoreFocus;
    onQueryChange('');
    onSearchOpenChange(false);
  };
  // Escape in an empty field folds it (with text, the field clears itself first).
  const onSearchKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !event.defaultPrevented && !query) {
      event.preventDefault();
      fold(true);
    }
  };
  // Leaving an empty field folds it, as on iOS; one with a query stays.
  const onSearchBlur = (event: FocusEvent<HTMLDivElement>) => {
    const to = event.relatedTarget as Node | null;
    if (!query && !(to && event.currentTarget.contains(to))) onSearchOpenChange(false);
  };

  const searchField = (
    <SearchField
      className="toolbar-search"
      value={query}
      onChange={onQueryChange}
      placeholder={APP.toolbar.searchPlaceholder}
      label={APP.toolbar.searchLabel}
      inputRef={setInput}
    />
  );

  // Empty before the board loads: then the compact bar keeps a single row.
  const center = data && win && (
    <div className="toolbar-center">
      <WindowControl data={data} window={win} onChange={onWindowChange} />
    </div>
  );

  return (
    <header className="toolbar" data-compact={compact || undefined} data-search={searchUnfolded ? 'open' : undefined}>
      {searchUnfolded ? (
        <>
          <div className="toolbar-search-row" onKeyDown={onSearchKeyDown} onBlur={onSearchBlur}>
            {searchField}
            <button type="button" className="button plain" onClick={() => fold(true)}>
              {APP.toolbar.cancelSearch}
            </button>
          </div>
          {center}
        </>
      ) : (
        <>
          <div className="toolbar-leading">
            <button
              type="button"
              className="button icon toolbar-sidebar"
              aria-label={sidebarLabel}
              title={sidebarLabel}
              aria-expanded={sidebarOpen}
              aria-controls="sidebar"
              onClick={onToggleSidebar}
            >
              <SidebarIcon size={16} />
            </button>
            <div className="app-icon" aria-hidden="true">
              <AppGlyph size={18} />
            </div>
            <div className="toolbar-title">
              <h1>{APP.title}</h1>
              {data && <div className="toolbar-subtitle">{APP.subtitle(data.rootGroup.name, data.cadence.title)}</div>}
            </div>
          </div>
          {center}
          <div className="toolbar-trailing">
            {/* Nothing to search before the board has loaded. */}
            {!data ? null : compact ? (
              <button
                ref={searchButton}
                type="button"
                className="button icon"
                aria-label={APP.toolbar.openSearch}
                title={APP.toolbar.openSearch}
                onClick={() => onSearchOpenChange(true)}
              >
                <SearchIcon size={15} />
              </button>
            ) : (
              searchField
            )}
            <span className="toolbar-updated" aria-live="polite">
              {updated}
            </span>
            <button
              type="button"
              className="button icon"
              aria-label={APP.toolbar.sync}
              title={
                !onRefresh
                  ? APP.toolbar.syncNothing
                  : updated
                    ? `${APP.toolbar.syncHelp} · ${updated}`
                    : APP.toolbar.syncHelp
              }
              disabled={refreshing || !onRefresh}
              onClick={onRefresh ?? undefined}
            >
              <RefreshIcon size={15} className={refreshing ? 'spin' : undefined} />
            </button>
            <AppearanceMenu appearance={appearance} onChange={onAppearanceChange} />
          </div>
        </>
      )}
    </header>
  );
}

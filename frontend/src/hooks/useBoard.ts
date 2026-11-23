import { useCallback, useEffect, useRef, useState } from 'react';
import type { BoardData } from '../api/types';
import { fetchBoard } from '../api/client';

/** Silent refresh period, and age after which coming back to the tab refreshes. The backend
 * cache (CACHE_TTL, 5 min by default) answers at once and revalidates in the background. */
const STALE_MS = 5 * 60_000;

export interface BoardState {
  data: BoardData | null;
  error: Error | null;
  /** First load: no data yet. */
  loading: boolean;
  /** A load the user asked for (Synchroniser, Réessayer) is running; the data stays shown. */
  refreshing: boolean;
  /** When the backend fetched the data from GitLab (RFC 3339), from X-Fetched-At. */
  fetchedAt: string | null;
  /** refresh: the backend syncs with GitLab again instead of answering from its cache. */
  reload: (refresh: boolean) => Promise<void>;
}

type Mode = 'user' | 'silent';

/** The board, loaded on mount, then silently every 5 minutes and when the window gets the
 * focus back after 5 minutes. One request at a time: a newer one aborts the older. A failed
 * reload keeps the last data (the error is shown above it). */
export function useBoard(): BoardState {
  const [data, setData] = useState<BoardData | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [pending, setPending] = useState<Mode | null>('user');
  const current = useRef<AbortController | null>(null);
  const loadedAt = useRef(0);

  const load = useCallback(async (refresh: boolean, mode: Mode) => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    setPending(mode);
    // A retry asked by the user shows its progress instead of the old error.
    if (mode === 'user') setError(null);
    try {
      const result = await fetchBoard(refresh, controller.signal);
      if (controller.signal.aborted) return;
      loadedAt.current = Date.now();
      setData(result.data);
      setFetchedAt(result.fetchedAt ?? result.data.syncedAt ?? null);
      setError(null);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (current.current === controller) {
        current.current = null;
        setPending(null);
      }
    }
  }, []);

  const reload = useCallback((refresh: boolean) => load(refresh, 'user'), [load]);

  useEffect(() => {
    void load(false, 'user');
    const refreshSilently = () => {
      if (!current.current) void load(false, 'silent');
    };
    const refreshIfStale = () => {
      if (Date.now() - loadedAt.current >= STALE_MS) refreshSilently();
    };
    const timer = window.setInterval(refreshSilently, STALE_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshIfStale();
    };
    window.addEventListener('focus', refreshIfStale);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshIfStale);
      document.removeEventListener('visibilitychange', onVisible);
      current.current?.abort();
      current.current = null;
    };
  }, [load]);

  return {
    data,
    error,
    loading: pending !== null && data === null,
    refreshing: pending === 'user' && data !== null,
    fetchedAt,
    reload,
  };
}

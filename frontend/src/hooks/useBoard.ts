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
  /** With groups, the backend reads their subtrees from GitLab again before answering (the
   * groups of the active lanes); with null, it answers from its cache. */
  reload: (refresh: readonly string[] | null) => Promise<void>;
}

type Mode = 'user' | 'silent';

/** The board with the active cadences (null: the backend's default, ADR-38), loaded on mount
 * and again when they change, then silently every 5 minutes and when the window gets the
 * focus back after 5 minutes. One request at a time: a newer one aborts the older. A failed
 * reload keeps the last data (the error is shown above it). */
export function useBoard(cadences: readonly string[] | null = null): BoardState {
  const [data, setData] = useState<BoardData | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [pending, setPending] = useState<Mode | null>('user');
  const current = useRef<AbortController | null>(null);
  const loadedAt = useRef(0);
  // Every load, silent or not, asks for the cadences of the latest render.
  const cadencesRef = useRef(cadences);
  useEffect(() => {
    cadencesRef.current = cadences;
  });
  const cadencesKey = cadences ? cadences.join(',') : '';

  const load = useCallback(async (refresh: readonly string[] | null, mode: Mode) => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    setPending(mode);
    // A retry asked by the user shows its progress instead of the old error.
    if (mode === 'user') setError(null);
    try {
      const result = await fetchBoard(refresh, cadencesRef.current, controller.signal);
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

  const reload = useCallback((refresh: readonly string[] | null) => load(refresh, 'user'), [load]);

  // On mount, and with other cadences: the data stays shown meanwhile.
  useEffect(() => {
    void load(null, 'user');
  }, [load, cadencesKey]);

  useEffect(() => {
    const refreshSilently = () => {
      if (!current.current) void load(null, 'silent');
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

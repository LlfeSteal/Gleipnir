// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useBoard } from './useBoard';
import { mockupBoard } from '../board/fixtures';

const ok = (fetchedAt = '2026-11-23T10:00:00Z') =>
  new Response(JSON.stringify(mockupBoard()), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'X-Fetched-At': fetchedAt },
  });
const unauthorized = () =>
  new Response(JSON.stringify({ error: 'nope', code: 'unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useBoard', () => {
  it('loads on mount', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok()));
    const { result } = renderHook(() => useBoard());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.fetchedAt).toBe('2026-11-23T10:00:00Z');
  });

  it('keeps the data while refreshing, and after a failed refresh', async () => {
    let resolve: (response: Response) => void = () => {};
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => ok())
      .mockImplementationOnce(() => new Promise<Response>((r) => (resolve = r)))
      .mockImplementationOnce(async () => unauthorized());
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useBoard());
    await waitFor(() => expect(result.current.data).not.toBeNull());
    const first = result.current.data;

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.reload(['plateforme/atlas/api', 'plateforme/atlas/data']);
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/board?refresh=1&groups=plateforme/atlas/api,plateforme/atlas/data',
      expect.anything(),
    );
    expect(result.current.refreshing).toBe(true);
    expect(result.current.data).toBe(first);
    await act(async () => {
      resolve(ok('2026-11-23T11:00:00Z'));
      await pending;
    });
    expect(result.current.refreshing).toBe(false);
    expect(result.current.fetchedAt).toBe('2026-11-23T11:00:00Z');

    await act(() => result.current.reload(null));
    expect(result.current.error).toMatchObject({ code: 'unauthorized' });
    expect(result.current.data).not.toBeNull();
  });

  it('aborts the request on unmount', async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        return new Promise<Response>(() => {});
      }),
    );
    const { unmount } = renderHook(() => useBoard());
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it('falls back to the board sync time without X-Fetched-At', async () => {
    const data = mockupBoard();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(data), { status: 200 })));
    const { result } = renderHook(() => useBoard());
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(result.current.fetchedAt).toBe(data.syncedAt);
  });

  it('wraps a failure that is not an Error', async () => {
    const notJson = { ok: true, status: 200, headers: new Headers(), json: () => Promise.reject('boom') };
    vi.stubGlobal('fetch', vi.fn(async () => notJson));
    const { result } = renderHook(() => useBoard());
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('boom');
    expect(result.current.loading).toBe(false);
  });

  it('a newer request aborts the older one, whose late answer is ignored', async () => {
    const resolvers: ((r: Response) => void)[] = [];
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        signals.push(init!.signal!);
        return new Promise<Response>((r) => resolvers.push(r));
      }),
    );
    const { result } = renderHook(() => useBoard());
    let second: Promise<void> = Promise.resolve();
    act(() => {
      second = result.current.reload(['g']);
    });
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    await act(async () => {
      resolvers[1](ok('2026-11-23T12:00:00Z'));
      await second;
    });
    expect(result.current.fetchedAt).toBe('2026-11-23T12:00:00Z');
    // The aborted request answering late changes nothing.
    await act(async () => resolvers[0](ok('2026-11-23T09:00:00Z')));
    expect(result.current.fetchedAt).toBe('2026-11-23T12:00:00Z');
    expect(result.current.loading).toBe(false);
    expect(result.current.refreshing).toBe(false);
  });

  it('an aborted request that fails sets no error', async () => {
    const rejecters: ((e: unknown) => void)[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((_resolve, reject) => rejecters.push(reject))),
    );
    const { result } = renderHook(() => useBoard());
    act(() => {
      void result.current.reload(null);
    });
    await act(async () => rejecters[0](new DOMException('aborted', 'AbortError')));
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(true); // the second request still runs
  });
});

describe('useBoard background refresh', () => {
  const MINUTE = 60_000;
  let now = Date.UTC(2026, 10, 23, 10, 0, 0);

  // Settles the pending fetch. Not with a waitFor: Testing Library's polls with the faked
  // setInterval, and vi.waitFor advances the fake clock on every poll.
  async function settle() {
    for (let i = 0; i < 5; i++) await act(async () => {});
  }

  async function mounted() {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const fetchMock = vi.fn(async () => ok());
    vi.stubGlobal('fetch', fetchMock);
    const view = renderHook(() => useBoard());
    await settle();
    expect(view.result.current.data).not.toBeNull();
    return { ...view, fetchMock };
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reloads silently every 5 minutes, from the cache', async () => {
    const { result, fetchMock } = await mounted();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(5 * MINUTE - 1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(1));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/board', expect.anything());
    // Silent: no spinner.
    expect(result.current.refreshing).toBe(false);
    await settle();
    expect(result.current.loading).toBe(false);
  });

  it('skips the silent reload while a request runs', async () => {
    const { result, fetchMock } = await mounted();
    fetchMock.mockImplementationOnce(() => new Promise<Response>(() => {}));
    act(() => {
      void result.current.reload(['g']);
    });
    act(() => vi.advanceTimersByTime(5 * MINUTE));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reloads on focus only when the data is 5 minutes old', async () => {
    const { fetchMock } = await mounted();
    now += 5 * MINUTE - 1;
    act(() => window.dispatchEvent(new Event('focus')));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    now += 1;
    act(() => window.dispatchEvent(new Event('focus')));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reloads when the tab becomes visible again with old data, not when it hides', async () => {
    const { fetchMock, unmount } = await mounted();
    now += 10 * MINUTE;
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    visibility.mockReturnValue('hidden');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue('visible');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Unmounted: no listener nor timer left behind.
    unmount();
    now += 10 * MINUTE;
    act(() => {
      window.dispatchEvent(new Event('focus'));
      vi.advanceTimersByTime(10 * MINUTE);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

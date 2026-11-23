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
      pending = result.current.reload(true);
    });
    expect(fetchMock).toHaveBeenLastCalledWith('/api/board?refresh=1', expect.anything());
    expect(result.current.refreshing).toBe(true);
    expect(result.current.data).toBe(first);
    await act(async () => {
      resolve(ok('2026-11-23T11:00:00Z'));
      await pending;
    });
    expect(result.current.refreshing).toBe(false);
    expect(result.current.fetchedAt).toBe('2026-11-23T11:00:00Z');

    await act(() => result.current.reload(false));
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
});

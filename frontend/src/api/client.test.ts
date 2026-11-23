import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, errorMessage, fetchBoard } from './client';
import { mockupBoard } from '../board/fixtures';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchBoard', () => {
  it('returns the board and X-Fetched-At, with ?refresh=1 on demand', async () => {
    const data = mockupBoard();
    const fetchMock = vi.fn(async () => json(data, 200, { 'X-Fetched-At': '2026-11-23T10:00:00Z' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchBoard(false);
    expect(result.data.epics).toHaveLength(data.epics.length);
    expect(result.fetchedAt).toBe('2026-11-23T10:00:00Z');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/board');

    await fetchBoard(true);
    expect(fetchMock.mock.calls[1][0]).toBe('/api/board?refresh=1');
  });

  it('maps the backend error codes', async () => {
    vi.stubGlobal('fetch', async () => json({ error: 'token rejected', code: 'unauthorized' }, 401));
    const err = await fetchBoard(false).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: 'unauthorized', status: 401, message: 'token rejected' });

    vi.stubGlobal('fetch', async () => json({ error: 'GitLab down', code: 'gitlab_unreachable' }, 502));
    await expect(fetchBoard(false)).rejects.toMatchObject({ code: 'gitlab_unreachable', status: 502 });
  });

  it('treats a proxy answer or no answer as the server being unreachable', async () => {
    vi.stubGlobal('fetch', async () => new Response('<html>Bad Gateway</html>', { status: 502 }));
    await expect(fetchBoard(false)).rejects.toMatchObject({ code: 'network', status: 502 });

    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(fetchBoard(false)).rejects.toMatchObject({ code: 'network' });

    vi.stubGlobal('fetch', async () => new Response('oops', { status: 500 }));
    await expect(fetchBoard(false)).rejects.toMatchObject({ code: 'internal', status: 500 });
  });

  it('lets an abort through untouched', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', async () => {
      controller.abort();
      throw new DOMException('aborted', 'AbortError');
    });
    const err = await fetchBoard(false, controller.signal).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(ApiError);
  });
});

describe('errorMessage', () => {
  it('explains each cause in French', () => {
    expect(errorMessage(new ApiError('x', 'unauthorized', 401)).message).toMatch(/GITLAB_TOKEN.*read_api/);
    expect(errorMessage(new ApiError('x', 'premium_required', 502)).message).toMatch(/Premium ou Ultimate/);
    expect(errorMessage(new ApiError('x', 'network', 504)).title).toBe('Serveur injoignable');
    expect(errorMessage(new ApiError('x', 'group_not_found', 404)).title).toBe('Groupe introuvable');
    expect(errorMessage(new ApiError('x', 'cadence_not_found', 502)).title).toBe('Cadence introuvable');
    expect(errorMessage(new ApiError('x', 'gitlab_unreachable', 502)).title).toBe('GitLab injoignable');
    expect(errorMessage(new ApiError('x', 'internal', 500)).title).toBe('Erreur du serveur');
    expect(errorMessage(new Error('boom')).message).toContain('boom');
  });
});

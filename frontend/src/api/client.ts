// Client of the Gleipnir backend: GET /api/board. No library: fetch is enough (as in Odin).

import type { ApiErrorBody, ApiErrorCode, BoardData } from './types';
import { APP } from '../strings';

const API_CODES: readonly ApiErrorCode[] = [
  'unauthorized',
  'group_not_found',
  'premium_required',
  'cadence_not_found',
  'gitlab_unreachable',
  'invalid_scope',
  'internal',
];

/** A failed request. `network`: no answer from the backend itself (offline, or the nginx
 * proxy answering 502–504 without the backend's JSON body). */
export class ApiError extends Error {
  readonly status?: number;
  readonly code: ApiErrorCode | 'network';

  constructor(message: string, code: ApiErrorCode | 'network', status?: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

function isApiCode(value: unknown): value is ApiErrorCode {
  return typeof value === 'string' && (API_CODES as readonly string[]).includes(value);
}

/** The board URL: the cached board, or, with refresh, after the backend has read the subtrees
 * of those groups again from GitLab. Paths keep their slashes; a comma separates them. With
 * cadences, those are the active ones (ADR-38); without, the backend's default. */
export function boardUrl(refresh: readonly string[] | null, cadences: readonly string[] | null = null): string {
  const params: string[] = [];
  if (refresh) {
    params.push('refresh=1', `groups=${refresh.map((path) => encodeURIComponent(path).replace(/%2F/gi, '/')).join(',')}`);
  }
  if (cadences && cadences.length > 0) {
    params.push(`cadences=${cadences.map((id) => encodeURIComponent(id)).join(',')}`);
  }
  return params.length > 0 ? `/api/board?${params.join('&')}` : '/api/board';
}

/** The board, and when the backend fetched it from GitLab (X-Fetched-At: it may answer from
 * its cache). With refresh, the backend first reads those groups again from GitLab. cadences
 * are the active cadences, null for the backend's default (ADR-38). */
export async function fetchBoard(
  refresh: readonly string[] | null,
  cadences: readonly string[] | null,
  signal?: AbortSignal,
): Promise<{ data: BoardData; fetchedAt: string | null }> {
  let response: Response;
  try {
    response = await fetch(boardUrl(refresh, cadences), {
      signal,
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    // An abort is the caller's doing, not a failure: let it through untouched.
    if (signal?.aborted) throw err;
    throw new ApiError(err instanceof Error ? err.message : String(err), 'network');
  }
  if (!response.ok) {
    let body: Partial<ApiErrorBody> | null = null;
    try {
      body = (await response.json()) as Partial<ApiErrorBody>;
    } catch {
      // Not the backend's JSON (a proxy page): handled below.
    }
    const status = response.status;
    const message = typeof body?.error === 'string' ? body.error : `HTTP ${status}`;
    const code = body?.code;
    if (isApiCode(code)) throw new ApiError(message, code, status);
    throw new ApiError(message, status === 502 || status === 503 || status === 504 ? 'network' : 'internal', status);
  }
  const data = (await response.json()) as BoardData;
  return { data, fetchedAt: response.headers.get('X-Fetched-At') };
}

/** A French title and explanation for a failed load, by cause. Plain text only. */
export function errorMessage(err: unknown): { title: string; message: string } {
  if (err instanceof ApiError) {
    const text = APP.errors[err.code];
    if (err.code === 'internal' && err.status && err.status !== 500) {
      return { title: text.title, message: `${text.message} (HTTP ${err.status})` };
    }
    return { title: text.title, message: text.message };
  }
  const detail = err instanceof Error && err.message ? ` (${err.message})` : '';
  return { title: APP.errors.unknown.title, message: `${APP.errors.unknown.message}${detail}` };
}

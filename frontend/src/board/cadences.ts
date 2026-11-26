// The active cadences: their iterations make the columns (ADR-38). The backend decides which
// are active, from the ones asked for or its default; the frontend only asks.

import type { BoardData } from '../api/types';

/** IDs of the active cadences, in the board's order (by title). */
export function activeCadenceIds(data: BoardData): string[] {
  return data.cadences.filter((c) => c.active).map((c) => c.id);
}

/** Titles of the active cadences, in the board's order. */
export function activeCadenceTitles(data: BoardData): string[] {
  return data.cadences.filter((c) => c.active).map((c) => c.title);
}

/** The active cadences once id is toggled; unchanged when that would leave none active, or
 * when id is not a cadence of the board. */
export function toggleCadence(data: BoardData, id: string): string[] {
  const current = activeCadenceIds(data);
  if (!data.cadences.some((c) => c.id === id)) return current;
  const next = data.cadences.filter((c) => (c.id === id ? !c.active : c.active)).map((c) => c.id);
  return next.length > 0 ? next : current;
}

/** gleipnir.cadences as read from the browser: a non-empty list of IDs, or null (the
 * backend's default). Unknown IDs are kept: the backend ignores them. */
export function isStoredCadences(value: unknown): value is string[] | null {
  return (
    value === null ||
    (Array.isArray(value) && value.length > 0 && value.every((id) => typeof id === 'string' && id !== ''))
  );
}

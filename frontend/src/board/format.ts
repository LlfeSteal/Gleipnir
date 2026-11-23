// French formatting of iterations, periods and sync times (Intl fr-FR).

import type { BoardData, Iteration } from '../api/types';
import { BOARD } from '../strings/board';

/** "It. 15" when the title ends with a number ("Itération 15", "Sprint 15"), else the title. */
export function shortIterationLabel(it: Iteration): string {
  const m = /(\d+)\s*$/.exec(it.title);
  return m ? BOARD.iterationShort(m[1]) : it.title;
}

// Dates are calendar days (YYYY-MM-DD): read and printed in UTC so the local time zone can't
// move them by a day.
function parseDay(day: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
}

const dayMonth = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const dayMonthYear = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const dayOnly = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', timeZone: 'UTC' });

/** "18 nov. – 1 déc.", "7 – 20 oct." within a month, "29 déc. 2026 – 11 janv. 2027" across years. */
export function formatIterationDates(it: Iteration): string {
  const start = parseDay(it.startDate);
  const end = parseDay(it.dueDate);
  if (!start || !end) return '';
  if (start.getUTCFullYear() !== end.getUTCFullYear()) {
    return BOARD.dateRange(dayMonthYear.format(start), dayMonthYear.format(end));
  }
  if (start.getUTCMonth() === end.getUTCMonth()) {
    return BOARD.dateRange(dayOnly.format(start), dayMonth.format(end));
  }
  return BOARD.dateRange(dayMonth.format(start), dayMonth.format(end));
}

function iterationLabel(data: BoardData, index: number): string {
  const it = data.iterations[index];
  return it ? shortIterationLabel(it) : BOARD.iterationShort(String(index + 1));
}

/** "It. 13 → It. 16", or "It. 13" for a single iteration. */
export function formatPeriod(data: BoardData, start: number, end: number): string {
  if (start === end) return iterationLabel(data, start);
  return `${iterationLabel(data, start)}${BOARD.periodArrow}${iterationLabel(data, end)}`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "à l'instant", "il y a 3 min", "il y a 2 h", "hier", "il y a 4 jours", then "le 18 nov.". */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = now.getTime() - t;
  if (diff < MINUTE) return BOARD.justNow;
  if (diff < HOUR) return BOARD.minutesAgo(Math.floor(diff / MINUTE));
  if (diff < DAY) return BOARD.hoursAgo(Math.floor(diff / HOUR));
  if (diff < 2 * DAY) return BOARD.yesterday;
  if (diff < 7 * DAY) return BOARD.daysAgo(Math.floor(diff / DAY));
  const date = new Date(t);
  const sameYear = date.getFullYear() === now.getFullYear();
  const fmt = new Intl.DateTimeFormat('fr-FR', sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
  return BOARD.onDate(fmt.format(date));
}

import { describe, expect, it } from 'vitest';
import type { Iteration } from '../api/types';
import { mockupBoard } from './fixtures';
import { formatIterationDates, formatPeriod, formatRelativeTime, shortIterationLabel } from './format';

const it_ = (title: string, startDate = '2026-11-18', dueDate = '2026-12-01'): Iteration => ({
  id: 'i',
  title,
  startDate,
  dueDate,
  webUrl: '',
  current: false,
});

describe('shortIterationLabel', () => {
  it('shortens titles ending with a number', () => {
    expect(shortIterationLabel(it_('Itération 15'))).toBe('It. 15');
    expect(shortIterationLabel(it_('Sprint 7 '))).toBe('It. 7');
    expect(shortIterationLabel(it_('Lancement'))).toBe('Lancement');
  });
});

describe('formatIterationDates', () => {
  it('formats in French', () => {
    expect(formatIterationDates(it_('x', '2026-11-18', '2026-12-01'))).toBe('18 nov. – 1 déc.');
    expect(formatIterationDates(it_('x', '2027-01-20', '2027-02-02'))).toBe('20 janv. – 2 févr.');
  });
  it('drops the repeated month', () => {
    expect(formatIterationDates(it_('x', '2026-10-07', '2026-10-20'))).toBe('7 – 20 oct.');
  });
  it('shows the year when it changes', () => {
    expect(formatIterationDates(it_('x', '2026-12-30', '2027-01-12'))).toBe('30 déc. 2026 – 12 janv. 2027');
  });
  it('is empty for invalid dates', () => {
    expect(formatIterationDates(it_('x', '', ''))).toBe('');
  });
});

describe('formatPeriod', () => {
  const data = mockupBoard();
  it('joins start and end', () => {
    expect(formatPeriod(data, 1, 4)).toBe('It. 13 → It. 16');
    expect(formatPeriod(data, 1, 1)).toBe('It. 13');
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-11-23T12:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  it('counts minutes, hours and days', () => {
    expect(formatRelativeTime(ago(10_000), now)).toBe("à l'instant");
    expect(formatRelativeTime(ago(-60_000), now)).toBe("à l'instant");
    expect(formatRelativeTime(ago(3 * 60_000), now)).toBe('il y a 3 min');
    expect(formatRelativeTime(ago(2 * 3_600_000 + 5), now)).toBe('il y a 2 h');
    expect(formatRelativeTime(ago(30 * 3_600_000), now)).toBe('hier');
    expect(formatRelativeTime(ago(4 * 86_400_000), now)).toBe('il y a 4 jours');
  });
  it('falls back to the date', () => {
    expect(formatRelativeTime('2026-11-03T12:00:00Z', now)).toBe('le 3 nov.');
    expect(formatRelativeTime('2025-11-03T12:00:00Z', now)).toBe('le 3 nov. 2025');
    expect(formatRelativeTime('garbage', now)).toBe('');
  });
});

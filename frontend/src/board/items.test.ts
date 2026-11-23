import { describe, expect, it } from 'vitest';
import type { BoardData, Epic, Issue } from '../api/types';
import { mockupBoard, epicId, issueId } from './fixtures';
import { findItem, isEpicUnplanned, isIssueUnplanned, isUnplanned, itemIndex, labelColors, refsOf } from './items';

const epic = (over: Partial<Epic> = {}): Epic => ({ ...mockupBoard().epics[0], ...over });
const issue = (over: Partial<Issue> = {}): Issue => ({ ...mockupBoard().issues[0], ...over });

describe('itemIndex', () => {
  it('indexes every epic and issue by id', () => {
    const data = mockupBoard();
    const index = itemIndex(data);
    expect(index.size).toBe(data.epics.length + data.issues.length);
    expect(index.get(epicId(12))?.kind).toBe('epic');
    expect(index.get(issueId(110))?.kind).toBe('issue');
  });

  it('is cached per BoardData object', () => {
    const data = mockupBoard();
    expect(itemIndex(data)).toBe(itemIndex(data));
    expect(itemIndex(mockupBoard())).not.toBe(itemIndex(data));
  });

  it('is empty for an empty board', () => {
    expect(itemIndex({ ...mockupBoard(), epics: [], issues: [] }).size).toBe(0);
  });
});

describe('findItem', () => {
  it('finds an item, or null for an unknown id', () => {
    const data = mockupBoard();
    expect(findItem(data, epicId(12))?.item.ref).toBe('&12');
    expect(findItem(data, 'gid://gitlab/WorkItem/0')).toBeNull();
    expect(findItem(data, '')).toBeNull();
  });
});

describe('unplanned', () => {
  it.each([
    ['planned', { unplanned: false, start: 1, end: 2 }, false],
    ['flagged unplanned', { unplanned: true, start: 1, end: 2 }, true],
    ['no start', { unplanned: false, start: null, end: 2 }, true],
    ['no end', { unplanned: false, start: 1, end: null }, true],
    ['starts at iteration 0', { unplanned: false, start: 0, end: 0 }, false],
  ] as const)('epic %s', (_name, over, want) => {
    expect(isEpicUnplanned(epic(over))).toBe(want);
    expect(isUnplanned({ kind: 'epic', item: epic(over) })).toBe(want);
  });

  it.each([
    ['planned', { unplanned: false, iteration: 3 }, false],
    ['in iteration 0', { unplanned: false, iteration: 0 }, false],
    ['flagged unplanned', { unplanned: true, iteration: 3 }, true],
    ['without iteration', { unplanned: false, iteration: null }, true],
  ] as const)('issue %s', (_name, over, want) => {
    expect(isIssueUnplanned(issue(over))).toBe(want);
    expect(isUnplanned({ kind: 'issue', item: issue(over) })).toBe(want);
  });
});

describe('labelColors', () => {
  it('maps titles to colors, cached per BoardData', () => {
    const data = mockupBoard();
    const colors = labelColors(data);
    expect(colors.get('bug')).toBe('#e0532f');
    expect(colors.get('nope')).toBeUndefined();
    expect(labelColors(data)).toBe(colors);
  });

  it('keeps the last color of a repeated title', () => {
    const data: BoardData = { ...mockupBoard(), labels: [{ title: 'x', color: '#000' }, { title: 'x', color: '#fff' }] };
    expect(labelColors(data).get('x')).toBe('#fff');
  });
});

describe('refsOf', () => {
  it('maps ids to refs in order, leaving unknown ids out', () => {
    const data = mockupBoard();
    expect(refsOf(data, [issueId(110), 'unknown', epicId(12)])).toEqual(['#110', '&12']);
    expect(refsOf(data, [])).toEqual([]);
    expect(refsOf(data, ['unknown'])).toEqual([]);
  });
});

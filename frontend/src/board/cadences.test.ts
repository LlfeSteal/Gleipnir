import { describe, expect, it } from 'vitest';
import type { BoardData } from '../api/types';
import { mockupBoard } from './fixtures';
import { activeCadenceIds, activeCadenceTitles, isStoredCadences, toggleCadence } from './cadences';

const A = 'gid://gitlab/Iterations::Cadence/1';
const B = 'gid://gitlab/Iterations::Cadence/2';
const C = 'gid://gitlab/Iterations::Cadence/3';

function withCadences(active: string[]): BoardData {
  return {
    ...mockupBoard(),
    cadences: [
      { id: A, title: 'Sprints produit', active: active.includes(A) },
      { id: B, title: 'Squad data', active: active.includes(B) },
      { id: C, title: 'Squad mobile', active: active.includes(C) },
    ],
  };
}

describe('active cadences (ADR-38)', () => {
  it('lists the active ones in the board order', () => {
    const data = withCadences([C, A]);
    expect(activeCadenceIds(data)).toEqual([A, C]);
    expect(activeCadenceTitles(data)).toEqual(['Sprints produit', 'Squad mobile']);
    expect(activeCadenceIds({ ...data, cadences: [] })).toEqual([]);
  });

  it('toggles one on or off, never the last one off', () => {
    expect(toggleCadence(withCadences([A]), B)).toEqual([A, B]);
    expect(toggleCadence(withCadences([A, B]), A)).toEqual([B]);
    expect(toggleCadence(withCadences([B]), B)).toEqual([B]);
    expect(toggleCadence(withCadences([A]), 'gid://gitlab/Iterations::Cadence/9')).toEqual([A]);
  });

  it('reads gleipnir.cadences: a non-empty list of IDs, or null', () => {
    expect(isStoredCadences(null)).toBe(true);
    expect(isStoredCadences([A, B])).toBe(true);
    // Unknown IDs are kept: the backend ignores them.
    expect(isStoredCadences(['gid://gitlab/Iterations::Cadence/9'])).toBe(true);
    for (const bad of [[], [''], [A, 3], 'gid', { from: A }, 42, undefined]) {
      expect(isStoredCadences(bad)).toBe(false);
    }
  });
});

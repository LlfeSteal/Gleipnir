// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStoredState } from './usePreferences';

afterEach(() => vi.restoreAllMocks());

type Win = { start: number; end: number };
const isWin = (v: unknown): v is Win =>
  typeof v === 'object' && v !== null && typeof (v as Win).start === 'number' && typeof (v as Win).end === 'number';

describe('useStoredState', () => {
  it('starts from the initial value, then persists every change as JSON', () => {
    const { result } = renderHook(() => useStoredState<Win>('gleipnir.window', { start: 0, end: 4 }, isWin));
    expect(result.current[0]).toEqual({ start: 0, end: 4 });
    act(() => result.current[1]({ start: 2, end: 6 }));
    expect(result.current[0]).toEqual({ start: 2, end: 6 });
    expect(JSON.parse(localStorage.getItem('gleipnir.window')!)).toEqual({ start: 2, end: 6 });

    const again = renderHook(() => useStoredState<Win>('gleipnir.window', { start: 0, end: 4 }, isWin));
    expect(again.result.current[0]).toEqual({ start: 2, end: 6 });
  });

  it('takes functional updates that compose, with a stable setter', () => {
    const { result, rerender } = renderHook(() => useStoredState('gleipnir.count', () => 1, (v): v is number => typeof v === 'number'));
    const setter = result.current[1];
    act(() => {
      setter((n) => n + 1);
      setter((n) => n * 10);
    });
    expect(result.current[0]).toBe(20);
    expect(localStorage.getItem('gleipnir.count')).toBe('20');
    rerender();
    expect(result.current[1]).toBe(setter);
  });

  it('ignores a stored value that is invalid or not JSON', () => {
    localStorage.setItem('gleipnir.window', JSON.stringify({ start: 'a' }));
    expect(renderHook(() => useStoredState<Win>('gleipnir.window', { start: 0, end: 4 }, isWin)).result.current[0]).toEqual({ start: 0, end: 4 });
    localStorage.setItem('gleipnir.window', '{oops');
    expect(renderHook(() => useStoredState<Win>('gleipnir.window', { start: 1, end: 2 }, isWin)).result.current[0]).toEqual({ start: 1, end: 2 });
  });

  it('still works for the session when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { result } = renderHook(() => useStoredState('gleipnir.sidebar', true, (v): v is boolean => typeof v === 'boolean'));
    expect(result.current[0]).toBe(true);
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
  });
});

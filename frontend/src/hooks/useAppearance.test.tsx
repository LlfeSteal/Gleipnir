// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mediaListeners, setSystemDark } from '../test/media';
import { APPEARANCE_KEY, loadAppearance, resolveScheme, useAppearance } from './useAppearance';

afterEach(() => vi.restoreAllMocks());

describe('loadAppearance', () => {
  it('reads the stored choice under the key of index.html, Automatic otherwise', () => {
    expect(APPEARANCE_KEY).toBe('gleipnir.appearance');
    expect(loadAppearance()).toBe('system');
    localStorage.setItem(APPEARANCE_KEY, 'dark');
    expect(loadAppearance()).toBe('dark');
    localStorage.setItem(APPEARANCE_KEY, 'sepia');
    expect(loadAppearance()).toBe('system');
  });

  it('falls back to Automatic without storage, and still applies a choice', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadAppearance()).toBe('system');
    const { result } = renderHook(() => useAppearance());
    act(() => result.current.setAppearance('dark'));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

describe('useAppearance', () => {
  it('follows the system in Automatic only', () => {
    expect(resolveScheme('light')).toBe('light');
    const { result, unmount } = renderHook(() => useAppearance());
    expect(result.current.appearance).toBe('system');
    expect(document.documentElement.dataset.theme).toBe('light');
    act(() => setSystemDark(true));
    expect(result.current.scheme).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');

    act(() => result.current.setAppearance('light'));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(mediaListeners()).toBe(0);
    expect(localStorage.getItem(APPEARANCE_KEY)).toBe('light');
    unmount();
  });
});

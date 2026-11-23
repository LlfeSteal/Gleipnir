import { useCallback, useRef, useState } from 'react';

// User preferences remembered in localStorage as JSON. Storage may be unavailable (private
// mode, blocked site data) or hold anything (an older version of the app, a hand edit): every
// access is guarded and every value read is validated, falling back to the initial value.

/** The value stored under `key` when it is valid JSON accepted by `validate`, else undefined. */
export function loadStored<T>(key: string, validate: (value: unknown) => value is T): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return undefined;
    const value: unknown = JSON.parse(raw);
    return validate(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Stores `value` as JSON under `key`; quietly does nothing when storage is unavailable. */
export function saveStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not remembered, but still applied for this session.
  }
}

/**
 * Like useState, remembered in localStorage under `key` (read once, on mount). The setter is
 * stable and accepts functional updates; T must not itself be a function.
 */
export function useStoredState<T>(
  key: string,
  initial: T | (() => T),
  validate: (value: unknown) => value is T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    const stored = loadStored(key, validate);
    if (stored !== undefined) return stored;
    return typeof initial === 'function' ? (initial as () => T)() : initial;
  });
  // The latest value, so consecutive functional updates in one event compose, and the setter
  // can persist outside of a state updater (which React may call twice).
  const current = useRef(value);
  current.current = value;

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      const resolved = typeof next === 'function' ? (next as (prev: T) => T)(current.current) : next;
      current.current = resolved;
      saveStored(key, resolved);
      setValue(resolved);
    },
    [key],
  );
  return [value, update];
}

// jsdom has no matchMedia: a stand-in whose "prefers-color-scheme: dark" answer the tests set
// (setSystemDark), notifying the listeners like a system appearance change.

type Listener = (event: MediaQueryListEvent) => void;

let dark = false;
const listeners = new Set<Listener>();

export function installMatchMedia() {
  dark = false;
  listeners.clear();
  window.matchMedia = (query: string) =>
    ({
      get matches() {
        return query.includes('dark') ? dark : false;
      },
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
      removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
      addListener: (listener: Listener) => listeners.add(listener),
      removeListener: (listener: Listener) => listeners.delete(listener),
      dispatchEvent: () => true,
    }) as unknown as MediaQueryList;
}

/** Switches the system appearance, as the user would in the OS settings. */
export function setSystemDark(value: boolean) {
  dark = value;
  listeners.forEach((listener) => listener({ matches: value } as MediaQueryListEvent));
}

/** How many components listen to the system appearance. */
export function mediaListeners(): number {
  return listeners.size;
}

import { afterEach, beforeEach } from 'vitest';
import { installMatchMedia } from './media';

// Component tests (*.test.tsx, `// @vitest-environment jsdom`) run in jsdom; the logic tests
// (*.test.ts) in node, without any of this.
if (typeof window !== 'undefined') {
  await import('@testing-library/jest-dom/vitest');
  const { cleanup } = await import('@testing-library/react');

  // Node 22+ has its own Web Storage globals (undefined without --localstorage-file), which
  // hide jsdom's: put jsdom's back.
  const dom = (globalThis as unknown as { jsdom?: { window: Window } }).jsdom;
  for (const key of ['localStorage', 'sessionStorage'] as const) {
    if (dom) Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true });
  }

  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  window.ResizeObserver ??= ResizeObserverStub;
  Element.prototype.scrollTo ??= function () {};
  Element.prototype.scrollIntoView ??= function () {};
  // jsdom has no <dialog> methods.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };

  beforeEach(() => installMatchMedia());
  afterEach(() => {
    cleanup();
    localStorage.clear();
    sessionStorage.clear();
    // The app writes its view in the URL (ADR-31): each test starts from a plain one.
    window.history.replaceState(null, '', '/');
  });
}

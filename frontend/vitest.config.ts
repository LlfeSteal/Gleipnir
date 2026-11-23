import { defineConfig } from 'vitest/config';

// Unit tests of the pure logic (src/**/*.test.ts, in node) and component tests
// (src/**/*.test.tsx, which start with a `// @vitest-environment jsdom` comment).
// e2e/*.spec.ts belong to Playwright.
export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
  },
});

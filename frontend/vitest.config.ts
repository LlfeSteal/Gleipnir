import { defineConfig } from 'vitest/config';

// Unit tests of the pure logic (src/**/*.test.ts, in node) and component tests
// (src/**/*.test.tsx, which start with a `// @vitest-environment jsdom` comment).
// e2e/*.spec.ts belong to Playwright.
export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    // npm run test:coverage (ADR-23): fails below 90 % of lines or functions.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/board/fixtures.ts', 'src/**/types.ts', 'src/main.tsx'],
      thresholds: { lines: 90, functions: 90 },
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
    },
  },
});

import { defineConfig, devices } from '@playwright/test';

// End-to-end tests. By default Playwright starts the Go backend in demo mode (sample data,
// no GitLab) on port 8081 and the Vite dev server on 5174, proxying /api to it.
// reuseExistingServer: a stack already running on those ports is reused (outside CI).
//   npm run test:e2e        everything but @live
//   npm run test:e2e:live   @live only, against a running stack on a real GitLab:
//                           BASE_URL=http://localhost npm run test:e2e:live
// E2E_API_PORT / E2E_WEB_PORT move the demo stack, so that two runs can go side by side.
// Only `--grep @live` is a live run: `--grep-invert @live` also puts "@live" in argv.
const live = process.argv.includes('--grep') && process.argv.includes('@live');
const apiPort = process.env.E2E_API_PORT ?? '8081';
const webPort = process.env.E2E_WEB_PORT ?? '5174';
const baseURL = process.env.BASE_URL ?? `http://localhost:${webPort}`;

export default defineConfig({
  testDir: './e2e',
  // One results folder per stack: two parallel runs would otherwise delete each other's files.
  outputDir: webPort === '5174' ? 'test-results' : `test-results/${webPort}`,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL, trace: 'retain-on-failure', locale: 'fr-FR', timezoneId: 'Europe/Paris' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer:
    live || process.env.BASE_URL
      ? undefined
      : [
          {
            command: 'go run ./cmd/server',
            cwd: '../backend',
            env: { GLEIPNIR_DEMO: '1', PORT: apiPort },
            url: `http://localhost:${apiPort}/api/health`,
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
          },
          {
            command: `npm run dev -- --port ${webPort} --strictPort`,
            env: { GLEIPNIR_API_URL: `http://localhost:${apiPort}` },
            url: `http://localhost:${webPort}`,
            reuseExistingServer: !process.env.CI,
            timeout: 60_000,
          },
        ],
});

import { defineConfig, devices } from '@playwright/test';

// End-to-end tests. By default Playwright starts the fake GitLab (../gitlab-mock, sample data)
// on port 8082, the real Go backend reading it on 8081, and the Vite dev server on 5174,
// proxying /api to the backend. reuseExistingServer: a stack already running on those ports
// is reused (outside CI).
//   npm run test:e2e        everything but @live
//   npm run test:e2e:live   @live only, against a running stack on a real GitLab:
//                           BASE_URL=http://localhost npm run test:e2e:live
// E2E_MOCK_PORT / E2E_API_PORT / E2E_WEB_PORT move the demo stack, so that two runs can go
// side by side.
// The demo suites also run on a real GitLab filled by gitlab-mock/cmd/seed: BASE_URL pointing
// at a stack whose GITLAB_GROUP is the seeded group.
// Only `--grep @live` is a live run: `--grep-invert @live` also puts "@live" in argv.
const live = process.argv.includes('--grep') && process.argv.includes('@live');
const mockPort = process.env.E2E_MOCK_PORT ?? '8082';
// The fake GitLab answers 401 to any other token, as GitLab does.
const demoToken = 'DEMO-JETON-TEST';
// E2E_GITLAB_LIKE=1: the fake GitLab numbers the items as a GitLab filled by the seeder would
// ("&1" in every group) under another root, to check that the suite holds on a real GitLab.
const gitlabLike = process.env.E2E_GITLAB_LIKE === '1';
const demoGroup = gitlabLike ? 'demo/gleipnir' : 'plateforme/atlas';
const apiPort = process.env.E2E_API_PORT ?? '8081';
const webPort = process.env.E2E_WEB_PORT ?? '5174';
const baseURL = process.env.BASE_URL ?? `http://localhost:${webPort}`;

export default defineConfig({
  testDir: './e2e',
  // The demo suites read the served board first (references, iterations, paths): the same
  // tests then run on the fake GitLab or on a real one filled by gitlab-mock/cmd/seed.
  globalSetup: live ? undefined : './e2e/global-setup.ts',
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
            command: 'go run .',
            cwd: '../gitlab-mock',
            env: {
              PORT: mockPort,
              GITLAB_MOCK_TOKEN: demoToken,
              GITLAB_MOCK_ROOT: demoGroup,
              GITLAB_MOCK_ROOT_NAME: gitlabLike ? 'Gleipnir' : '',
              GITLAB_MOCK_NUMBERING: gitlabLike ? 'gitlab' : 'mockup',
              TZ: 'Europe/Paris',
            },
            url: `http://localhost:${mockPort}/-/health`,
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
          },
          {
            command: 'go run ./cmd/server',
            cwd: '../backend',
            // GITLAB_TOKEN is the demo one: a token exported in the shell never reaches the fake.
            env: {
              GITLAB_URL: `http://localhost:${mockPort}`,
              GITLAB_GROUP: demoGroup,
              GITLAB_CADENCE: '',
              GITLAB_TOKEN: demoToken,
              PORT: apiPort,
              TZ: 'Europe/Paris',
            },
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

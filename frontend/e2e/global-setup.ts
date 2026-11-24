import type { FullConfig } from '@playwright/test';
import type { BoardData } from '../src/api/types';
import { BOARD_ENV } from './demo';

// Reads the served board once and hands it to the workers (process.env is inherited). The
// tests assume the dataset's calendar: "Itération 15" (index 3) is the current one. On a real
// GitLab filled by the seeder, that holds for the two weeks after a run: rerun it to move the
// dates (it is idempotent).
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) throw new Error('no baseURL in playwright.config.ts');
  // The backend may still be syncing: /api/board waits for the first sync.
  let lastError = '';
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch(new URL('/api/board', baseURL));
      if (response.ok) {
        const board = (await response.json()) as BoardData;
        if (board.current !== 3) {
          throw new Error(
            `the current iteration is index ${board.current}, the tests expect 3 ("Itération 15"): ` +
              'on a seeded GitLab, rerun gitlab-mock/cmd/seed -apply to move the dates around today',
          );
        }
        process.env[BOARD_ENV] = JSON.stringify(board);
        return;
      }
      lastError = `HTTP ${response.status}: ${await response.text()}`;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('the current iteration')) throw error;
      lastError = String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`GET ${baseURL}/api/board failed: ${lastError}`);
}

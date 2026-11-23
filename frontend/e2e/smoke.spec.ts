import { expect, test } from '@playwright/test';

// The board loads from the demo backend: toolbar, current iteration and the default lanes.
test('the board loads the demo data', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dépendances' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Epic &18/ }).first()).toBeVisible();
});

import { expect, test } from '@playwright/test';
import { expectWindow, item, openBoard, openWindowMenu } from './helpers';
import { board, cadence, cadenceTitles, it, itTitle, root } from './demo';

// The active cadences (ADR-38). Demo: « Sprints produit » (root group, Itération 12 … 21) and
// « Squad data » (data subgroup, the dates of Itération 13 … 18, its own titles). Today holds
// an iteration of each, so both are active by default and their iterations merge into the
// root's columns.

test.beforeEach(async ({ page }) => {
  // A reload and a dozen pop-up clicks: slow when both suites run side by side.
  test.slow();
  await openBoard(page);
});

test('both cadences are active by default, their iterations merged into ten columns', async ({ page }) => {
  const [produit, data] = cadenceTitles();
  expect(board().cadences.every((c) => c.active)).toBe(true);
  await expect(page.getByText(`${root().name} · ${cadence()}`, { exact: true })).toBeVisible();
  expect(cadence()).toBe(`${produit}, ${data}`);

  const menu = await openWindowMenu(page);
  const cadences = menu.getByRole('group', { name: 'Cadences' });
  await expect(cadences.getByRole('menuitemcheckbox')).toHaveCount(2);
  for (const name of [produit, data]) {
    await expect(cadences.getByRole('menuitemcheckbox', { name })).toHaveAttribute('aria-checked', 'true');
  }
  await expect(menu.getByRole('group', { name: 'Début' }).getByRole('menuitemradio')).toHaveCount(10);
  // The team's issue, planned in its own cadence, sits in a column of the board.
  await expect(item(page, '#131')).toBeVisible();
});

test('unchecking a cadence keeps the other one’s columns, and the choice is remembered', async ({ page }) => {
  const [produit, data] = cadenceTitles();
  const menu = await openWindowMenu(page);
  const cadences = menu.getByRole('group', { name: 'Cadences' });
  const start = menu.getByRole('group', { name: 'Début' });

  await cadences.getByRole('menuitemcheckbox', { name: produit }).click();
  // The pop-up stays open; the board now has the team's six iterations only.
  await expect(cadences.getByRole('menuitemcheckbox', { name: produit })).toHaveAttribute('aria-checked', 'false');
  await expect(start.getByRole('menuitemradio')).toHaveCount(6);
  await expect(start.getByRole('menuitemradio', { name: new RegExp(`^${it(12).replace('.', '\\.')}(\\D|$)`) })).toHaveCount(0);
  // The last active cadence cannot be unchecked.
  await expect(cadences.getByRole('menuitemcheckbox', { name: data })).toBeDisabled();
  await expect(page.getByText(`${root().name} · ${data}`, { exact: true })).toBeVisible();
  // An issue of the root cadence goes to the team's column of the same dates (ADR-38).
  await expect(item(page, '#104')).toBeVisible();
  await page.keyboard.press('Escape');

  // Remembered in the browser (ADR-36).
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('gleipnir.cadences') ?? 'null'))).toEqual(
    board()
      .cadences.filter((c) => c.title === data)
      .map((c) => c.id),
  );
  await page.reload();
  await expect(page.getByText(`${root().name} · ${data}`, { exact: true })).toBeVisible();

  // Checked again: the ten columns are back, the window around the current iteration.
  const again = await openWindowMenu(page);
  await again.getByRole('group', { name: 'Cadences' }).getByRole('menuitemcheckbox', { name: produit }).click();
  await expect(again.getByRole('group', { name: 'Début' }).getByRole('menuitemradio')).toHaveCount(10);
  await page.keyboard.press('Escape');
  await expectWindow(page, it(14), it(18));
  await expect(page.getByText(itTitle(15), { exact: true })).toBeVisible();
});

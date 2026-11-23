import { expect, test } from '@playwright/test';
import { expectWindow, item, openBoard, openWindowMenu, stored, windowButton } from './helpers';

// The iteration window (spec §4.3). Demo: Itération 12 … 21 (indexes 0 … 9), Itération 15 current.

test.beforeEach(async ({ page }) => {
  await openBoard(page);
});

test('‹ and › shift the window by one iteration, keeping its width, and stop at the edges', async ({ page }) => {
  const previous = page.getByRole('button', { name: 'Itération précédente' });
  const next = page.getByRole('button', { name: 'Itération suivante' });
  await expectWindow(page, 'It. 14', 'It. 18');

  await next.click();
  await expectWindow(page, 'It. 15', 'It. 19');
  await expect(page.getByText('Itération 19', { exact: true })).toBeVisible();
  await expect(page.getByText('Itération 14', { exact: true })).toHaveCount(0);

  await next.click();
  await next.click();
  await expectWindow(page, 'It. 17', 'It. 21');
  await expect(next).toBeDisabled();
  await expect(previous).toBeEnabled();

  for (let i = 0; i < 5; i++) await previous.click();
  await expectWindow(page, 'It. 12', 'It. 16');
  await expect(previous).toBeDisabled();
  await expect(next).toBeEnabled();
});

test('the pop-up picks the start and the end; an end before the start cannot be chosen', async ({ page }) => {
  const menu = await openWindowMenu(page);
  const start = menu.getByRole('group', { name: 'Début' });
  const end = menu.getByRole('group', { name: 'Fin' });
  const option = (list: typeof start, label: string) =>
    list.getByRole('menuitemradio', { name: new RegExp(`^${label.replace('.', '\\.')}(\\D|$)`) });

  // Ten iterations in each list, the current one flagged; the window's bounds are checked.
  await expect(start.getByRole('menuitemradio')).toHaveCount(10);
  await expect(end.getByRole('menuitemradio')).toHaveCount(10);
  await expect(option(start, 'It. 15')).toContainText('en cours');
  await expect(option(start, 'It. 14')).toHaveAttribute('aria-checked', 'true');
  await expect(option(end, 'It. 18')).toHaveAttribute('aria-checked', 'true');
  // The start cannot pass the end, nor the end precede the start.
  for (const label of ['It. 19', 'It. 20', 'It. 21']) await expect(option(start, label)).toBeDisabled();
  for (const label of ['It. 12', 'It. 13']) await expect(option(end, label)).toBeDisabled();
  await expect(option(end, 'It. 14')).toBeEnabled();

  await option(start, 'It. 13').click();
  await expectWindow(page, 'It. 13', 'It. 18');
  await expect(option(end, 'It. 13')).toBeEnabled();
  await expect(option(end, 'It. 12')).toBeDisabled();

  await option(end, 'It. 16').click();
  await expectWindow(page, 'It. 13', 'It. 16');
  await expect(option(start, 'It. 17')).toBeDisabled();

  // A one-iteration window.
  await option(start, 'It. 16').click();
  await expectWindow(page, 'It. 16', 'It. 16');
  await expect(page.getByText('Itération 16', { exact: true })).toBeVisible();
  await expect(page.getByText('Itération 15', { exact: true })).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(windowButton(page)).toBeFocused();
});

test('the quick settings set the window, and the active one is checked', async ({ page }) => {
  const preset = (name: string) => page.getByRole('menuitemradio', { name, exact: true });
  const presets = ['En cours ± 2', '6 prochaines', 'Toutes'];

  // The default window (current − 1 … current + 3) is none of them.
  await openWindowMenu(page);
  for (const name of presets) await expect(preset(name)).toHaveAttribute('aria-checked', 'false');

  const cases: [string, string, string][] = [
    ['En cours ± 2', 'It. 13', 'It. 17'],
    ['6 prochaines', 'It. 15', 'It. 20'],
    ['Toutes', 'It. 12', 'It. 21'],
  ];
  for (const [name, from, to] of cases) {
    await openWindowMenu(page);
    await preset(name).click();
    await expectWindow(page, from, to);
    // A preset closes the menu.
    await expect(page.getByRole('menu', { name: 'Fenêtre d’itérations' })).toBeHidden();
    await openWindowMenu(page);
    for (const other of presets) await expect(preset(other)).toHaveAttribute('aria-checked', String(other === name));
    await page.keyboard.press('Escape');
  }
});

test('the window is remembered after a reload', async ({ page }) => {
  await openWindowMenu(page);
  await page.getByRole('menuitemradio', { name: '6 prochaines', exact: true }).click();
  await expectWindow(page, 'It. 15', 'It. 20');
  await page.getByRole('button', { name: 'Itération suivante' }).click();
  await expectWindow(page, 'It. 16', 'It. 21');
  await expect.poll(() => stored(page, 'gleipnir.window')).toEqual({ from: 4, to: 9 });

  await page.reload();
  await expectWindow(page, 'It. 16', 'It. 21');
  await expect(page.getByText('Itération 21', { exact: true })).toBeVisible();
  await expect(page.getByText('Itération 15', { exact: true })).toHaveCount(0);
});

test('an epic cut by the window shows a chevron on its cut side with its real bound', async ({ page }) => {
  // &19 runs It. 12 → It. 15: the default window (from It. 14) cuts its start.
  const webhooks = item(page, '&19');
  await expect(webhooks).toHaveAttribute('data-clipped-start', 'true');
  await expect(webhooks).not.toHaveAttribute('data-clipped-end', /.*/);
  await expect(webhooks.getByTitle('Commence en It. 12')).toBeVisible();
  // &13 runs It. 17 → It. 19: its end is cut.
  const rights = item(page, '&13');
  await expect(rights).toHaveAttribute('data-clipped-end', 'true');
  await expect(rights.getByTitle('Se termine en It. 19')).toBeVisible();
  // &18 (It. 16 → It. 18) fits.
  await expect(item(page, '&18')).not.toHaveAttribute('data-clipped-start', /.*/);
  await expect(item(page, '&18')).not.toHaveAttribute('data-clipped-end', /.*/);

  // With every iteration shown nothing is cut.
  await openWindowMenu(page);
  await page.getByRole('menuitemradio', { name: 'Toutes', exact: true }).click();
  await expect(webhooks).not.toHaveAttribute('data-clipped-start', /.*/);
  await expect(webhooks.getByTitle('Commence en It. 12')).toHaveCount(0);
  await expect(rights).not.toHaveAttribute('data-clipped-end', /.*/);
});

test('epics overlapping the window show, issues only inside it', async ({ page }) => {
  // It. 19 only: &13 (It. 17 → 19), &16, &22 (It. 19 → 21), &17 (It. 18 → 20), &21 (It. 17 → 19),
  // &24 (dated by its children, It. 19 → 20); no blocking issue lives in It. 19.
  const menu = await openWindowMenu(page);
  await menu.getByRole('group', { name: 'Fin' }).getByRole('menuitemradio', { name: /^It\. 19/ }).click();
  await menu.getByRole('group', { name: 'Début' }).getByRole('menuitemradio', { name: /^It\. 19/ }).click();
  await expectWindow(page, 'It. 19', 'It. 19');
  for (const ref of ['&13', '&16', '&17', '&21', '&22', '&24']) await expect(item(page, ref)).toBeVisible();
  for (const ref of ['&12', '&15', '&18', '&19', '&23', '#110', '#125', '#130']) await expect(item(page, ref)).toHaveCount(0);
});

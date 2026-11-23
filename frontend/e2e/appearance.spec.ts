import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openBoard } from './helpers';

// Appearance (Automatique / Clair / Sombre): data-theme on <html>, remembered, applied before
// the first paint by the inline script of index.html so the page never flashes.

const html = (page: Page) => page.locator('html');

async function pick(page: Page, option: 'Automatique' | 'Clair' | 'Sombre') {
  const button = page.getByRole('button', { name: 'Apparence', exact: true });
  await button.click();
  const menu = page.getByRole('menu', { name: 'Apparence' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitemradio', { name: option }).click();
  await expect(menu).toBeHidden();
  // The focus goes back to the button.
  await expect(button).toBeFocused();
}

/** Records data-theme as soon as <body> is parsed: after the inline script of <head>, before
 * any module script (React) runs. */
async function recordEarlyTheme(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __earlyTheme?: string | null };
    const observer = new MutationObserver(() => {
      if (!document.body) return;
      w.__earlyTheme = document.documentElement.dataset.theme ?? null;
      observer.disconnect();
    });
    observer.observe(document, { childList: true, subtree: true });
  });
}

const earlyTheme = (page: Page) =>
  page.evaluate(() => (window as unknown as { __earlyTheme?: string | null }).__earlyTheme);

test('the appearance menu switches data-theme on <html>', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await openBoard(page);
  await expect(html(page)).toHaveAttribute('data-theme', 'light');

  await pick(page, 'Sombre');
  await expect(html(page)).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Apparence', exact: true })).toHaveAttribute('title', /^Apparence\s*:\s*Sombre$/);

  await pick(page, 'Clair');
  await expect(html(page)).toHaveAttribute('data-theme', 'light');

  await pick(page, 'Automatique');
  await expect(html(page)).toHaveAttribute('data-theme', 'light');

  // The menu checks the current choice.
  await page.getByRole('button', { name: 'Apparence', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'Apparence' });
  await expect(menu.getByRole('menuitemradio', { name: 'Automatique' })).toHaveAttribute('aria-checked', 'true');
  await expect(menu.getByRole('menuitemradio', { name: 'Sombre' })).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
});

test('the chosen appearance is remembered and applied before React mounts (no flash)', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await openBoard(page);
  await pick(page, 'Sombre');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('gleipnir.appearance'))).toBe('dark');

  await recordEarlyTheme(page);
  await page.reload({ waitUntil: 'commit' });
  await page.waitForLoadState('domcontentloaded');
  expect(await earlyTheme(page)).toBe('dark');
  await expect(html(page)).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('heading', { name: 'Dépendances' })).toBeVisible();
  await expect(html(page)).toHaveAttribute('data-theme', 'dark');

  // Light is remembered too, against a dark system.
  await page.emulateMedia({ colorScheme: 'dark' });
  await pick(page, 'Clair');
  await page.reload();
  expect(await earlyTheme(page)).toBe('light');
  await expect(page.getByRole('heading', { name: 'Dépendances' })).toBeVisible();
  await expect(html(page)).toHaveAttribute('data-theme', 'light');
});

test('the theme is applied even when the app script never runs', async ({ page }) => {
  // The inline script of index.html alone sets data-theme: block the app's entry module.
  await page.addInitScript(() => localStorage.setItem('gleipnir.appearance', 'dark'));
  await page.route(/\/src\/main\.tsx/, (route) => route.abort());
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(html(page)).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('heading', { name: 'Dépendances' })).toHaveCount(0);
});

test('Automatique follows the system color scheme, live and on load', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await recordEarlyTheme(page);
  await openBoard(page);
  expect(await earlyTheme(page)).toBe('dark');
  await expect(html(page)).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Apparence', exact: true })).toHaveAttribute('title', /^Apparence\s*:\s*Automatique$/);

  // The system switches while the page is open.
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(html(page)).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(html(page)).toHaveAttribute('data-theme', 'dark');

  // An explicit choice no longer follows it.
  await pick(page, 'Clair');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(html(page)).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(html(page)).toHaveAttribute('data-theme', 'light');
});

import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { displaySwitch, expectWindow, laneToggle, linkTypeCheckbox, openWindowMenu, searchField } from './helpers';
import { boardItem, boardLanes, DEFAULT_LANES, inspector, openBoard, sidebar } from './helpers2';
import { groupKey, it, title } from './demo';

// Sharing the view (ADR-31): the URL holds the checked groups (lanes), the window, the filters
// and display options, the search and the selection. Nothing is stored in the browser: a link
// opened elsewhere, or in another tab, shows exactly what it names.

const copyButton = (page: Page) => page.getByRole('button', { name: 'Copier le lien' });

/** Clicks "Copier le lien" and reads the clipboard. */
async function copyLink(page: Page): Promise<string> {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await copyButton(page).click();
  await expect(copyButton(page)).toHaveAttribute('title', 'Lien copié');
  return page.evaluate(() => navigator.clipboard.readText());
}

/** Opens a link in a fresh browser context: nothing in common with the page that copied it. */
async function openElsewhere(browser: Browser, link: string): Promise<Page> {
  const context = await browser.newContext({ locale: 'fr-FR', timezoneId: 'Europe/Paris', viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(link);
  await expect(page.getByRole('heading', { level: 1, name: 'Dépendances' })).toBeVisible();
  return page;
}

test('a copied link opens the same view in another browser', async ({ page, browser }) => {
  await openBoard(page);
  await sidebar(page).getByRole('checkbox', { name: 'Data', exact: true }).uncheck();
  await laneToggle(page, 'API et intégrations').click();
  await openWindowMenu(page);
  await page.getByRole('menuitemradio', { name: '6 prochaines', exact: true }).click();
  await expectWindow(page, it(15), it(20));
  await displaySwitch(page, 'Chemin critique').click();
  await linkTypeCheckbox(page, 'Lié à').uncheck();
  await searchField(page).fill(title('&12'));
  await boardItem(page, '&12').click();
  await expect(inspector(page).getByRole('heading', { name: title('&12') })).toBeVisible();

  const link = await copyLink(page);
  expect(new URL(link).searchParams.get('groups')).toBe(['api', 'experience', 'identite'].map(groupKey).join(','));

  const other = await openElsewhere(browser, link);
  await expect(sidebar(other).getByRole('checkbox', { name: 'Data', exact: true })).not.toBeChecked();
  for (const name of DEFAULT_LANES.filter((lane) => lane !== 'Data')) {
    await expect(sidebar(other).getByRole('checkbox', { name, exact: true })).toBeChecked();
  }
  await expect(laneToggle(other, 'API et intégrations')).toHaveAccessibleName('Déplier le couloir API et intégrations');
  await expectWindow(other, it(15), it(20));
  await expect(displaySwitch(other, 'Chemin critique')).toBeChecked();
  await expect(linkTypeCheckbox(other, 'Lié à')).not.toBeChecked();
  await expect(linkTypeCheckbox(other, 'Bloque')).toBeChecked();
  await expect(searchField(other)).toHaveValue(title('&12'));
  await expect(inspector(other).getByRole('heading', { name: title('&12') })).toBeVisible();
  // Nothing was stored: the view came from the link alone.
  expect(await other.evaluate(() => Object.keys(localStorage).filter((key) => key !== 'gleipnir.appearance'))).toEqual([]);
  await other.context().close();
});

test('the address bar leaves the default view out, a copied link names its iterations', async ({ page }) => {
  await openBoard(page);
  expect(new URL(page.url()).search).toBe('');
  const link = new URL(await copyLink(page));
  expect([...link.searchParams.keys()]).toEqual(['from', 'to']);
  expect(new URL(page.url()).search).toBe('');
});

test('two tabs on two links keep their own view', async ({ page, context }) => {
  const apiOnly = `/?groups=${groupKey('api')}`;
  await page.goto(apiOnly);
  await expect.poll(() => boardLanes(page)).toEqual(['API et intégrations']);

  const second = await context.newPage();
  await openBoard(second);
  await sidebar(second).getByRole('checkbox', { name: 'Identité et sécurité', exact: true }).uncheck();
  await expect.poll(() => boardLanes(second)).toEqual(DEFAULT_LANES.filter((lane) => lane !== 'Identité et sécurité'));

  // The first tab still shows its link's view, even after a reload.
  await page.reload();
  await expect.poll(() => boardLanes(page)).toEqual(['API et intégrations']);
  await expect(sidebar(page).getByRole('checkbox', { name: 'Identité et sécurité', exact: true })).not.toBeChecked();
});

test('a link naming unknown things falls back to the defaults', async ({ page }) => {
  await page.goto('/?groups=nope&from=1&to=2&item=0&label=');
  await expect(page.getByRole('heading', { level: 1, name: 'Dépendances' })).toBeVisible();
  await expectWindow(page, it(14), it(18));
  // No known lane is listed: none is checked.
  await expect(page.getByText('Aucun couloir affiché')).toBeVisible();
  await expect(inspector(page)).toHaveCount(0);
});

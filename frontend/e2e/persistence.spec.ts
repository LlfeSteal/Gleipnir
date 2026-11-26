import { expect, test } from '@playwright/test';
import { displaySwitch, expectWindow, laneToggle, linkTypeCheckbox, openWindowMenu } from './helpers';
import {
  applyLaneSettings,
  boardItem,
  boardLanes,
  DEFAULT_LANES,
  laneBox,
  laneSettings,
  openBoard,
  sidebar,
} from './helpers2';
import { groupOf, it } from './demo';

// What the board remembers (spec §7, ADR-36): the lanes, the window and the sidebar live in the
// browser (localStorage), shared by its tabs and kept through a reload. Link types, display
// options, collapsed lanes, search and selection last for the page only. Nothing goes in the URL.

test.beforeEach(async ({ page }) => {
  // A reload, a second tab and a dozen settings: slow when both suites run side by side.
  test.slow();
  await openBoard(page);
});

test('a reload keeps the lanes, the window and the sidebar', async ({ page }) => {
  await page.getByRole('button', { name: 'Modifier le couloir Data', exact: true }).click();
  const sheet = laneSettings(page);
  await sheet.getByRole('textbox', { name: 'Nom' }).fill('Données');
  await applyLaneSettings(sheet);
  await laneBox(page, 'Expérience produit').uncheck();
  await openWindowMenu(page);
  await page.getByRole('menuitemradio', { name: '6 prochaines', exact: true }).click();
  await expectWindow(page, it(15), it(20));
  await page.getByRole('button', { name: 'Masquer la barre latérale' }).click();
  await expect(sidebar(page)).toBeHidden();

  await page.reload();
  await expect(boardItem(page, '&18')).toBeVisible();
  await expect.poll(() => boardLanes(page)).toEqual(['API et intégrations', 'Données', 'Identité et sécurité']);
  await expectWindow(page, it(15), it(20));
  await expect(sidebar(page)).toBeHidden();
  await page.getByRole('button', { name: 'Afficher la barre latérale' }).click();
  await expect(laneBox(page, 'Expérience produit')).not.toBeChecked();
  // Nothing in the URL; only these keys in the browser.
  expect(new URL(page.url()).search).toBe('');
  const keys = await page.evaluate(() => Object.keys(localStorage).filter((key) => key !== 'gleipnir.appearance').sort());
  expect(keys).toEqual(['gleipnir.lanes', 'gleipnir.sidebar', 'gleipnir.window']);
});

test('another tab of the browser opens on the same lanes', async ({ page, context }) => {
  await laneBox(page, 'Identité et sécurité').uncheck();
  await expect.poll(() => boardLanes(page)).toEqual(DEFAULT_LANES.filter((name) => name !== 'Identité et sécurité'));
  const second = await context.newPage();
  await openBoard(second);
  await expect.poll(() => boardLanes(second)).toEqual(DEFAULT_LANES.filter((name) => name !== 'Identité et sécurité'));
  await second.close();
});

test('link types, display options and collapsed lanes last for the page only', async ({ page }) => {
  await linkTypeCheckbox(page, 'Lié à').uncheck();
  await linkTypeCheckbox(page, 'Epic parent → issue').check();
  await displaySwitch(page, 'Masquer les issues fermées').click();
  await displaySwitch(page, 'Chemin critique').click();
  await laneToggle(page, 'Data').click();
  await expect(laneToggle(page, 'Data')).toHaveAccessibleName('Déplier le couloir Data');
  await page.getByRole('searchbox', { name: 'Rechercher un epic ou une issue' }).fill('export');

  await page.reload();
  await expect(boardItem(page, '&18')).toBeVisible();
  await expect(linkTypeCheckbox(page, 'Lié à')).toBeChecked();
  await expect(linkTypeCheckbox(page, 'Bloque')).toBeChecked();
  await expect(linkTypeCheckbox(page, 'Epic parent → issue')).not.toBeChecked();
  await expect(displaySwitch(page, 'Masquer les issues fermées')).toHaveAttribute('aria-checked', 'false');
  await expect(displaySwitch(page, 'Chemin critique')).toHaveAttribute('aria-checked', 'false');
  await expect(laneToggle(page, 'Data')).toHaveAccessibleName('Replier le couloir Data');
  await expect(page.getByRole('searchbox', { name: 'Rechercher un epic ou une issue' })).toHaveValue('');
  expect(await page.evaluate(() => localStorage.getItem('gleipnir.lanes'))).toBeNull();
});

test('stored lanes are checked: unknown groups are dropped, a broken value gives the defaults', async ({ page }) => {
  const data = groupOf('data').id;
  await page.evaluate((id) => {
    const lane = (name: string, groups: string[]) => ({
      id: name,
      name,
      color: 'blue',
      groups,
      includeSubgroups: true,
      showEpics: true,
      issueMode: 'blocking',
      labels: [],
      labelMode: 'any',
      active: true,
    });
    localStorage.setItem('gleipnir.lanes', JSON.stringify([lane('Seulement Data', [id]), lane('Fantôme', ['gid://gitlab/Group/0'])]));
  }, data);
  await page.reload();
  await expect.poll(() => boardLanes(page)).toEqual(['Seulement Data']);
  await expect(boardItem(page, '&21')).toBeVisible();

  await page.evaluate(() => localStorage.setItem('gleipnir.lanes', '{oops'));
  await page.reload();
  await expect.poll(() => boardLanes(page)).toEqual(DEFAULT_LANES);
});

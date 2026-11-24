import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { boardItem, boardItems, boardLanes, DEFAULT_LANES, openBoard, sidebar } from './helpers2';
import { groupKey, root, title } from './demo';

// Lanes (spec §4.4, ADR-32): the checked groups of the GitLab group tree, read only. An item
// shows in the lane of its closest checked group. Item types and labels filter the whole board
// (§4.7). The demo has one nested group: Partenaires, under API et intégrations, holding &22.

test.beforeEach(async ({ page }) => {
  await openBoard(page);
  await expect.poll(() => boardLanes(page)).toEqual(DEFAULT_LANES);
});

const groupBox = (page: Page, name: string) => sidebar(page).getByRole('checkbox', { name, exact: true });

/** The groups the URL names, null when it names none: the default ones. */
function urlGroups(page: Page): string[] | null {
  const groups = new URL(page.url()).searchParams.get('groups');
  return groups === null ? null : groups.split(',').filter(Boolean);
}

/** Every iteration in the window, so that &22 (It. 19 → It. 21) shows. */
async function showAllIterations(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Fenêtre\s*:/ }).click();
  await page.getByRole('menuitemradio', { name: 'Toutes', exact: true }).click();
}

test('the lanes are the GitLab groups, read only: nothing to create, rename or edit', async ({ page }) => {
  const tree = sidebar(page).getByRole('list', { name: 'Groupes GitLab' });
  await expect(tree.getByRole('checkbox')).toHaveCount(1 + DEFAULT_LANES.length);
  await expect(groupBox(page, root().name)).not.toBeChecked();
  for (const name of DEFAULT_LANES) await expect(groupBox(page, name)).toBeChecked();
  await expect(sidebar(page).getByText(/créez le groupe dans GitLab puis synchronisez/)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Modifier|Nouveau couloir/ })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('checking a nested group gives it its own lane, taken out of its parent\'s', async ({ page }) => {
  await showAllIterations(page);
  const api = groupBox(page, 'API et intégrations');
  // The count of shown items, the checkbox's description.
  const apiCount = Number(await api.evaluate((el) => document.getElementById(el.getAttribute('aria-describedby') ?? '')?.textContent));
  await expect(boardItem(page, '&22')).toBeVisible();

  await sidebar(page).getByRole('button', { name: 'Déplier API et intégrations' }).click();
  await groupBox(page, 'Partenaires').check();
  await expect.poll(() => boardLanes(page)).toEqual(['API et intégrations', 'Partenaires', ...DEFAULT_LANES.slice(1)]);
  await expect(page.getByRole('region', { name: 'Partenaires' })).toContainText('API et intégrations › Partenaires');
  await expect(groupBox(page, 'Partenaires')).toHaveAccessibleDescription('1');
  await expect(api).toHaveAccessibleDescription(String(apiCount - 1));
  await expect(page.getByRole('button', { name: new RegExp(`^Epic [&#]\\d+ ${title('&22')}`) })).toHaveCount(1);
  await expect
    .poll(() => urlGroups(page))
    .toEqual(['api', 'api/partenaires', 'data', 'experience', 'identite'].map(groupKey));

  // The URL keeps it, folded branch unfolded again after a reload.
  await page.reload();
  await expect.poll(() => boardLanes(page)).toContain('Partenaires');
  await expect(groupBox(page, 'Partenaires')).toBeChecked();

  await groupBox(page, 'Partenaires').uncheck();
  await expect.poll(() => boardLanes(page)).toEqual(DEFAULT_LANES);
  await expect.poll(() => urlGroups(page)).toBeNull();
});

test('the root group holds what no checked subgroup takes', async ({ page }) => {
  for (const name of DEFAULT_LANES.slice(1)) await groupBox(page, name).uncheck();
  await groupBox(page, root().name).check();
  await expect.poll(() => boardLanes(page)).toEqual([root().name, 'API et intégrations']);
  await expect(boardItem(page, '&21')).toBeVisible(); // a Data epic, in the root's lane
  await expect.poll(() => urlGroups(page)).toEqual([groupKey(''), groupKey('api')]);
});

test('without a checked group, an empty state brings the default lanes back', async ({ page }) => {
  for (const name of DEFAULT_LANES) await groupBox(page, name).uncheck();
  await expect(page.getByText('Aucun couloir affiché')).toBeVisible();
  await expect.poll(() => urlGroups(page)).toEqual([]);
  await page.getByRole('button', { name: 'Afficher les couloirs par défaut' }).click();
  await expect.poll(() => boardLanes(page)).toEqual(DEFAULT_LANES);
  await expect.poll(() => urlGroups(page)).toBeNull();
});

test('unchecking a lane in the sidebar hides it, and the URL keeps it hidden', async ({ page }) => {
  const box = groupBox(page, 'Data');
  await box.uncheck();
  await expect.poll(() => boardLanes(page)).toEqual(DEFAULT_LANES.filter((name) => name !== 'Data'));
  await expect(boardItem(page, '&21')).toHaveCount(0);

  await page.reload();
  await expect(boardItem(page, '&18')).toBeVisible();
  await expect(groupBox(page, 'Data')).not.toBeChecked();
  await expect(boardItem(page, '&21')).toHaveCount(0);

  await groupBox(page, 'Data').check();
  await expect.poll(() => boardLanes(page)).toEqual(DEFAULT_LANES);
  await expect(boardItem(page, '&21')).toBeVisible();
});

test('the label filter "priorité::haute" shows #104 and #113 only, on every lane', async ({ page }) => {
  const button = sidebar(page).getByRole('button', { name: /^Labels\s*:/ });
  await expect(button).toHaveAccessibleName(/Tous les labels$/);
  await button.click();
  const popup = page.getByRole('dialog', { name: 'Labels' });
  await popup.getByRole('searchbox', { name: 'Filtrer les labels' }).fill('priorité');
  await popup.getByRole('option', { name: 'priorité::haute' }).click();
  await page.keyboard.press('Escape');
  await expect(button).toHaveAccessibleName(/priorité::haute$/);
  await expect(boardItems(page)).toHaveCount(2);
  await expect(boardItem(page, '#104')).toBeVisible();
  await expect(boardItem(page, '#113')).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.getAll('label')).toEqual(['priorité::haute']);

  // "Tous" with "bug" too: both issues carry both labels.
  await button.click();
  await popup.getByRole('searchbox', { name: 'Filtrer les labels' }).fill('bug');
  await popup.getByRole('option', { name: 'bug' }).click();
  await popup.getByRole('radio', { name: 'Tous' }).click();
  await page.keyboard.press('Escape');
  await expect(boardItems(page)).toHaveCount(2);
  await expect.poll(() => new URL(page.url()).searchParams.get('labelMode')).toBe('all');
});

test('the type filters hide the epics or the issues of every lane', async ({ page }) => {
  await sidebar(page).getByRole('switch', { name: 'Epics' }).click();
  await expect(page.getByRole('button', { name: /^Epic &\d+/ })).toHaveCount(0);
  await expect(boardItem(page, '#110')).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get('types')).toBe('issues');
  await sidebar(page).getByRole('switch', { name: 'Epics' }).click();
  await sidebar(page).getByRole('switch', { name: 'Issues bloquantes' }).click();
  await expect(page.getByRole('button', { name: /^Issue #\d+/ })).toHaveCount(0);
  await expect(boardItem(page, '&18')).toBeVisible();
});

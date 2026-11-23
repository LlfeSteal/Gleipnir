import { expect, test } from '@playwright/test';
import {
  DEMO_LANES,
  boardItems,
  displaySwitch,
  expectWindow,
  item,
  laneToggle,
  openBoard,
  shownRefs,
  sidebar,
  summaryLine,
  windowButton,
} from './helpers';

// The board of the demo dataset in its default state: window It. 14 – It. 18 (current − 1 …
// current + 3), the four default lanes, the unplanned column shown.

test.beforeEach(async ({ page }) => {
  await openBoard(page);
});

test('the toolbar shows the title and the group · cadence subtitle', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1, name: 'Dépendances' })).toBeVisible();
  await expect(page.getByText('Atlas · Sprints produit', { exact: true })).toBeVisible();
});

test('the default window shows It. 14 to It. 18, with Itération 15 marked current', async ({ page }) => {
  await expectWindow(page, 'It. 14', 'It. 18');
  const columns = [14, 15, 16, 17, 18].map((n) => page.getByText(`Itération ${n}`, { exact: true }));
  for (const column of columns) await expect(column).toBeVisible();
  // Left to right, in order.
  const xs: number[] = [];
  for (const column of columns) xs.push((await column.boundingBox())?.x ?? NaN);
  expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  for (const n of [12, 13, 19, 20, 21]) await expect(page.getByText(`Itération ${n}`, { exact: true })).toHaveCount(0);

  // Only one column is current, and it is Itération 15 with its "En cours" badge.
  const current = page.locator('[aria-current="date"]');
  await expect(current).toHaveCount(1);
  await expect(current).toContainText('Itération 15');
  await expect(current.getByText('En cours', { exact: true })).toBeVisible();
});

test('the four default lanes come from the demo subgroups, in path order', async ({ page }) => {
  const toggles = page.getByRole('button', { name: /^Replier le couloir / });
  await expect(toggles).toHaveCount(DEMO_LANES.length);
  const names = await toggles.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
  expect(names).toEqual(DEMO_LANES.map((lane) => `Replier le couloir ${lane}`));
  // The sidebar lists the same lanes, all shown.
  for (const lane of DEMO_LANES) await expect(sidebar(page).getByRole('checkbox', { name: lane, exact: true })).toBeChecked();
});

test('epic bars and blocking issue cards are drawn, ignored issues never are', async ({ page }) => {
  await expect(item(page, '&18')).toBeVisible();
  await expect(item(page, '&18')).toHaveAccessibleName("Epic &18 API d'export des données");
  await expect(item(page, '#110')).toBeVisible();
  await expect(item(page, '#110')).toContainText('Bloque &21');
  // A closed blocker stays, marked closed.
  await expect(item(page, '#131')).toHaveAccessibleName('Issue #131 Montée de version Kafka, fermée');
  await expect(item(page, '#131')).toContainText('Fermée');

  // Everything the default window shows: 7 epics in the window + &25 unplanned, 8 blocking
  // issues in the window + #132 unplanned. Epics &16, &22, &23, &24 and issue #140 are outside.
  expect(await shownRefs(page)).toEqual(
    ['#104', '#107', '#110', '#113', '#114', '#125', '#130', '#131', '#132', '&12', '&13', '&15', '&17', '&18', '&19', '&21', '&25'].sort(),
  );
  // #101 (and the other issues blocking no epic) are never drawn, whatever the window.
  await expect(page.getByText('#101', { exact: true })).toHaveCount(0);
  await expect(item(page, '#101')).toHaveCount(0);
});

test('an ignored issue is never shown, even with every iteration in the window', async ({ page }) => {
  await windowButton(page).click();
  await page.getByRole('menuitemradio', { name: 'Toutes' }).click();
  await expectWindow(page, 'It. 12', 'It. 21');
  await expect(item(page, '#140')).toBeVisible();
  for (const ref of ['#101', '#103', '#106', '#108', '#109', '#112', '#120', '#126', '#127']) {
    await expect(item(page, ref)).toHaveCount(0);
  }
});

test('the sidebar tells how many synced issues are ignored', async ({ page }) => {
  await expect(
    sidebar(page).getByText(/^9 issues synchronisées ne bloquent aucun epic\s*:\s*elles ne sont pas affichées\.$/),
  ).toBeVisible();
});

test('the summary line counts lanes, epics, blocking issues, blocks and conflicts', async ({ page }) => {
  await expect(summaryLine(page)).toHaveText('4 couloirs · 8 epics · 9 issues bloquantes · 12 blocages · 3 conflits');
});

test('a lane collapses and expands, hiding then showing its items', async ({ page }) => {
  const toggle = laneToggle(page, 'Data');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  for (const ref of ['&21', '#130', '#131', '#132']) await expect(item(page, ref)).toBeVisible();
  const before = await boardItems(page).count();

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toHaveAccessibleName('Déplier le couloir Data');
  for (const ref of ['&21', '#130', '#131', '#132']) await expect(item(page, ref)).toHaveCount(0);
  await expect(boardItems(page)).toHaveCount(before - 4);
  // The other lanes keep their items.
  await expect(item(page, '&18')).toBeVisible();

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle).toHaveAccessibleName('Replier le couloir Data');
  for (const ref of ['&21', '#130', '#131', '#132']) await expect(item(page, ref)).toBeVisible();
  await expect(boardItems(page)).toHaveCount(before);
});

test('the unplanned column holds &25 and #132 while "Afficher les non planifiés" is on', async ({ page }) => {
  const unplanned = displaySwitch(page, 'Afficher les non planifiés');
  await expect(unplanned).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('Non planifié', { exact: true })).toBeVisible();
  await expect(item(page, '&25')).toBeVisible();
  await expect(item(page, '#132')).toBeVisible();
  // Both sit in the last column, right of every iteration.
  const column = await page.getByText('Non planifié', { exact: true }).boundingBox();
  const lastIteration = await page.getByText('Itération 18', { exact: true }).boundingBox();
  const epic = await item(page, '&25').boundingBox();
  expect(column && lastIteration && epic).toBeTruthy();
  expect(column!.x).toBeGreaterThan(lastIteration!.x);
  expect(epic!.x).toBeGreaterThan(lastIteration!.x + lastIteration!.width);

  await unplanned.click();
  await expect(unplanned).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByText('Non planifié', { exact: true })).toHaveCount(0);
  await expect(item(page, '&25')).toHaveCount(0);
  await expect(item(page, '#132')).toHaveCount(0);
  await expect(summaryLine(page)).toHaveText('4 couloirs · 7 epics · 8 issues bloquantes · 12 blocages · 3 conflits');

  await unplanned.click();
  await expect(item(page, '&25')).toBeVisible();
  await expect(item(page, '#132')).toBeVisible();
});

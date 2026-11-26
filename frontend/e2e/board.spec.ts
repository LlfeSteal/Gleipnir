import { expect, test } from '@playwright/test';
import {
  DEMO_LANES,
  boardItems,
  displaySwitch,
  expectWindow,
  item,
  laneToggle,
  openBoard,
  shownKeys,
  sidebar,
  summaryLine,
  windowButton,
} from './helpers';
import { cadence, it, itTitle, ref, root, title } from './demo';

// The board of the demo dataset in its default state: window It. 14 – It. 18 (current − 1 …
// current + 3), the four default lanes (issues that block an epic only, ADR-34), the unplanned
// column shown.

test.beforeEach(async ({ page }) => {
  await openBoard(page);
});

test('the toolbar shows the title and the group · cadence subtitle', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1, name: 'Dépendances' })).toBeVisible();
  await expect(page.getByText(`${root().name} · ${cadence()}`, { exact: true })).toBeVisible();
});

test('the default window shows It. 14 to It. 18, with Itération 15 marked current', async ({ page }) => {
  await expectWindow(page, it(14), it(18));
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
  await expect(current).toContainText(itTitle(15));
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

test('epic bars and blocking issue cards are drawn, the other issues are not by default', async ({ page }) => {
  await expect(item(page, '&18')).toBeVisible();
  await expect(item(page, '&18')).toHaveAccessibleName(`Epic ${ref('&18')} API d'export des données`);
  await expect(item(page, '#110')).toBeVisible();
  await expect(item(page, '#110')).toContainText(`Bloque ${ref('&21')}`);
  // A closed blocker stays, marked closed.
  await expect(item(page, '#131')).toHaveAccessibleName(`Issue ${ref('#131')} Montée de version Kafka, fermée`);
  await expect(item(page, '#131')).toContainText('Fermée');

  // Everything the default window shows: 7 epics in the window + &25 unplanned, 8 blocking
  // issues in the window + #132 unplanned. Epics &16, &22, &23, &24 and issue #140 are outside.
  expect(await shownKeys(page)).toEqual(
    ['#104', '#107', '#110', '#113', '#114', '#125', '#130', '#131', '#132', '&12', '&13', '&15', '&17', '&18', '&19', '&21', '&25'].sort(),
  );
  // #101 (and the other issues blocking no epic) are not drawn in the default « Bloquantes » mode
  // (spec §5.1); issue-mode.spec.ts shows them in « Toutes » mode. &26, in the root group, is in
  // no default lane (hors-couloirs.spec.ts).
  await expect(page.getByText(title('#101'), { exact: true })).toHaveCount(0);
  await expect(item(page, '#101')).toHaveCount(0);
  await expect(item(page, '&26')).toHaveCount(0);
});

test('an issue that blocks no epic is not shown by default, even with every iteration in the window', async ({ page }) => {
  await windowButton(page).click();
  await page.getByRole('menuitemradio', { name: 'Toutes' }).click();
  await expectWindow(page, it(12), it(21));
  await expect(item(page, '#140')).toBeVisible();
  for (const ref of ['#101', '#103', '#106', '#108', '#109', '#112', '#120', '#126', '#127']) {
    await expect(item(page, ref)).toHaveCount(0);
  }
});

test('the sidebar tells how many synced issues block an epic (spec §5.1)', async ({ page }) => {
  // 19 issues in the dataset, 10 of them block an epic (#140 included, outside the window).
  await expect(sidebar(page).getByText('10 sur 19 issues synchronisées bloquent un epic.', { exact: true })).toBeVisible();
});

test('the summary line counts lanes, epics, issues, blocks and conflicts', async ({ page }) => {
  await expect(summaryLine(page)).toHaveText('4 couloirs · 8 epics · 9 issues · 12 blocages · 3 conflits');
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

test('the columns share the width of the board, and scroll once below their minimum width', async ({ page }) => {
  // Geometry of the scroll container and of its last column header (CSS classes: measuring only).
  const geometry = () =>
    page.evaluate(() => {
      const scroller = document.querySelector('.board-scroll')!;
      const headers = scroller.querySelectorAll('.column-header');
      const last = headers[headers.length - 1].getBoundingClientRect();
      const box = scroller.getBoundingClientRect();
      return {
        gap: box.left + scroller.clientLeft + scroller.clientWidth - last.right,
        overflow: scroller.scrollWidth - scroller.clientWidth,
        widths: [...new Set([...headers].map((h) => Math.round(h.getBoundingClientRect().width)))],
      };
    });

  // Wide screen: six columns (five iterations and the unplanned one) reach the right edge.
  await page.setViewportSize({ width: 1920, height: 900 });
  await expect.poll(async () => (await geometry()).gap).toBeLessThan(6);
  expect((await geometry()).gap).toBeGreaterThanOrEqual(0);
  expect((await geometry()).overflow).toBe(0);
  // All as wide as each other, wider than their minimum.
  const { widths } = await geometry();
  expect(widths).toHaveLength(1);
  expect(widths[0]).toBeGreaterThan(212);

  // Narrow screen: the columns keep their minimum width and the board scrolls.
  await page.setViewportSize({ width: 1000, height: 900 });
  // (The old wide columns overflow too until the deferred layout catches up: wait for it.)
  await expect.poll(async () => (await geometry()).widths).toEqual([212]);
  expect((await geometry()).overflow).toBeGreaterThan(0);
});

test('the unplanned column holds &25 and #132 while "Afficher les non planifiés" is on', async ({ page }) => {
  const unplanned = displaySwitch(page, 'Afficher les non planifiés');
  await expect(unplanned).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('Non planifié', { exact: true })).toBeVisible();
  await expect(item(page, '&25')).toBeVisible();
  await expect(item(page, '#132')).toBeVisible();
  // Both sit in the last column, right of every iteration.
  const column = await page.getByText('Non planifié', { exact: true }).boundingBox();
  const lastIteration = await page.getByText(itTitle(18), { exact: true }).boundingBox();
  const epic = await item(page, '&25').boundingBox();
  expect(column && lastIteration && epic).toBeTruthy();
  expect(column!.x).toBeGreaterThan(lastIteration!.x);
  expect(epic!.x).toBeGreaterThan(lastIteration!.x + lastIteration!.width);

  await unplanned.click();
  await expect(unplanned).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByText('Non planifié', { exact: true })).toHaveCount(0);
  await expect(item(page, '&25')).toHaveCount(0);
  await expect(item(page, '#132')).toHaveCount(0);
  await expect(summaryLine(page)).toHaveText('4 couloirs · 7 epics · 8 issues · 12 blocages · 3 conflits');

  await unplanned.click();
  await expect(item(page, '&25')).toBeVisible();
  await expect(item(page, '#132')).toBeVisible();
});

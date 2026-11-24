import { expect, test } from '@playwright/test';
import { boardItem, inspector, openBoard, sidebar } from './helpers2';
import { it, ref, title } from './demo';

// Phone layout (≤ 760 px, spec §4.6 and §4.8): the sidebar is a "Filtres" overlay, the
// inspector a bottom sheet, and the board scrolls sideways under a fixed lane rail.

const VIEWPORT = { width: 390, height: 844 };
test.use({ viewport: VIEWPORT, isMobile: true, hasTouch: true });

test.beforeEach(async ({ page }) => {
  await openBoard(page);
});

test('the board scrolls horizontally while the lane rail stays put', async ({ page }) => {
  const scroller = page.locator('.board-scroll');
  const lane = page.getByRole('region', { name: 'API et intégrations' });
  const epic = boardItem(page, '&18');
  const { scrollWidth, clientWidth } = await scroller.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  expect(scrollWidth).toBeGreaterThan(clientWidth);
  // The page itself never scrolls sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(VIEWPORT.width);

  const laneBefore = (await lane.boundingBox())!;
  const epicBefore = (await epic.boundingBox())!;
  await scroller.evaluate((el) => el.scrollTo({ left: 300, behavior: 'instant' }));
  await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBe(300);

  const laneAfter = (await lane.boundingBox())!;
  expect(laneAfter.x).toBeCloseTo(laneBefore.x, 0);
  await expect.poll(async () => (await epic.boundingBox())!.x).toBeCloseTo(epicBefore.x - 300, 0);
});

test('the lane rail leaves room for the items', async ({ page }) => {
  // On a phone the rail must not hide the first column: the item at the start of the window
  // (&19, cut at It. 14) is reachable without scrolling.
  const rail = (await page.getByRole('region', { name: 'API et intégrations' }).boundingBox())!;
  expect(rail.width).toBeLessThan(VIEWPORT.width / 2);
  const epic = (await boardItem(page, '&19').boundingBox())!;
  expect(epic.x).toBeGreaterThanOrEqual(rail.x + rail.width - 1);
});

test('"Filtres" opens the sidebar overlay, which closes again', async ({ page }) => {
  const filters = page.getByRole('button', { name: 'Filtres', exact: true });
  await expect(sidebar(page)).toHaveCount(0);
  await expect(filters).toHaveAttribute('aria-expanded', 'false');

  await filters.tap();
  await expect(sidebar(page)).toBeVisible();
  await expect(sidebar(page)).toBeInViewport();
  await expect(filters).toHaveAttribute('aria-expanded', 'true');
  await expect(sidebar(page).getByRole('checkbox', { name: 'Data', exact: true })).toBeVisible();

  await sidebar(page).getByRole('button', { name: 'Fermer les filtres' }).tap();
  await expect(sidebar(page)).toHaveCount(0);

  // Escape closes it too.
  await filters.tap();
  await expect(sidebar(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sidebar(page)).toHaveCount(0);

  // As does a tap on the dimmed board beside it.
  await filters.tap();
  await expect(sidebar(page)).toBeVisible();
  await page.touchscreen.tap(VIEWPORT.width - 20, VIEWPORT.height / 2);
  await expect(sidebar(page)).toHaveCount(0);
});

test('tapping an item opens the inspector as a bottom sheet', async ({ page }) => {
  const epic = boardItem(page, '&18');
  await epic.tap();
  await expect(epic).toHaveAttribute('aria-pressed', 'true');
  const panel = inspector(page);
  await expect(panel).toBeVisible();
  await expect(panel.getByText(ref('&18'), { exact: true }).first()).toBeVisible();

  const box = (await panel.boundingBox())!;
  expect(box.x).toBeCloseTo(0, 0);
  expect(box.width).toBeCloseTo(VIEWPORT.width, 0);
  expect(box.y + box.height).toBeCloseTo(VIEWPORT.height, 0);
  expect(box.y).toBeGreaterThan(0);

  await panel.getByRole('button', { name: 'Fermer le détail' }).tap();
  await expect(panel).toBeHidden();
  await expect(epic).toHaveAttribute('aria-pressed', 'false');
});

test('the toolbar controls are reachable', async ({ page }) => {
  const openSearch = page.getByRole('button', { name: 'Rechercher', exact: true });
  const sync = page.getByRole('button', { name: 'Synchroniser' });
  const windowGroup = page.getByRole('group', { name: 'Fenêtre d’itérations' });
  for (const control of [openSearch, sync, windowGroup]) await expect(control).toBeInViewport({ ratio: 1 });

  // The window moves.
  await windowGroup.getByRole('button', { name: 'Itération suivante' }).tap();
  await expect(windowGroup.getByRole('button', { name: /^Fenêtre : / })).toHaveAccessibleName(`Fenêtre : ${it(15)} – ${it(19)}`);

  // Sync asks the backend for fresh data.
  const request = page.waitForRequest((r) => new URL(r.url()).searchParams.get('refresh') === '1');
  await sync.tap();
  await request;
  await expect(sync).toBeEnabled();

  // The search button unfolds a full-width field that filters the board; "Annuler" folds it.
  await openSearch.tap();
  const search = page.getByRole('searchbox', { name: 'Rechercher un epic ou une issue' });
  await expect(search).toBeFocused();
  await expect(search).toBeInViewport({ ratio: 1 });
  await search.fill(title('&21'));
  await expect(boardItem(page, '&21')).toBeVisible();
  // &18 blocks &21: it stays, as a dependency; &15 is no part of the chain.
  await expect(boardItem(page, '&15')).toHaveCount(0);
  await page.getByRole('banner').getByRole('button', { name: 'Annuler' }).tap();
  await expect(search).toHaveCount(0);
  await expect(boardItem(page, '&15')).toBeVisible();
});

test('the toolbar keeps every action on the first row, beside the title', async ({ page }) => {
  const title = page.getByRole('heading', { level: 1, name: 'Dépendances' });
  const buttons = ['Filtres', 'Rechercher', 'Synchroniser', 'Apparence'].map((name) =>
    page.getByRole('button', { name: new RegExp(`^${name}`) }),
  );
  const titleBox = (await title.boundingBox())!;
  for (const button of buttons) {
    const box = (await button.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(VIEWPORT.width);
    // Same row as the title, without covering it.
    expect(Math.abs(box.y + box.height / 2 - (titleBox.y + titleBox.height / 2))).toBeLessThan(12);
    expect(box.x + box.width <= titleBox.x || box.x >= titleBox.x + titleBox.width).toBe(true);
  }
});

test('"Copier le lien" lives in the Filtres overlay', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Copier le lien' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Filtres' }).click();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await sidebar(page).getByRole('button', { name: 'Copier le lien' }).click();
  const link = new URL(await page.evaluate(() => navigator.clipboard.readText()));
  expect([...link.searchParams.keys()]).toEqual(['from', 'to']);
});

import { expect, test } from '@playwright/test';
import {
  boardItems,
  displaySwitch,
  drawnLinks,
  expectWindow,
  isDimmed,
  item,
  linkTypeCheckbox,
  openBoard,
  openWindowMenu,
  searchField,
  shownRefs,
  summaryLine,
  summaryPart,
} from './helpers';

// Search, display options, link types, critical path and conflicts (spec §4.5, §4.7). Counts
// are those of the default window It. 14 – It. 18.

test.beforeEach(async ({ page }) => {
  await openBoard(page);
});

test.describe('search', () => {
  test('by issue reference', async ({ page }) => {
    await searchField(page).fill('#110');
    await expect(boardItems(page)).toHaveCount(1);
    await expect(item(page, '#110')).toBeVisible();
  });

  test('by epic reference', async ({ page }) => {
    await searchField(page).fill('&18');
    await expect(boardItems(page)).toHaveCount(1);
    await expect(item(page, '&18')).toBeVisible();
  });

  test('by title words, case-insensitive, in every lane', async ({ page }) => {
    await searchField(page).fill('kafka');
    await expect(boardItems(page)).toHaveCount(1);
    await expect(item(page, '#131')).toBeVisible();

    // "export": the epic &18 (API & intégrations) and the issue #110 of its project.
    await searchField(page).fill('EXPORT');
    await expect.poll(() => shownRefs(page)).toEqual(['#110', '&18']);
  });

  test('clearing the search brings everything back', async ({ page }) => {
    const all = await boardItems(page).count();
    await searchField(page).fill('#110');
    await expect(boardItems(page)).toHaveCount(1);
    await page.getByRole('button', { name: 'Effacer', exact: true }).click();
    await expect(searchField(page)).toHaveValue('');
    await expect(searchField(page)).toBeFocused();
    await expect(boardItems(page)).toHaveCount(all);

    // Escape in the field clears it too.
    await searchField(page).fill('&18');
    await expect(boardItems(page)).toHaveCount(1);
    await searchField(page).press('Escape');
    await expect(searchField(page)).toHaveValue('');
    await expect(boardItems(page)).toHaveCount(all);
  });

  test('no match shows an empty state that clears the search', async ({ page }) => {
    await searchField(page).fill('introuvable');
    await expect(page.getByText('Aucun résultat', { exact: true })).toBeVisible();
    await expect(boardItems(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Effacer la recherche' }).click();
    await expect(searchField(page)).toHaveValue('');
    await expect(item(page, '&18')).toBeVisible();
  });
});

test('"Masquer les issues fermées" hides the closed blockers #131 and #140', async ({ page }) => {
  await openWindowMenu(page);
  await page.getByRole('menuitemradio', { name: 'Toutes', exact: true }).click();
  await expectWindow(page, 'It. 12', 'It. 21');
  await expect(item(page, '#131')).toBeVisible();
  await expect(item(page, '#140')).toBeVisible();
  await expect(item(page, '#140')).toHaveAccessibleName(/, fermée$/);
  const issues = await summaryPart(page, 'issues').textContent();

  const hideClosed = displaySwitch(page, 'Masquer les issues fermées');
  await expect(hideClosed).toHaveAttribute('aria-checked', 'false');
  await hideClosed.click();
  await expect(hideClosed).toHaveAttribute('aria-checked', 'true');
  await expect(item(page, '#131')).toHaveCount(0);
  await expect(item(page, '#140')).toHaveCount(0);
  // The open blockers stay.
  await expect(item(page, '#110')).toBeVisible();
  expect(issues).toBe('10 issues bloquantes');
  await expect(summaryPart(page, 'issues')).toHaveText('8 issues bloquantes');

  await hideClosed.click();
  await expect(item(page, '#131')).toBeVisible();
  await expect(item(page, '#140')).toBeVisible();
});

test('the link-type checkboxes add and remove the links drawn on the whole board', async ({ page }) => {
  const blocks = linkTypeCheckbox(page, 'Bloque');
  const relates = linkTypeCheckbox(page, 'Lié à');
  const parent = linkTypeCheckbox(page, 'Epic parent → issue');

  // Default: blocks and relates on, parent off. Each counter is the checkbox's description.
  await expect(blocks).toBeChecked();
  await expect(relates).toBeChecked();
  await expect(parent).not.toBeChecked();
  await expect(blocks).toHaveAccessibleDescription('12');
  await expect(relates).toHaveAccessibleDescription('2');
  await expect(parent).toHaveAccessibleDescription('0');
  await expect(drawnLinks(page, 'blocks')).toHaveCount(12);
  await expect(drawnLinks(page, 'relates')).toHaveCount(2);
  await expect(drawnLinks(page, 'parent')).toHaveCount(0);

  // Parent → issue: one per shown issue whose parent epic is shown (#132's &23 is outside).
  await parent.check();
  await expect(parent).toHaveAccessibleDescription('8');
  await expect(drawnLinks(page, 'parent')).toHaveCount(8);

  await blocks.uncheck();
  await expect(blocks).toHaveAccessibleDescription('0');
  await expect(drawnLinks(page, 'blocks')).toHaveCount(0);
  // No block drawn: neither blocks nor conflicts in the summary.
  await expect(summaryLine(page)).toHaveText('4 couloirs · 8 epics · 9 issues bloquantes');

  await relates.uncheck();
  await expect(drawnLinks(page, 'relates')).toHaveCount(0);
  await expect(drawnLinks(page)).toHaveCount(8);

  await blocks.check();
  await expect(drawnLinks(page, 'blocks')).toHaveCount(12);
  await expect(summaryPart(page, 'blocks')).toHaveText('12 blocages');
});

test('the critical path switch highlights &19 → &18 → &21 and dims the rest', async ({ page }) => {
  const canvas = page.locator('[data-critical-path]');
  const critical = displaySwitch(page, 'Chemin critique');
  await expect(critical).toHaveAttribute('aria-checked', 'false');
  await expect(critical).toHaveAccessibleDescription('Plus longue chaîne de blocages ouverts');
  await expect(canvas).toHaveCount(0);

  await critical.click();
  await expect(critical).toHaveAttribute('aria-checked', 'true');
  await expect(canvas).toHaveCount(1);
  // &19 → &18 → &21 → &23; &23 is outside the window, so two links and three items are marked.
  const marked = boardItems(page).and(page.locator('[data-critical]'));
  await expect(marked).toHaveCount(3);
  for (const ref of ['&19', '&18', '&21']) await expect(item(page, ref)).toHaveAttribute('data-critical', 'true');
  await expect(drawnLinks(page).and(page.locator('[data-critical]'))).toHaveCount(2);
  // The rest is dimmed, the path is not.
  await expect.poll(() => isDimmed(item(page, '&12'))).toBe(true);
  await expect.poll(() => isDimmed(item(page, '#110'))).toBe(true);
  await expect.poll(() => isDimmed(item(page, '&18'))).toBe(false);

  // With the whole cadence in the window, &23 joins the path.
  await openWindowMenu(page);
  await page.getByRole('menuitemradio', { name: 'Toutes', exact: true }).click();
  await expect(item(page, '&23')).toHaveAttribute('data-critical', 'true');
  await expect(drawnLinks(page).and(page.locator('[data-critical]'))).toHaveCount(3);

  await critical.click();
  await expect(canvas).toHaveCount(0);
  await expect.poll(() => isDimmed(item(page, '&12'))).toBe(false);
});

test('conflicts are counted in the summary and drawn as conflict links', async ({ page }) => {
  // #107 → &15, &13 → &17 and &18 → &21: the blocker ends after the blocked item starts.
  await expect(summaryPart(page, 'conflicts')).toHaveText('3 conflits');
  await expect(summaryPart(page, 'conflicts')).toHaveAttribute('data-alert', 'true');
  const conflicts = drawnLinks(page).and(page.locator('[data-conflict]'));
  await expect(conflicts).toHaveCount(3);
  await expect(conflicts.and(page.locator('[data-type="blocks"]'))).toHaveCount(3);

  // Selecting &15 connects its conflict link (#107 → &15).
  await item(page, '&15').click();
  await expect(item(page, '&15')).toHaveAttribute('aria-pressed', 'true');
  await expect(drawnLinks(page).and(page.locator('[data-conflict][data-connected]'))).toHaveCount(1);

  // Moving the window past #107 (It. 16) leaves two conflicts.
  await page.keyboard.press('Escape');
  await expect(item(page, '&15')).toHaveAttribute('aria-pressed', 'false');
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Itération suivante' }).click();
  await expectWindow(page, 'It. 17', 'It. 21');
  await expect(item(page, '#107')).toHaveCount(0);
  await expect(summaryPart(page, 'conflicts')).toHaveText('2 conflits');
  await expect(conflicts).toHaveCount(2);
});

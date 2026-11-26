import { expect, test } from '@playwright/test';
import { drawnLinks, summaryPart } from './helpers';
import { boardItem, inspector, openBoard, setIssueMode, sidebar } from './helpers2';
import { ref, title } from './demo';

// The issue mode of a lane (spec §4.4, §5.1, ADR-35): « Toutes » the issues of its groups,
// « Bloquantes » (the default) only those that block an epic, « Aucune » none. The backend
// sends every issue; the lane picks. In the demo, Expérience produit holds two issues that block
// no epic in the default window, #106 → #108, and two that block one, #113 and #125.

test.beforeEach(async ({ page }) => {
  await openBoard(page);
});

const lane = 'Expérience produit';

test('« Bloquantes » is the default: issues that block no epic are not drawn', async ({ page }) => {
  await expect(page.getByRole('region', { name: lane })).toContainText('issues bloquantes');
  await expect(boardItem(page, '#113')).toBeVisible();
  await expect(boardItem(page, '#125')).toBeVisible();
  for (const key of ['#106', '#108']) await expect(boardItem(page, key)).toHaveCount(0);
  await expect(summaryPart(page, 'issues')).toHaveText('9 issues');
});

test('« Toutes » draws the issues that block no epic, marked so, with their links', async ({ page }) => {
  await setIssueMode(page, lane, 'Toutes');
  await expect(page.getByRole('region', { name: lane })).toContainText('toutes les issues');
  for (const key of ['#106', '#108']) {
    await expect(boardItem(page, key)).toBeVisible();
    await expect(boardItem(page, key)).toContainText('Ne bloque aucun epic');
  }
  // The blocking ones still say what they block.
  await expect(boardItem(page, '#113')).toContainText(`Bloque ${ref('&17')}`);
  await expect(summaryPart(page, 'issues')).toHaveText('11 issues');
  // #106 blocks #108: one more blocking link, drawn and connected to #106 when selected.
  await expect(summaryPart(page, 'blocks')).toHaveText('13 blocages');
  await expect(drawnLinks(page, 'blocks')).toHaveCount(13);
  await boardItem(page, '#106').click();
  await expect(drawnLinks(page, 'blocks').and(page.locator('[data-connected]'))).toHaveCount(1);
  const blocks = inspector(page).getByRole('group', { name: 'Bloque', exact: true });
  await expect(blocks.getByRole('button').filter({ hasText: title('#108') })).toBeVisible();

  // Only this lane changed: API et intégrations keeps its blocking issues only.
  await expect(boardItem(page, '#109')).toHaveCount(0);
});

test('« Aucune » leaves a lane without issues, its epics stay', async ({ page }) => {
  await setIssueMode(page, lane, 'Aucune');
  const header = page.getByRole('region', { name: lane });
  await expect(header).toContainText('aucune issue');
  for (const key of ['#106', '#108', '#113', '#125']) await expect(boardItem(page, key)).toHaveCount(0);
  await expect(boardItem(page, '&15')).toBeVisible();
  await expect(summaryPart(page, 'issues')).toHaveText('7 issues');
  // The other lanes keep theirs.
  await expect(boardItem(page, '#110')).toBeVisible();

  await setIssueMode(page, lane, 'Bloquantes');
  await expect(boardItem(page, '#113')).toBeVisible();
  await expect(summaryPart(page, 'issues')).toHaveText('9 issues');
});

test('the sidebar tells how many synced issues block an epic, whatever the modes', async ({ page }) => {
  const count = sidebar(page).getByText('10 sur 19 issues synchronisées bloquent un epic.', { exact: true });
  await expect(count).toBeVisible();
  await setIssueMode(page, lane, 'Toutes');
  await expect(count).toBeVisible();
});

test('the search reaches the issues a lane shows in « Toutes » mode', async ({ page }) => {
  await setIssueMode(page, lane, 'Toutes');
  await page.getByRole('searchbox', { name: 'Rechercher un epic ou une issue' }).fill(title('#106'));
  await expect(boardItem(page, '#106')).toBeVisible();
  // #108, which it blocks, comes along as its dependency (ADR-30).
  await expect(boardItem(page, '#108')).toHaveAttribute('data-search-context', /.*/);
});

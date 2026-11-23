import { expect, test } from '@playwright/test';
import { boardItem, clickEmptyCanvas, fact, inspector, isDimmed, openBoard, windowButton } from './helpers2';

// Selection and the inspector (spec §4.6), on the demo data. Default window: It. 14 – It. 18.

test.beforeEach(async ({ page }) => {
  await openBoard(page);
});

test('selecting an epic highlights its dependencies and dims the rest', async ({ page }) => {
  const epic = boardItem(page, '&18');
  await expect(epic).toHaveAttribute('aria-pressed', 'false');
  await epic.click();
  await expect(epic).toHaveAttribute('aria-pressed', 'true');

  // Linked items stay bright; an unrelated one (&15) is dimmed.
  for (const ref of ['&18', '&21', '&12', '#114']) await expect.poll(() => isDimmed(boardItem(page, ref))).toBe(false);
  await expect.poll(() => isDimmed(boardItem(page, '&15'))).toBe(true);
  await expect(boardItem(page, '&15')).toHaveAttribute('aria-pressed', 'false');
});

test('the inspector shows an epic in full', async ({ page, request }) => {
  const board = await (await request.get('/api/board')).json();
  const webUrl = board.epics.find((e: { ref: string }) => e.ref === '&18').webUrl as string;

  await boardItem(page, '&18').click();
  const panel = inspector(page);
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Epic', { exact: true })).toBeVisible();
  await expect(panel.getByText('&18', { exact: true })).toBeVisible();
  await expect(panel.getByText('Ouvert', { exact: true })).toBeVisible();
  await expect(panel.getByRole('heading', { name: "API d'export des données" })).toBeVisible();
  await expect(fact(panel, 'Groupe')).toContainText('API & intégrations');
  await expect(fact(panel, 'Groupe')).toContainText('plateforme/atlas/api');
  await expect(fact(panel, 'Couloirs')).toHaveText('API & intégrations');
  await expect(fact(panel, 'Période')).toHaveText('It. 16 → It. 18');
  await expect(panel.getByRole('listitem').filter({ hasText: /^API$/ })).toBeVisible();
  await expect(panel.getByRole('listitem').filter({ hasText: /^backend$/ })).toBeVisible();

  const blocks = panel.getByRole('group', { name: 'Bloque', exact: true });
  await expect(blocks.getByRole('button')).toHaveCount(2);
  await expect(blocks.getByRole('button').filter({ hasText: '&22' })).toBeVisible();
  await expect(blocks.getByRole('button').filter({ hasText: '&21' })).toBeVisible();
  const byEpics = panel.getByRole('group', { name: 'Bloqué par (epics)' });
  await expect(byEpics.getByRole('button').filter({ hasText: '&12' })).toBeVisible();
  await expect(byEpics.getByRole('button').filter({ hasText: '&19' })).toBeVisible();
  const byIssues = panel.getByRole('group', { name: 'Bloqué par (issues)' });
  await expect(byIssues.getByRole('button').filter({ hasText: '#114' })).toBeVisible();
  await expect(byIssues.getByRole('button').filter({ hasText: '#140' })).toBeVisible();
  // &18 relates to nothing: no empty "Lié à" group.
  await expect(panel.getByRole('group', { name: 'Lié à' })).toHaveCount(0);

  const link = panel.getByRole('link', { name: 'Ouvrir dans GitLab' });
  await expect(link).toHaveAttribute('href', webUrl);
  await expect(link).toHaveAttribute('target', '_blank');
});

test('an epic with related items lists them under "Lié à"', async ({ page }) => {
  await boardItem(page, '&17').click();
  const relates = inspector(page).getByRole('group', { name: 'Lié à' });
  await expect(relates.getByRole('button').filter({ hasText: '&15' })).toBeVisible();
  await expect(relates.getByRole('button').filter({ hasText: '&24' })).toBeVisible();
  const byIssues = inspector(page).getByRole('group', { name: 'Bloqué par (issues)' });
  await expect(byIssues.getByRole('button').filter({ hasText: '#113' })).toBeVisible();
  await expect(byIssues.getByRole('button').filter({ hasText: '#125' })).toBeVisible();
});

test('a conflicting dependency is flagged "Conflit"', async ({ page }) => {
  await boardItem(page, '&18').click();
  const blocks = inspector(page).getByRole('group', { name: 'Bloque', exact: true });
  await expect(blocks.getByRole('button').filter({ hasText: '&21' })).toContainText('Conflit');
  await expect(blocks.getByRole('button').filter({ hasText: '&22' })).not.toContainText('Conflit');
});

test('selecting an issue shows its iteration, parent epic and assignee', async ({ page }) => {
  await boardItem(page, '#110').click();
  await expect(boardItem(page, '#110')).toHaveAttribute('aria-pressed', 'true');
  const panel = inspector(page);
  await expect(panel.getByText('Issue', { exact: true })).toBeVisible();
  await expect(panel.getByText('#110', { exact: true })).toBeVisible();
  await expect(panel.getByText('Ouverte', { exact: true })).toBeVisible();
  await expect(fact(panel, 'Itération')).toContainText('Itération 17');
  await expect(fact(panel, 'Epic parent')).toContainText('&18');
  await expect(fact(panel, 'Assigné·e')).toHaveText('Sofia Nguyen');
  await expect(panel.getByRole('group', { name: 'Bloque', exact: true }).getByRole('button').filter({ hasText: '&21' })).toBeVisible();

  // The parent epic link selects it.
  await fact(panel, 'Epic parent').getByRole('button').click();
  await expect(boardItem(page, '&18')).toHaveAttribute('aria-pressed', 'true');
  await expect(fact(panel, 'Période')).toHaveText('It. 16 → It. 18');
});

test.describe('clearing the selection', () => {
  test.beforeEach(async ({ page }) => {
    await boardItem(page, '&18').click();
    await expect(inspector(page)).toBeVisible();
  });

  const expectCleared = async (page: import('@playwright/test').Page) => {
    await expect(inspector(page)).toBeHidden();
    await expect(boardItem(page, '&18')).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => isDimmed(boardItem(page, '&15'))).toBe(false);
  };

  test('clicking the item again', async ({ page }) => {
    await boardItem(page, '&18').click();
    await expectCleared(page);
  });

  test('clicking the empty canvas', async ({ page }) => {
    await clickEmptyCanvas(page);
    await expectCleared(page);
  });

  test('the close button', async ({ page }) => {
    await inspector(page).getByRole('button', { name: 'Fermer le détail' }).click();
    await expectCleared(page);
  });

  test('Escape', async ({ page }) => {
    await page.keyboard.press('Escape');
    await expectCleared(page);
  });
});

test('a dependency outside the window moves the window to it and selects it', async ({ page }) => {
  await expect(windowButton(page)).toHaveAccessibleName('Fenêtre : It. 14 – It. 18');
  await expect(boardItem(page, '&22')).toHaveCount(0);

  await boardItem(page, '&18').click();
  const row = inspector(page).getByRole('group', { name: 'Bloque', exact: true }).getByRole('button').filter({ hasText: '&22' });
  await expect(row).toContainText('It. 19 → It. 21');
  await row.click();

  // Same width (5 iterations), shifted so &22 (It. 19 → It. 21) shows.
  await expect(windowButton(page)).toHaveAccessibleName('Fenêtre : It. 17 – It. 21');
  const epic = boardItem(page, '&22');
  await expect(epic).toHaveAttribute('aria-pressed', 'true');
  await expect(epic).toBeInViewport();
  await expect(inspector(page).getByText('&22', { exact: true })).toBeVisible();
  await expect(fact(inspector(page), 'Période')).toHaveText('It. 19 → It. 21');
});

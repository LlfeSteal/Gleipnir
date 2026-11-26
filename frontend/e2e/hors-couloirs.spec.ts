import { expect, test } from '@playwright/test';
import { linkTypeCheckbox } from './helpers';
import {
  applyLaneSettings,
  boardItem,
  groupOption,
  inspector,
  laneBox,
  laneSettings,
  openBoard,
  setIssueMode,
  sidebar,
} from './helpers2';
import { ref, root, title } from './demo';

// Dependencies outside the lanes (spec §4.5, §4.6, ADR-37): a « Bloque » or « Lié à » link to an
// item that matches no active lane is not drawn; the item shown carries a dotted badge, and the
// inspector lists the other end as « Hors couloirs · <groupe> », not clickable. In the demo,
// &26 lives in the root group itself, which no default lane covers, and blocks &21 (Data). An
// item a lane's own rule leaves out counts too: #109, which blocks no epic, blocks #110.

test.beforeEach(async ({ page }) => {
  await openBoard(page);
});

test('an epic linked to an item in no active lane carries « 1 hors couloirs »', async ({ page }) => {
  const epic = boardItem(page, '&21');
  const badge = epic.getByText('1 hors couloirs', { exact: true });
  await expect(badge).toBeVisible();
  await expect(badge).toHaveAttribute('title', `Dépendance hors couloirs : ${ref('&26')}`);
  await expect(epic).toHaveAttribute('aria-description', new RegExp(`Dépendance hors couloirs : ${ref('&26').replace('&', '\\&')}`));
  await expect(boardItem(page, '&26')).toHaveCount(0);
  // No other epic has one (issue cards show the number only).
  await expect(page.getByText(/^\d+ hors couloirs$/)).toHaveCount(1);
  // The legend explains it.
  await expect(sidebar(page).getByText('Dépendances dans aucun couloir actif', { exact: true })).toBeVisible();
});

test('only the link types shown count', async ({ page }) => {
  await linkTypeCheckbox(page, 'Bloque').uncheck();
  await expect(boardItem(page, '&21').getByText('1 hors couloirs')).toHaveCount(0);
  await linkTypeCheckbox(page, 'Bloque').check();
  await expect(boardItem(page, '&21').getByText('1 hors couloirs')).toBeVisible();
});

test('the inspector lists it as « Hors couloirs », with its group, not clickable', async ({ page }) => {
  await boardItem(page, '&21').click();
  const byEpics = inspector(page).getByRole('group', { name: 'Bloqué par (epics)' });
  const row = byEpics.getByRole('listitem').filter({ hasText: title('&26') });
  await expect(row).toContainText(ref('&26'));
  await expect(row).toContainText(`Hors couloirs · ${root().name}`);
  await expect(row.getByRole('button')).toHaveCount(0);
  // The other dependencies stay buttons.
  await expect(byEpics.getByRole('button').filter({ hasText: title('&18') })).toBeVisible();
});

test('a lane on the root group takes &26 in, and the badge goes', async ({ page }) => {
  await sidebar(page).getByRole('button', { name: 'Nouveau couloir' }).click();
  const sheet = laneSettings(page);
  await sheet.getByRole('textbox', { name: 'Nom' }).fill('Transverse');
  await groupOption(sheet, '').click();
  // The root alone: its subgroups have their own lanes.
  await sheet.getByRole('switch', { name: 'Inclure les sous-groupes' }).click();
  await expect(sheet.getByRole('switch', { name: 'Inclure les sous-groupes' })).not.toBeChecked();
  await applyLaneSettings(sheet);

  await expect(boardItem(page, '&26')).toBeVisible();
  await expect(boardItem(page, '&21').getByText('1 hors couloirs')).toHaveCount(0);
  await boardItem(page, '&21').click();
  const byEpics = inspector(page).getByRole('group', { name: 'Bloqué par (epics)' });
  await expect(byEpics.getByRole('button').filter({ hasText: title('&26') })).toBeVisible();
});

test('an item excluded by its lane\'s rule counts as hors couloirs: the issue card shows the icon and the number', async ({ page }) => {
  // #109 blocks #110 but blocks no epic: the API lane, in « Bloquantes » mode, leaves it out and
  // no other lane takes it (spec §4.5).
  const card = boardItem(page, '#110');
  const badge = card.locator('.off-lanes-pill');
  await expect(badge).toHaveText('1');
  await expect(badge).toHaveAttribute('title', `Dépendance hors couloirs : ${ref('#109')}`);
  await expect(card).toHaveAttribute('aria-description', /Dépendance hors couloirs/);

  // « Toutes » takes #109 in: the badge goes.
  await setIssueMode(page, 'API et intégrations', 'Toutes');
  await expect(boardItem(page, '#109')).toBeVisible();
  await expect(badge).toHaveCount(0);

  // Hiding the Data lane puts &21, which #110 blocks, out of every active lane.
  await laneBox(page, 'Data').uncheck();
  await expect(badge).toHaveText('1');
  await expect(badge).toHaveAttribute('title', `Dépendance hors couloirs : ${ref('&21')}`);
  // On an epic, the full label: &18 blocks &21 too.
  await expect(boardItem(page, '&18').getByText('1 hors couloirs', { exact: true })).toBeVisible();
  await boardItem(page, '#110').click();
  const blocks = inspector(page).getByRole('group', { name: 'Bloque', exact: true });
  await expect(blocks.getByRole('listitem').filter({ hasText: title('&21') })).toContainText('Hors couloirs · Data');
});

import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import {
  applyLaneSettings,
  boardItem,
  boardItems,
  boardLanes,
  DEFAULT_LANES,
  groupOption,
  issueModeRadio,
  laneBox,
  laneSettings,
  openBoard,
  openLaneSettings,
  selectSettingsLane,
  settingsLane,
  showAllIterations,
  sidebar,
} from './helpers2';
import { itemName, summaryPart } from './helpers';
import { title } from './demo';

// Lanes (spec §4.4, ADR-34): editable filters on the GitLab groups, item types and labels, kept
// in the browser. By default one per subgroup of the root, subgroups included, issues that
// block an epic only. Lanes may overlap: an item shows in every lane it matches, and is counted
// once. The demo has one nested group, Partenaires (under API et intégrations), holding &22.

test.beforeEach(async ({ page }) => {
  await openBoard(page);
  await expect.poll(() => boardLanes(page)).toEqual(DEFAULT_LANES);
});

/** Every drawn occurrence of an item (one per lane it shows in). */
const occurrences = (page: Page, key: string) => page.getByRole('button', { name: itemName(key) });

/** The lanes an item is drawn in, by the vertical extent of the lane headers. */
async function lanesOf(page: Page, key: string): Promise<string[]> {
  const headers = page.locator('.lane-rail section[aria-label]');
  const boxes = await headers.evaluateAll((els) =>
    els.map((el) => ({ name: el.getAttribute('aria-label') ?? '', top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom })),
  );
  const items = await occurrences(page, key).evaluateAll((els) =>
    els.map((el) => {
      const box = el.getBoundingClientRect();
      return box.top + box.height / 2;
    }),
  );
  return items.map((y) => boxes.find((b) => y >= b.top && y < b.bottom)?.name ?? '?');
}

async function editLane(page: Page, name: string): Promise<Locator> {
  await page.getByRole('button', { name: `Modifier le couloir ${name}`, exact: true }).click();
  const sheet = laneSettings(page);
  await expect(sheet.getByRole('textbox', { name: 'Nom' })).toHaveValue(name);
  return sheet;
}

test('the default lanes: one per subgroup of the root, subgroups included, blocking issues only', async ({ page }) => {
  for (const name of DEFAULT_LANES) await expect(laneBox(page, name)).toBeChecked();
  const lanes = sidebar(page).getByRole('checkbox');
  // The four lanes and the three link types: the GitLab group tree is no longer in the sidebar.
  await expect(lanes).toHaveCount(DEFAULT_LANES.length + 3);
  await expect(sidebar(page).getByRole('button', { name: 'Nouveau couloir' })).toBeVisible();

  // The header tells the lane's groups and issue mode.
  const api = page.getByRole('region', { name: 'API et intégrations' });
  await expect(api).toContainText('API et intégrations + sous-groupes');
  await expect(api).toContainText('issues bloquantes');

  const sheet = await openLaneSettings(page);
  await expect(sheet.getByRole('list', { name: 'Liste des couloirs' }).getByRole('listitem')).toHaveCount(DEFAULT_LANES.length);
  await selectSettingsLane(sheet, 'API et intégrations');
  await expect(groupOption(sheet, 'api')).toHaveAttribute('aria-selected', 'true');
  await expect(groupOption(sheet, 'api/partenaires')).toHaveAttribute('aria-selected', 'false');
  await expect(sheet.getByRole('switch', { name: 'Inclure les sous-groupes' })).toBeChecked();
  await expect(sheet.getByRole('switch', { name: 'Epics' })).toBeChecked();
  await expect(issueModeRadio(sheet, 'Bloquantes')).toBeChecked();
});

test('the nested group sits in its parent\'s lane while subgroups are included', async ({ page }) => {
  await showAllIterations(page);
  await expect.poll(() => lanesOf(page, '&22')).toEqual(['API et intégrations']);

  const sheet = await editLane(page, 'API et intégrations');
  await sheet.getByRole('switch', { name: 'Inclure les sous-groupes' }).click();
  await applyLaneSettings(sheet);
  await expect(occurrences(page, '&22')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'API et intégrations' })).not.toContainText('+ sous-groupes');
  await expect(boardItem(page, '&18')).toBeVisible();
});

test('« Nouveau couloir » creates a lane, which needs a group before it applies', async ({ page }) => {
  await showAllIterations(page);
  await sidebar(page).getByRole('button', { name: 'Nouveau couloir' }).click();
  const sheet = laneSettings(page);
  await expect(sheet).toBeVisible();
  const name = sheet.getByRole('textbox', { name: 'Nom' });
  await expect(name).toHaveValue('Nouveau couloir');
  // No group yet: nothing to apply.
  await expect(sheet.getByText('Chaque couloir doit avoir au moins un groupe.')).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Appliquer', exact: true })).toBeDisabled();

  await name.fill('Partenaires');
  await groupOption(sheet, 'api/partenaires').click();
  await expect(sheet.getByRole('button', { name: 'Appliquer', exact: true })).toBeEnabled();
  await applyLaneSettings(sheet);

  await expect.poll(() => boardLanes(page)).toEqual([...DEFAULT_LANES, 'Partenaires']);
  await expect(laneBox(page, 'Partenaires')).toBeChecked();
  // &22 is in both lanes now: API et intégrations (subgroups included) and Partenaires.
  await expect.poll(() => lanesOf(page, '&22')).toEqual(['API et intégrations', 'Partenaires']);
});

test('lanes may overlap: an item shows in each lane it matches, and is counted once', async ({ page }) => {
  const epics = await summaryPart(page, 'epics').textContent();
  const issues = await summaryPart(page, 'issues').textContent();
  const before = await boardItems(page).count();

  // A second lane on the Data group.
  await sidebar(page).getByRole('button', { name: 'Nouveau couloir' }).click();
  const sheet = laneSettings(page);
  await sheet.getByRole('textbox', { name: 'Nom' }).fill('Data bis');
  await groupOption(sheet, 'data').click();
  await applyLaneSettings(sheet);

  await expect.poll(() => lanesOf(page, '&21')).toEqual(['Data', 'Data bis']);
  await expect.poll(() => lanesOf(page, '#130')).toEqual(['Data', 'Data bis']);
  // Drawn twice, counted once.
  expect(await boardItems(page).count()).toBeGreaterThan(before);
  await expect(summaryPart(page, 'lanes')).toHaveText('5 couloirs');
  await expect(summaryPart(page, 'epics')).toHaveText(epics!);
  await expect(summaryPart(page, 'issues')).toHaveText(issues!);

  // The inspector lists both lanes.
  await occurrences(page, '&21').first().click();
  const lanes = page.getByRole('complementary', { name: 'Détail de l’élément' }).getByRole('term').filter({ hasText: /^Couloirs$/ });
  await expect(lanes.locator('xpath=following-sibling::dd[1]')).toHaveText(/Data\s*Data bis/);
});

test('editing a lane: its name and its groups', async ({ page }) => {
  const sheet = await editLane(page, 'Data');
  await sheet.getByRole('textbox', { name: 'Nom' }).fill('Data et identité');
  await groupOption(sheet, 'identite').click();
  // The list follows the draft.
  await expect(settingsLane(sheet, 'Data et identité')).toBeVisible();
  await applyLaneSettings(sheet);

  await expect.poll(() => boardLanes(page)).toEqual(['API et intégrations', 'Data et identité', 'Expérience produit', 'Identité et sécurité']);
  await expect(laneBox(page, 'Data et identité')).toBeChecked();
  await expect(page.getByRole('region', { name: 'Data et identité' })).toContainText('Data, Identité et sécurité');
  // &12 (Identité et sécurité) is now in both lanes.
  await expect.poll(() => lanesOf(page, '&12')).toEqual(['Data et identité', 'Identité et sécurité']);
});

test('reordering and deleting lanes', async ({ page }) => {
  const sheet = await openLaneSettings(page);
  await settingsLane(sheet, 'Data').getByRole('button', { name: 'Monter Data' }).click();
  await settingsLane(sheet, 'Identité et sécurité').getByRole('button', { name: 'Supprimer Identité et sécurité' }).click();
  await expect(settingsLane(sheet, 'Identité et sécurité')).toHaveCount(0);
  // The first lane cannot go up, the last one cannot go down.
  await expect(settingsLane(sheet, 'Data').getByRole('button', { name: 'Monter Data' })).toBeDisabled();
  await expect(settingsLane(sheet, 'Expérience produit').getByRole('button', { name: 'Descendre Expérience produit' })).toBeDisabled();
  await applyLaneSettings(sheet);

  await expect.poll(() => boardLanes(page)).toEqual(['Data', 'API et intégrations', 'Expérience produit']);
  await expect(laneBox(page, 'Identité et sécurité')).toHaveCount(0);
  await expect(occurrences(page, '&12')).toHaveCount(0);
});

test('« Annuler » and Escape leave the board unchanged', async ({ page }) => {
  for (const close of ['Annuler', 'Escape']) {
    const sheet = await openLaneSettings(page);
    await settingsLane(sheet, 'Data').getByRole('button', { name: 'Supprimer Data' }).click();
    await sheet.getByRole('button', { name: 'Nouveau couloir' }).click();
    if (close === 'Escape') await page.keyboard.press('Escape');
    else await sheet.getByRole('button', { name: 'Annuler', exact: true }).click();
    await expect(sheet).toBeHidden();
    await expect.poll(() => boardLanes(page)).toEqual(DEFAULT_LANES);
    await expect(boardItem(page, '&21')).toBeVisible();
  }
  // Nothing was stored.
  expect(await page.evaluate(() => localStorage.getItem('gleipnir.lanes'))).toBeNull();
});

test('« Rétablir la configuration d’exemple » brings the default lanes back', async ({ page }) => {
  let sheet = await openLaneSettings(page);
  for (const name of ['Data', 'Expérience produit']) {
    await settingsLane(sheet, name).getByRole('button', { name: `Supprimer ${name}` }).click();
  }
  await applyLaneSettings(sheet);
  await expect.poll(() => boardLanes(page)).toEqual(['API et intégrations', 'Identité et sécurité']);

  sheet = await openLaneSettings(page);
  await sheet.getByRole('button', { name: 'Rétablir la configuration d’exemple' }).click();
  await expect(sheet.getByRole('list', { name: 'Liste des couloirs' }).getByRole('listitem')).toHaveCount(DEFAULT_LANES.length);
  await applyLaneSettings(sheet);
  await expect.poll(() => boardLanes(page)).toEqual(DEFAULT_LANES);
});

test('« Modifier » on a lane header opens the sheet on that lane', async ({ page }) => {
  const sheet = await editLane(page, 'Expérience produit');
  await expect(settingsLane(sheet, 'Expérience produit').getByRole('button', { name: /^Expérience produit/ })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect(groupOption(sheet, 'experience')).toHaveAttribute('aria-selected', 'true');
  await sheet.getByRole('button', { name: 'Annuler', exact: true }).click();
  // The sidebar's pencil too.
  await sidebar(page).getByRole('button', { name: 'Modifier Data', exact: true }).click();
  await expect(laneSettings(page).getByRole('textbox', { name: 'Nom' })).toHaveValue('Data');
});

test('unchecking a lane in the sidebar hides it, through a reload', async ({ page }) => {
  await laneBox(page, 'Data').uncheck();
  await expect.poll(() => boardLanes(page)).toEqual(DEFAULT_LANES.filter((name) => name !== 'Data'));
  await expect(occurrences(page, '&21')).toHaveCount(0);

  await page.reload();
  await expect(boardItem(page, '&18')).toBeVisible();
  await expect(laneBox(page, 'Data')).not.toBeChecked();
  await expect(occurrences(page, '&21')).toHaveCount(0);

  await laneBox(page, 'Data').check();
  await expect.poll(() => boardLanes(page)).toEqual(DEFAULT_LANES);
  await expect(boardItem(page, '&21')).toBeVisible();
});

test('without an active lane, an empty state opens the lane settings', async ({ page }) => {
  for (const name of DEFAULT_LANES) await laneBox(page, name).uncheck();
  await expect(page.getByText('Aucun couloir affiché')).toBeVisible();
  await page.getByRole('button', { name: 'Configurer les couloirs' }).click();
  const sheet = laneSettings(page);
  await expect(sheet).toBeVisible();
  await settingsLane(sheet, 'Data').getByRole('checkbox', { name: 'Afficher Data' }).check();
  await applyLaneSettings(sheet);
  await expect.poll(() => boardLanes(page)).toEqual(['Data']);
});

test('a lane\'s labels filter its epics and issues: "priorité::haute", then with "bug" too', async ({ page }) => {
  // One lane on the whole group, labelled; the others hidden.
  await sidebar(page).getByRole('button', { name: 'Nouveau couloir' }).click();
  const sheet = laneSettings(page);
  await sheet.getByRole('textbox', { name: 'Nom' }).fill('Urgent');
  await groupOption(sheet, '').click();
  // A new lane includes the subgroups by default.
  await expect(sheet.getByRole('switch', { name: 'Inclure les sous-groupes' })).toBeChecked();
  const labels = sheet.getByRole('listbox', { name: 'Labels', exact: true });
  await labels.getByRole('option', { name: 'priorité::haute', exact: true }).click();
  for (const name of DEFAULT_LANES) await settingsLane(sheet, name).getByRole('checkbox', { name: `Afficher ${name}` }).uncheck();
  await applyLaneSettings(sheet);

  await expect.poll(() => boardLanes(page)).toEqual(['Urgent']);
  await expect(page.getByRole('region', { name: 'Urgent' })).toContainText('priorité::haute');
  await expect(page.getByRole('region', { name: 'Urgent' })).toContainText('· au moins un');
  await expect(boardItems(page)).toHaveCount(2);
  await expect(boardItem(page, '#104')).toBeVisible();
  await expect(boardItem(page, '#113')).toBeVisible();

  // "Tous" with "bug" too: both issues carry both labels.
  const again = await editLane(page, 'Urgent');
  await again.getByRole('listbox', { name: 'Labels', exact: true }).getByRole('option', { name: 'bug', exact: true }).click();
  await again.getByRole('radiogroup', { name: 'Correspondance des labels' }).getByRole('radio', { name: 'Tous' }).click();
  await applyLaneSettings(again);
  await expect(page.getByRole('region', { name: 'Urgent' })).toContainText('· tous');
  await expect(boardItems(page)).toHaveCount(2);
});

test('many labels: the header shows two, then « et 3 autres… », whose card lists them all (spec §4.1)', async ({ page }) => {
  const picked = ['priorité::haute', 'sécurité', 'frontend', 'backend', 'mobile'];
  const sheet = await editLane(page, 'API et intégrations');
  const labels = sheet.getByRole('listbox', { name: 'Labels', exact: true });
  for (const title of picked) await labels.getByRole('option', { name: title, exact: true }).click();
  await applyLaneSettings(sheet);

  const header = page.getByRole('region', { name: 'API et intégrations' });
  const more = header.getByRole('button', { name: 'et 3 autres…' });
  await expect(more).toBeVisible();
  await expect(header).toContainText('· au moins un');
  // The label line stays inside the rail: no overlap, no clipped chip.
  const line = header.locator('.lane-labels');
  expect(await line.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

  await more.hover();
  const card = page.getByRole('tooltip');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Labels du couloir');
  for (const title of picked) await expect(card.getByRole('listitem').filter({ hasText: title })).toHaveCount(1);
  await expect(card).toContainText('Au moins un de ces labels');
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();

  // The keyboard reaches it too.
  await more.focus();
  await expect(card).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
});

test('« Epics » off hides a lane\'s epics, its issues stay', async ({ page }) => {
  const sheet = await editLane(page, 'API et intégrations');
  await sheet.getByRole('switch', { name: 'Epics' }).click();
  await applyLaneSettings(sheet);
  await expect(occurrences(page, '&18')).toHaveCount(0);
  await expect(boardItem(page, '#110')).toBeVisible();
  // The other lanes keep theirs.
  await expect(boardItem(page, '&21')).toBeVisible();
  await expect(page.getByText(title('&18'), { exact: true })).toHaveCount(0);
});

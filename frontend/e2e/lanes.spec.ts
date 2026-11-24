import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { boardItem, boardItems, boardLanes, DEFAULT_LANES, laneSheet, openBoard, sidebar } from './helpers2';
import { group, root } from './demo';
import { itemName } from './helpers';

// Lane settings (spec §4.4) and the sidebar's lane list (§4.8). The sheet edits a draft:
// nothing changes on the board before "Appliquer".

test.beforeEach(async ({ page }) => {
  await openBoard(page);
  await expect.poll(() => boardLanes(page)).toEqual(DEFAULT_LANES);
});

async function storedLaneNames(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('gleipnir.lanes');
    return raw ? (JSON.parse(raw) as { name: string }[]).map((lane) => lane.name) : [];
  });
}

test('the settings sheet opens from "Modifier…", a lane pencil and "Nouveau couloir"', async ({ page }) => {
  const sheet = laneSheet(page);

  await sidebar(page).getByRole('button', { name: 'Modifier…' }).click();
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('textbox', { name: 'Nom' })).toHaveValue('API et intégrations');
  await sheet.getByRole('button', { name: 'Annuler' }).click();
  await expect(sheet).toBeHidden();

  // The pencil of a lane header on the board opens the sheet on that lane.
  await page.getByRole('button', { name: 'Modifier le couloir Data' }).click();
  await expect(sheet.getByRole('textbox', { name: 'Nom' })).toHaveValue('Data');
  await sheet.getByRole('button', { name: 'Fermer' }).click();
  await expect(sheet).toBeHidden();

  // And so does the sidebar's.
  await sidebar(page).getByRole('button', { name: 'Modifier Expérience produit' }).click();
  await expect(sheet.getByRole('textbox', { name: 'Nom' })).toHaveValue('Expérience produit');
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  // "Nouveau couloir" adds a lane to the draft and opens it.
  await sidebar(page).getByRole('button', { name: 'Nouveau couloir' }).click();
  await expect(sheet.getByRole('textbox', { name: 'Nom' })).toHaveValue('Nouveau couloir');
  await expect(sheet.getByRole('checkbox', { name: /^Afficher / })).toHaveCount(5);
});

test('Annuler and Escape discard every change', async ({ page }) => {
  const sheet = laneSheet(page);
  const editAndDiscard = async (discard: () => Promise<void>) => {
    await sidebar(page).getByRole('button', { name: 'Modifier…' }).click();
    await sheet.getByRole('textbox', { name: 'Nom' }).fill('Renommé');
    await sheet.getByRole('button', { name: 'Descendre Renommé' }).click();
    await sheet.getByRole('button', { name: 'Supprimer Data' }).click();
    await sheet.getByRole('button', { name: 'Nouveau couloir', exact: true }).click();
    await discard();
    await expect(sheet).toBeHidden();
    await expect.poll(() => boardLanes(page)).toEqual(DEFAULT_LANES);
    await expect(sidebar(page).getByRole('checkbox')).toHaveCount(3 + DEFAULT_LANES.length); // + 3 link types
  };

  await editAndDiscard(() => sheet.getByRole('button', { name: 'Annuler' }).click());
  await editAndDiscard(async () => {
    await sheet.getByRole('radio', { name: 'Rose' }).focus();
    await page.keyboard.press('Escape');
  });
  expect(await storedLaneNames(page)).toEqual(DEFAULT_LANES);
});

test('editing a lane: name, color, reorder, delete, then Appliquer persists it', async ({ page }) => {
  const sheet = laneSheet(page);
  await page.getByRole('button', { name: 'Modifier le couloir API et intégrations' }).click();
  await sheet.getByRole('textbox', { name: 'Nom' }).fill('Intégrations');
  await sheet.getByRole('radio', { name: 'Rose' }).click();
  await expect(sheet.getByRole('radio', { name: 'Rose' })).toHaveAttribute('aria-checked', 'true');

  // Down once, then the last lane up to the top, then delete "Data".
  await sheet.getByRole('button', { name: 'Descendre Intégrations' }).click();
  await expect(sheet.getByRole('button', { name: 'Monter Identité et sécurité' })).toBeEnabled();
  await sheet.getByRole('button', { name: 'Monter Identité et sécurité' }).click();
  await sheet.getByRole('button', { name: 'Monter Identité et sécurité' }).click();
  await sheet.getByRole('button', { name: 'Monter Identité et sécurité' }).click();
  await expect(sheet.getByRole('button', { name: 'Monter Identité et sécurité' })).toBeDisabled();
  await sheet.getByRole('button', { name: 'Supprimer Data' }).click();

  // Nothing on the board yet.
  await expect.poll(() => boardLanes(page)).toEqual(DEFAULT_LANES);

  await sheet.getByRole('button', { name: 'Appliquer' }).click();
  await expect(sheet).toBeHidden();
  const expected = ['Identité et sécurité', 'Intégrations', 'Expérience produit'];
  await expect.poll(() => boardLanes(page)).toEqual(expected);
  await expect(page.getByRole('region', { name: 'Intégrations' })).toHaveAttribute('data-lane-color', 'pink');
  await expect(boardItem(page, '&21')).toHaveCount(0); // a Data epic
  expect(await storedLaneNames(page)).toEqual(expected);

  await page.reload();
  await expect(boardItem(page, '&18')).toBeVisible();
  await expect.poll(() => boardLanes(page)).toEqual(expected);
  await expect(page.getByRole('region', { name: 'Intégrations' })).toHaveAttribute('data-lane-color', 'pink');
});

test('a new lane on label "priorité::haute" with issues only shows #104 and #113', async ({ page }) => {
  const sheet = laneSheet(page);
  await sidebar(page).getByRole('button', { name: 'Nouveau couloir' }).click();
  await sheet.getByRole('textbox', { name: 'Nom' }).fill('Priorités');

  const groups = sheet.getByRole('listbox', { name: 'Groupes' });
  await groups.getByRole('option', { name: `${root().name}, ${root().path}` }).click();
  await expect(groups.getByRole('option', { name: `${root().name}, ${root().path}` })).toHaveAttribute('aria-selected', 'true');
  await expect(sheet.getByRole('switch', { name: 'Inclure les sous-groupes' })).toHaveAttribute('aria-checked', 'true');

  await sheet.getByRole('switch', { name: 'Epics' }).click();
  await expect(sheet.getByRole('switch', { name: 'Epics' })).toHaveAttribute('aria-checked', 'false');
  await expect(sheet.getByRole('switch', { name: 'Issues bloquantes' })).toHaveAttribute('aria-checked', 'true');

  // The label mode is disabled until a label is picked.
  await expect(sheet.getByRole('radio', { name: 'Tous' })).toBeDisabled();
  await sheet.getByRole('searchbox', { name: 'Filtrer les labels' }).fill('priorité');
  const labels = sheet.getByRole('listbox', { name: 'Labels' });
  await labels.getByRole('option', { name: 'priorité::haute' }).click();
  await expect(labels.getByRole('option', { name: 'priorité::haute' })).toHaveAttribute('aria-selected', 'true');
  await sheet.getByRole('radio', { name: 'Tous' }).click();
  await expect(sheet.getByRole('radio', { name: 'Tous' })).toHaveAttribute('aria-checked', 'true');

  // Only this lane on the board.
  for (const name of DEFAULT_LANES) await sheet.getByRole('checkbox', { name: `Afficher ${name}` }).uncheck();
  await expect(sheet.getByRole('button', { name: /^Priorités / })).toContainText(`${root().name} · issues · tous : priorité::haute`);

  await sheet.getByRole('button', { name: 'Appliquer' }).click();
  await expect(sheet).toBeHidden();
  await expect.poll(() => boardLanes(page)).toEqual(['Priorités']);
  await expect(boardItems(page)).toHaveCount(2);
  await expect(boardItem(page, '#104')).toBeVisible();
  await expect(boardItem(page, '#113')).toBeVisible();
});

test('groups and "Inclure les sous-groupes" decide what a lane holds', async ({ page }) => {
  const sheet = laneSheet(page);
  // The Data lane on the root group only: items all live in subgroups, so it shows nothing.
  await page.getByRole('button', { name: 'Modifier le couloir Data' }).click();
  const groups = sheet.getByRole('listbox', { name: 'Groupes' });
  await groups.getByRole('option', { name: `Data, ${group('data')}` }).click();
  await groups.getByRole('option', { name: `${root().name}, ${root().path}` }).click();
  await expect(groups.getByRole('option', { name: `Data, ${group('data')}` })).toHaveAttribute('aria-selected', 'false');
  const subgroups = sheet.getByRole('switch', { name: 'Inclure les sous-groupes' });
  await subgroups.click();
  await expect(subgroups).toHaveAttribute('aria-checked', 'false');
  await sheet.getByRole('button', { name: 'Appliquer' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText('Aucun élément de ce couloir dans la fenêtre.')).toBeVisible();
  await expect(boardItem(page, '&21')).toHaveCount(0);

  // With its subgroups the root matches everything: #110 shows in API et intégrations and in Data.
  await page.getByRole('button', { name: 'Modifier le couloir Data' }).click();
  await sheet.getByRole('switch', { name: 'Inclure les sous-groupes' }).click();
  await sheet.getByRole('button', { name: 'Appliquer' }).click();
  await expect(boardItem(page, '&21')).toBeVisible();
  await expect(page.getByRole('button', { name: itemName('#110') })).toHaveCount(2);
});

test('"Rétablir les couloirs par défaut" brings the default lanes back', async ({ page }) => {
  const sheet = laneSheet(page);
  await sidebar(page).getByRole('button', { name: 'Modifier…' }).click();
  await sheet.getByRole('button', { name: 'Supprimer API et intégrations' }).click();
  await sheet.getByRole('button', { name: 'Supprimer Data' }).click();
  await sheet.getByRole('button', { name: 'Appliquer' }).click();
  await expect.poll(() => boardLanes(page)).toEqual(['Expérience produit', 'Identité et sécurité']);

  await sidebar(page).getByRole('button', { name: 'Modifier…' }).click();
  await sheet.getByRole('button', { name: 'Rétablir les couloirs par défaut' }).click();
  await expect(sheet.getByRole('checkbox', { name: /^Afficher / })).toHaveCount(DEFAULT_LANES.length);
  await sheet.getByRole('button', { name: 'Appliquer' }).click();
  await expect.poll(() => boardLanes(page)).toEqual(DEFAULT_LANES);
  expect(await storedLaneNames(page)).toEqual(DEFAULT_LANES);
});

test('unchecking a lane in the sidebar hides it, and it is remembered', async ({ page }) => {
  const box = sidebar(page).getByRole('checkbox', { name: 'Data', exact: true });
  await expect(box).toBeChecked();
  await box.uncheck();
  await expect.poll(() => boardLanes(page)).toEqual(DEFAULT_LANES.filter((name) => name !== 'Data'));
  await expect(boardItem(page, '&21')).toHaveCount(0);

  await page.reload();
  await expect(boardItem(page, '&18')).toBeVisible();
  await expect(sidebar(page).getByRole('checkbox', { name: 'Data', exact: true })).not.toBeChecked();
  await expect(boardItem(page, '&21')).toHaveCount(0);

  await sidebar(page).getByRole('checkbox', { name: 'Data', exact: true }).check();
  await expect.poll(() => boardLanes(page)).toEqual(DEFAULT_LANES);
  await expect(boardItem(page, '&21')).toBeVisible();
});

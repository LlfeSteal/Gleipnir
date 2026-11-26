import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { escapeRegExp, itemName } from './helpers';
import { groupOf } from './demo';

// Helpers of the selection, lanes, mobile, errors, persistence, issue-mode and hors-couloirs
// specs. The demo dataset (gitlab-mock/dataset/dataset.go): "Itération 15" is always current, so
// the default window is It. 14 – It. 18, and the default lanes are the four subgroups of the
// root, subgroups included, issues that block an epic only (ADR-34).

export const DEFAULT_LANES = ['API et intégrations', 'Data', 'Expérience produit', 'Identité et sécurité'];

/** An epic or issue on the board, by its key in the dataset ("&18", "#110"), found by its title. */
export function boardItem(page: Page, key: string): Locator {
  return page.getByRole('button', { name: itemName(key) }).first();
}

/** Every epic and issue drawn on the board. */
export function boardItems(page: Page): Locator {
  return page.getByRole('button', { name: /^(Epic &|Issue #)\d+ / });
}

export function inspector(page: Page): Locator {
  return page.getByRole('complementary', { name: 'Détail de l’élément' });
}

export function sidebar(page: Page): Locator {
  return page.getByRole('complementary', { name: 'Filtres' });
}

export function windowButton(page: Page): Locator {
  return page.getByRole('button', { name: /^Fenêtre : / });
}

/** The value of a fact of the inspector ("Groupe", "Période"…): the <dd> after its <dt>. */
export function fact(panel: Locator, term: string): Locator {
  return panel.getByRole('term').filter({ hasText: new RegExp(`^${term}$`) }).locator('xpath=following-sibling::dd[1]');
}

/** Opens the board on the demo data and waits for it. */
export async function openBoard(page: Page): Promise<void> {
  await page.goto('/');
  await expect(boardItem(page, '&18')).toBeVisible();
}

/** Lane names on the board, top to bottom, from their collapse buttons. */
export async function boardLanes(page: Page): Promise<string[]> {
  const labels = await page
    .getByRole('button', { name: /^(Replier|Déplier) le couloir / })
    .evaluateAll((buttons) => buttons.map((b) => b.getAttribute('aria-label') ?? ''));
  return labels.map((label) => label.replace(/^(Replier|Déplier) le couloir /, ''));
}

/** Clicks a visible spot of the board canvas that holds no item nor lane header. */
export async function clickEmptyCanvas(page: Page): Promise<void> {
  const point = await page.evaluate(() => {
    const scroller = document.querySelector('.board-scroll');
    if (!scroller) return null;
    const box = scroller.getBoundingClientRect();
    for (let y = box.bottom - 12; y > box.top + 60; y -= 16) {
      for (let x = box.right - 12; x > box.left + 240; x -= 24) {
        const hit = document.elementFromPoint(x, y);
        if (hit && scroller.contains(hit) && !hit.closest('button, .lane-rail, .board-header, svg')) return { x, y };
      }
    }
    return null;
  });
  expect(point, 'an empty spot of the board canvas').not.toBeNull();
  await page.mouse.click(point!.x, point!.y);
}

/** Whether an item looks dimmed: faded itself, or veiled by an overlay pseudo-element
 * (the styling may use either). Poll it: the change is animated. */
export function isDimmed(item: Locator): Promise<boolean> {
  return item.evaluate((el) => {
    const own = Number(getComputedStyle(el).opacity);
    const veil = getComputedStyle(el, '::after');
    const veiled = veil.content !== 'none' && veil.display !== 'none' && Number(veil.opacity) > 0.2;
    return own < 0.9 || veiled;
  });
}

/** A lane's checkbox in the sidebar: checked when the lane is active. Named after the lane. */
export function laneBox(page: Page, name: string): Locator {
  return sidebar(page).getByRole('checkbox', { name, exact: true });
}

/** The « Configurer les couloirs » sheet. */
export function laneSettings(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Configurer les couloirs' });
}

/** Opens the lane settings from the sidebar's « Configurer… » button. */
export async function openLaneSettings(page: Page): Promise<Locator> {
  await sidebar(page).getByRole('button', { name: 'Configurer…' }).click();
  const sheet = laneSettings(page);
  await expect(sheet).toBeVisible();
  return sheet;
}

/** The row of a lane in the sheet's list: its checkbox, select button and tools. */
export function settingsLane(sheet: Locator, name: string): Locator {
  return sheet.getByRole('list', { name: 'Liste des couloirs' }).getByRole('listitem').filter({
    has: sheet.page().getByRole('checkbox', { name: `Afficher ${name}`, exact: true }),
  });
}

/** Selects a lane of the sheet's list, to edit it. */
export async function selectSettingsLane(sheet: Locator, name: string): Promise<void> {
  const row = settingsLane(sheet, name);
  await row.getByRole('button', { name: new RegExp(`^${escapeRegExp(name)}`) }).click();
  await expect(sheet.getByRole('textbox', { name: 'Nom' })).toHaveValue(name);
}

/** A group of the sheet's « Groupes GitLab » list, by its slug under the root ("" = root). Its
 * accessible name is the group's name and path, read from the served board. */
export function groupOption(sheet: Locator, slug: string): Locator {
  const g = groupOf(slug);
  return sheet.getByRole('listbox', { name: 'Groupes GitLab' }).getByRole('option', { name: `${g.name}, ${g.path}`, exact: true });
}

/** The issue mode of the lane being edited: « Toutes », « Bloquantes », « Aucune ». */
export function issueModeRadio(sheet: Locator, mode: 'Toutes' | 'Bloquantes' | 'Aucune'): Locator {
  return sheet.getByRole('radiogroup', { name: 'Issues', exact: true }).getByRole('radio', { name: mode, exact: true });
}

/** Applies the sheet and waits for it to close. */
export async function applyLaneSettings(sheet: Locator): Promise<void> {
  await sheet.getByRole('button', { name: 'Appliquer', exact: true }).click();
  await expect(sheet).toBeHidden();
}

/** Sets the issue mode of a lane through the sheet, and applies it. */
export async function setIssueMode(page: Page, lane: string, mode: 'Toutes' | 'Bloquantes' | 'Aucune'): Promise<void> {
  await page.getByRole('button', { name: `Modifier le couloir ${lane}`, exact: true }).click();
  const sheet = laneSettings(page);
  await expect(sheet.getByRole('textbox', { name: 'Nom' })).toHaveValue(lane);
  await issueModeRadio(sheet, mode).click();
  await expect(issueModeRadio(sheet, mode)).toBeChecked();
  await applyLaneSettings(sheet);
}

/** Shows every column in the window. */
export async function showAllIterations(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Fenêtre\s*:/ }).click();
  await page.getByRole('menuitemradio', { name: 'Toutes', exact: true }).click();
}

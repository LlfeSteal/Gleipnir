import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { keyOf, kind, title } from './demo';

// Shared helpers of the demo e2e suites. The demo dataset (gitlab-mock/dataset/dataset.go) has
// ten iterations, Itération 12 to 21; Itération 15 (index 3) is always the current one, so the
// default window is It. 14 – It. 18. Items are named by their key in the dataset ("&18") and
// found by their title (see demo.ts).

/** The default lanes of the demo, one per subgroup of plateforme/atlas, sorted by path. */
export const DEMO_LANES = ['API et intégrations', 'Data', 'Expérience produit', 'Identité et sécurité'] as const;

/** Opens the board and waits until the demo data is drawn. */
export async function openBoard(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dépendances' })).toBeVisible();
  await expect(windowButton(page)).toBeVisible();
}

/** An epic bar or an issue card by its key in the dataset ("&18", "#110"). The accessible name
 * is the kind, the reference and the title: "Epic &18 API d'export…", "Issue #131 …, fermée". */
export function item(page: Page, key: string): Locator {
  return page.getByRole('button', { name: itemName(key) });
}

/** The accessible name of an item, by key, whatever its reference. */
export function itemName(key: string): RegExp {
  return new RegExp(`^${kind(key)} [&#]\\d+ ${escapeRegExp(title(key))}(, fermée?)?$`);
}

/** Every epic bar and issue card drawn on the board. */
export function boardItems(page: Page): Locator {
  return page.getByRole('button', { name: /^(Epic &|Issue #)\d+/ });
}

/** The accessible names of the items drawn; with matchesOnly, only the search matches, not the
 * dependencies a match brings in (data-search-context). */
function itemNames(page: Page, matchesOnly: boolean): Promise<string[]> {
  return boardItems(page).evaluateAll(
    (els, only) => els.filter((el) => !only || !el.hasAttribute('data-search-context')).map((el) => el.getAttribute('aria-label') ?? ''),
    matchesOnly,
  );
}

/** The keys of the items drawn ("&18"), sorted and without duplicates; with matchesOnly, the
 * search matches only. */
export async function shownKeys(page: Page, matchesOnly = false): Promise<string[]> {
  const names = await itemNames(page, matchesOnly);
  const titles = names.map((name) => /^(?:Epic|Issue) [&#]\d+ (.*?)(?:, fermée?)?$/.exec(name)?.[1] ?? '').filter(Boolean);
  return [...new Set(titles.map(keyOf))].sort();
}

/** The references and titles of the items drawn ("#110 Endpoint…"); with matchesOnly, the
 * search matches only. */
export async function shownLabels(page: Page, matchesOnly = false): Promise<string[]> {
  const names = await itemNames(page, matchesOnly);
  return names.map((name) => name.replace(/^(Epic|Issue) /, '').replace(/, fermée?$/, ''));
}

/** True when the item is drawn as a dependency brought in by the search, not as a match. */
export function isSearchContext(locator: Locator): Promise<boolean> {
  return locator.first().evaluate((el) => el.hasAttribute('data-search-context'));
}

/** The window pop-up button of the toolbar: "Fenêtre : It. 14 – It. 18". */
export function windowButton(page: Page): Locator {
  return page.getByRole('button', { name: /^Fenêtre\s*:\s/ });
}

/** Expects the window to span these short labels ("It. 14", "It. 18"). */
export async function expectWindow(page: Page, from: string, to: string): Promise<void> {
  // French typography may put a no-break space before the colon: match any space.
  const range = from === to ? escapeRegExp(from) : `${escapeRegExp(from)}\\s–\\s${escapeRegExp(to)}`;
  await expect(windowButton(page)).toHaveAccessibleName(new RegExp(`^Fenêtre\\s*:\\s${range}$`));
}

/** Opens the window pop-up and returns the menu. */
export async function openWindowMenu(page: Page): Promise<Locator> {
  const button = windowButton(page);
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
  const menu = page.getByRole('menu', { name: 'Fenêtre d’itérations' });
  await expect(menu).toBeVisible();
  return menu;
}

/** The sidebar (source list): lanes, link types and display options. */
export function sidebar(page: Page): Locator {
  return page.getByRole('complementary', { name: 'Filtres' });
}

/** A switch of the sidebar's "Affichage" section, by its label. */
export function displaySwitch(page: Page, label: string): Locator {
  return sidebar(page).getByRole('switch', { name: label });
}

/** A link-type checkbox of the sidebar: "Bloque", "Lié à", "Epic parent → issue". Its
 * accessible description is the number of links of that type drawn. */
export function linkTypeCheckbox(page: Page, label: string): Locator {
  return sidebar(page).getByRole('checkbox', { name: label, exact: true });
}

/** The toolbar search field. */
export function searchField(page: Page): Locator {
  return page.getByRole('searchbox', { name: 'Rechercher un epic ou une issue' });
}

/** The summary line above the board ("4 couloirs · 8 epics · …"). */
export function summaryLine(page: Page): Locator {
  return page.locator('p:has(> [data-part])');
}

/** One part of the summary line: lanes, epics, issues, blocks or conflicts. */
export function summaryPart(page: Page, part: 'lanes' | 'epics' | 'issues' | 'blocks' | 'conflicts'): Locator {
  return page.locator(`[data-part="${part}"]`);
}

/** The links drawn in the board's SVG layer, optionally of one type. They carry their state as
 * data attributes (data-type, data-conflict, data-critical, data-connected). The layer is
 * aria-hidden and has no role, so it is found by its class: the link-type swatches of the
 * sidebar and the legend use the same <g data-type> markup. */
export function drawnLinks(page: Page, type?: 'blocks' | 'relates' | 'parent'): Locator {
  return page.locator(`svg.link-layer g${type ? `[data-type="${type}"]` : '[data-type]'}`);
}

/** The collapse / expand button of a lane's header. */
export function laneToggle(page: Page, lane: string): Locator {
  return page.getByRole('button', { name: new RegExp(`^(Replier|Déplier) le couloir ${escapeRegExp(lane)}$`) });
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whether an item is faded (selection, critical path): either translucent itself or veiled by
 * a ::before / ::after overlay. Read from computed styles so it holds whichever way board.css
 * fades; poll it, the fade is animated. */
export function isDimmed(locator: Locator): Promise<boolean> {
  return locator.first().evaluate((el) => {
    if (Number(getComputedStyle(el).opacity) < 0.99) return true;
    return ['::before', '::after'].some((pseudo) => {
      const style = getComputedStyle(el, pseudo);
      return style.content !== 'none' && Number(style.opacity) > 0.01 && style.backgroundColor !== 'rgba(0, 0, 0, 0)';
    });
  });
}

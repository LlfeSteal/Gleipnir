import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

// Helpers of the selection, lanes, mobile and errors specs. The demo dataset
// (gitlab-mock/dataset.go): "Itération 15" is always current, so the default window is
// It. 14 – It. 18, and the default lanes are the four subgroups of plateforme/atlas.

export const DEFAULT_LANES = ['API & intégrations', 'Data', 'Expérience produit', 'Identité & sécurité'];

/** An epic or issue on the board, by its ref ("&18", "#110"): its button is named "Epic &18 …". */
export function boardItem(page: Page, ref: string): Locator {
  const kind = ref.startsWith('&') ? 'Epic' : 'Issue';
  return page.getByRole('button', { name: new RegExp(`^${kind} ${ref} `) }).first();
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

export function laneSheet(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Couloirs' });
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

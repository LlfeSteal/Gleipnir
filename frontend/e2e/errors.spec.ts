import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import { boardItem, openBoard } from './helpers2';

// Error states (spec §6, src/api/client.ts errorMessage): the backend's {error, code} body,
// or a proxy answering without it, becomes a French banner with "Réessayer".

const isBoard = (url: URL) => url.pathname === '/api/board';

type Failure = { status: number; contentType: string; body: string };

const apiError = (status: number, code: string): Failure => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify({ error: `simulated ${code}`, code }),
});

const CASES: { name: string; failure: Failure; title: string; message: string }[] = [
  {
    name: '401 unauthorized',
    failure: apiError(401, 'unauthorized'),
    title: 'Jeton GitLab refusé',
    message: 'GitLab a refusé le jeton du serveur. Vérifiez GITLAB_TOKEN et son scope read_api.',
  },
  {
    name: '404 group_not_found',
    failure: apiError(404, 'group_not_found'),
    title: 'Groupe introuvable',
    message: 'Le groupe GITLAB_GROUP n’existe pas, ou le jeton ne permet pas de le voir.',
  },
  {
    name: '502 premium_required',
    failure: apiError(502, 'premium_required'),
    title: 'GitLab Premium requis',
    message: 'Les epics, les itérations et les liens bloquants demandent GitLab Premium ou Ultimate.',
  },
  {
    name: '502 gitlab_unreachable',
    failure: apiError(502, 'gitlab_unreachable'),
    title: 'GitLab injoignable',
    message: 'Le serveur n’arrive pas à joindre GitLab. Réessayez dans un instant.',
  },
  {
    name: 'raw 504 from the proxy',
    failure: { status: 504, contentType: 'text/html', body: '<html><body>504 Gateway Time-out</body></html>' },
    title: 'Serveur injoignable',
    message: 'Le serveur Gleipnir ne répond pas. Vérifiez qu’il est démarré, puis réessayez.',
  },
];

/** Fails every board request while `failing` is set, then lets them through to the backend
 * (on the fake GitLab). (Dev StrictMode mounts twice and aborts the first request, so no counting.) */
async function failBoard(page: Page, failure: Failure) {
  const state = { failing: true, calls: [] as string[] };
  await page.route(isBoard, async (route: Route) => {
    state.calls.push(route.request().url());
    if (state.failing) await route.fulfill(failure);
    else await route.fallback();
  });
  return state;
}

for (const { name, failure, title, message } of CASES) {
  test(`${name}: banner, then "Réessayer" loads the board`, async ({ page }) => {
    const state = await failBoard(page, failure);
    await page.goto('/');
    const banner = page.getByRole('alert');
    await expect(banner).toContainText(title);
    await expect(banner).toContainText(message);
    await expect(boardItem(page, '&18')).toHaveCount(0);

    // GitLab is back: "Réessayer" loads the board. Nothing is shown yet, so no lane to scope a
    // refresh to: the backend answers from its cache, or syncs everything when it has none.
    state.failing = false;
    const retry = page.waitForRequest((r) => isBoard(new URL(r.url())));
    await banner.getByRole('button', { name: 'Réessayer' }).click();
    expect(new URL((await retry).url()).searchParams.get('refresh')).toBeNull();
    await expect(boardItem(page, '&18')).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
}

test('"Synchroniser" asks the backend to read the groups of the active lanes again', async ({ page }) => {
  await openBoard(page);
  const request = page.waitForRequest((r) => isBoard(new URL(r.url())));
  await page.getByRole('button', { name: 'Synchroniser' }).click();
  const url = new URL((await request).url());
  expect(url.searchParams.get('refresh')).toBe('1');
  // The default lanes: one per subgroup of the demo's root group.
  expect(url.searchParams.get('groups')?.split(',')).toEqual([
    'plateforme/atlas/api',
    'plateforme/atlas/data',
    'plateforme/atlas/experience',
    'plateforme/atlas/identite',
  ]);
  await expect(page.getByRole('button', { name: 'Synchroniser' })).toBeEnabled();
  await expect(boardItem(page, '&18')).toBeVisible();
});

test('a failed refresh keeps the board and shows the banner', async ({ page }) => {
  await openBoard(page);
  await page.route(
    (url) => isBoard(url) && url.searchParams.get('refresh') === '1',
    (route) => route.fulfill(apiError(502, 'gitlab_unreachable')),
  );
  await page.getByRole('button', { name: 'Synchroniser' }).click();
  await expect(page.getByRole('alert')).toContainText('GitLab injoignable');
  await expect(boardItem(page, '&18')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Synchroniser' })).toBeEnabled();

  // Once GitLab answers again, "Réessayer" clears the banner.
  await page.unrouteAll();
  await page.getByRole('alert').getByRole('button', { name: 'Réessayer' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(boardItem(page, '&18')).toBeVisible();
});

test('"Synchroniser" only reads the lanes left active, and is off without any', async ({ page }) => {
  await openBoard(page);
  const sidebar = page.getByRole('complementary', { name: 'Filtres' });
  for (const name of ['Data', 'Expérience produit', 'Identité & sécurité']) {
    await sidebar.getByRole('checkbox', { name }).uncheck();
  }
  const sync = page.getByRole('button', { name: 'Synchroniser' });
  const response = page.waitForResponse((r) => isBoard(new URL(r.url())) && r.request().url().includes('refresh=1'));
  await sync.click();
  const answer = await response;
  expect(new URL(answer.url()).searchParams.get('groups')).toBe('plateforme/atlas/api');
  expect(answer.status()).toBe(200);
  expect(['HIT', 'MISS']).toContain(answer.headers()['x-cache']);
  // The toolbar tells how old the groups on screen are.
  await expect(page.locator('.toolbar-updated')).toHaveText(/Mis à jour (à l'instant|il y a \d+ min)/);
  await expect(sync).toBeEnabled();

  await sidebar.getByRole('checkbox', { name: 'API & intégrations' }).uncheck();
  await expect(sync).toBeDisabled();
  await expect(sync).toHaveAttribute('title', 'Aucun couloir actif à synchroniser');
});

import { expect, test } from '@playwright/test';

// Smoke test against a real stack on a real GitLab (BASE_URL=http://localhost npm run
// test:e2e:live). It assumes nothing about the group's content beyond one iteration.

interface Health {
  status: string;
  gitlabUrl: string;
}

interface BoardJson {
  rootGroup: { id: string; name: string };
  groups: { id: string; path: string; name: string }[];
  iterations: unknown[];
  epics: { ref: string }[];
  issues: { ref: string }[];
}

test.describe('@live', () => {
  test('the board loads from GitLab and shows only what /api/board sent', async ({ page, request }) => {
    const health = (await (await request.get('/api/health')).json()) as Health;
    expect(health.status).toBe('ok');
    // The demo stack reads the fake GitLab over plain http (http://gitlab-mock:8080).
    expect(health.gitlabUrl, 'the stack must read a real GitLab, not the fake one').toMatch(/^https:\/\//);

    const response = await request.get('/api/board');
    expect(response.ok(), `GET /api/board: HTTP ${response.status()}`).toBe(true);
    const board = (await response.json()) as BoardJson;
    expect(board.iterations.length).toBeGreaterThanOrEqual(1);

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Dépendances' })).toBeVisible();
    await expect(page.getByRole('status', { name: 'Chargement…' })).toHaveCount(0, { timeout: 60_000 });
    await expect(page.getByRole('group', { name: 'Fenêtre d’itérations' })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);

    const known = new Set([...board.epics.map((e) => e.ref), ...board.issues.map((i) => i.ref)]);
    const names = await page
      .getByRole('button', { name: /^(Epic &|Issue #)\d+ / })
      .evaluateAll((buttons) => buttons.map((b) => b.getAttribute('aria-label') ?? ''));
    for (const name of names) {
      const ref = /^(?:Epic|Issue) ([&#]\d+) /.exec(name)?.[1];
      expect(ref && known.has(ref), `${name} is in /api/board`).toBe(true);
    }
  });

  test('the group ids are GitLab ids, and the lane sheet offers the group tree; the view is kept through a reload', async ({ page, request }) => {
    const board = (await (await request.get('/api/board')).json()) as BoardJson;
    for (const group of board.groups) expect(group.id, `id of ${group.path}`).toMatch(/^gid:\/\/gitlab\/Group\/\d+$/);

    await page.goto('/');
    await expect(page.getByRole('status', { name: 'Chargement…' })).toHaveCount(0, { timeout: 60_000 });
    // Lanes are picked from the GitLab group tree (ADR-34): the root is one of its options.
    await page.getByRole('complementary', { name: 'Filtres' }).getByRole('button', { name: 'Configurer…' }).click();
    const sheet = page.getByRole('dialog', { name: 'Configurer les couloirs' });
    await expect(sheet).toBeVisible();
    const tree = sheet.getByRole('listbox', { name: 'Groupes GitLab' });
    await expect(tree.getByRole('option', { name: `${board.rootGroup.name}, ${board.groups[0].path}`, exact: true })).toBeVisible();
    await sheet.getByRole('button', { name: 'Annuler', exact: true }).click();

    // The window is remembered in the browser (ADR-36), whatever the group holds; the URL stays bare.
    const next = page.getByRole('button', { name: 'Itération suivante' });
    if (await next.isEnabled()) await next.click();
    const shown = await page.getByRole('button', { name: /^Fenêtre\s*:/ }).getAttribute('aria-label');
    await page.reload();
    await expect(page.getByRole('button', { name: /^Fenêtre\s*:/ })).toHaveAttribute('aria-label', shown ?? '', { timeout: 60_000 });
    expect(new URL(page.url()).search).toBe('');
  });
});

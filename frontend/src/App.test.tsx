// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { mockupBoard } from './board/fixtures';

// The mockup dataset: It. 12 → It. 21, It. 15 current, so the default window is It. 14 – It. 18.
// Default lanes: one per subgroup of plateforme/atlas.
const LANES = ['API & intégrations', 'Data', 'Expérience produit', 'Identité & sécurité'];

const ok = () =>
  new Response(JSON.stringify(mockupBoard()), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'X-Fetched-At': new Date().toISOString() },
  });

function stubFetch(...first: (() => Response)[]) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ok());
  for (const response of first) fetchMock.mockImplementationOnce(async () => response());
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function renderApp() {
  const user = userEvent.setup();
  render(<App />);
  const sidebar = await screen.findByRole('complementary', { name: 'Filtres' });
  await within(sidebar).findByRole('checkbox', { name: LANES[0] });
  return { user, sidebar };
}

const windowButton = () => screen.getByRole('button', { name: /^Fenêtre :/ });
const inspector = () => screen.queryByRole('complementary', { name: 'Détail de l’élément' });
const stored = (key: string) => JSON.parse(localStorage.getItem(key) ?? 'null');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('loads the board and shows the default lanes', async () => {
    stubFetch();
    const { sidebar } = await renderApp();
    for (const name of LANES) expect(within(sidebar).getByRole('checkbox', { name })).toBeChecked();
    expect(screen.getByRole('heading', { name: 'Dépendances' })).toBeInTheDocument();
    expect(screen.getByText('Atlas · Sprints produit')).toBeInTheDocument();
    expect(windowButton()).toHaveAccessibleName('Fenêtre : It. 14 – It. 18');
    expect(document.querySelector('.summary-line')).toHaveTextContent(/^4 couloirs · \d+ epics · \d+ issues · /);
    expect(within(sidebar).getByText('9 sur 12 issues synchronisées bloquent un epic.')).toBeInTheDocument();
    // Nothing is stored until the user changes something, and the URL is never touched (ADR-36).
    expect(window.location.search).toBe('');
    expect(localStorage.getItem('gleipnir.lanes')).toBeNull();
    expect(localStorage.getItem('gleipnir.window')).toBeNull();
    // &30, in the root group, is in no default lane: &15 says so (spec §4.5).
    expect(within(screen.getByRole('button', { name: /^Epic &15 / })).getByText('1 hors couloirs')).toBeInTheDocument();
  });

  it('shows a French error banner on 401, and retries', async () => {
    const fetchMock = stubFetch(
      () =>
        new Response(JSON.stringify({ error: '401 Unauthorized', code: 'unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    const user = userEvent.setup();
    render(<App />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Jeton GitLab refusé');
    expect(alert).toHaveTextContent(/GITLAB_TOKEN/);

    await user.click(within(alert).getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByRole('checkbox', { name: LANES[0] })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    // No board yet: the backend's cache (or its first sync) answers.
    expect(fetchMock).toHaveBeenLastCalledWith('/api/board', expect.anything());
  });

  it('Synchroniser reads the groups of the active lanes again, and is off without any', async () => {
    const fetchMock = stubFetch();
    const { user, sidebar } = await renderApp();
    const sync = screen.getByRole('button', { name: 'Synchroniser' });
    await user.click(within(sidebar).getByRole('checkbox', { name: LANES[1] }));
    await user.click(sync);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/board?refresh=1&groups=plateforme/atlas/api,plateforme/atlas/experience,plateforme/atlas/identite',
        expect.anything(),
      ),
    );
    await waitFor(() => expect(sync).toBeEnabled());

    for (const name of [LANES[0], LANES[2], LANES[3]]) {
      await user.click(within(sidebar).getByRole('checkbox', { name }));
    }
    expect(sync).toBeDisabled();
    expect(sync).toHaveAttribute('title', 'Aucun couloir actif à synchroniser');
  });

  it('shows how old the groups of the active lanes are', async () => {
    const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
    const data = mockupBoard();
    data.groups = data.groups.map((g) => ({
      ...g,
      syncedAt: g.path === 'plateforme/atlas/data' ? minutesAgo(30) : minutesAgo(2),
    }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(data), { status: 200, headers: { 'X-Fetched-At': minutesAgo(30) } })),
    );
    const { user, sidebar } = await renderApp();
    const updated = document.querySelector('.toolbar-updated')!;
    expect(updated.textContent).toMatch(/30 min/);
    await user.click(within(sidebar).getByRole('checkbox', { name: LANES[1] })); // Data off
    expect(updated.textContent).toMatch(/2 min/);
  });

  it('Réessayer after a failed refresh reads the same groups again', async () => {
    const fetchMock = stubFetch(ok, () => new Response('Bad Gateway', { status: 502 }));
    const { user } = await renderApp();
    await user.click(screen.getByRole('button', { name: 'Synchroniser' }));
    const alert = await screen.findByRole('alert');
    await user.click(within(alert).getByRole('button', { name: 'Réessayer' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(fetchMock.mock.calls.at(-1)?.[0]).toMatch(/^\/api\/board\?refresh=1&groups=/);
  });

  it('keeps the board when a refresh fails', async () => {
    stubFetch(ok, () => new Response('Bad Gateway', { status: 502 }));
    const { user, sidebar } = await renderApp();
    await user.click(screen.getByRole('button', { name: 'Synchroniser' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Serveur injoignable');
    expect(within(sidebar).getByRole('checkbox', { name: LANES[0] })).toBeInTheDocument();
  });

  it('creates a lane in « Configurer les couloirs »: overlapping lanes show an item in each, and it is remembered', async () => {
    stubFetch();
    const { user, sidebar } = await renderApp();
    for (let i = 0; i < 3; i++) await user.click(screen.getByRole('button', { name: 'Itération suivante' }));
    const portal = () => screen.getAllByRole('button', { name: /^Epic &22 / });
    expect(portal()).toHaveLength(1);

    await user.click(within(sidebar).getByRole('button', { name: 'Nouveau couloir' }));
    const sheet = screen.getByRole('dialog', { name: 'Configurer les couloirs' });
    const name = within(sheet).getByRole('textbox', { name: 'Nom' });
    await user.clear(name);
    await user.type(name, 'Partenaires');
    await user.click(within(sheet).getByRole('option', { name: /^Partenaires/ }));
    await user.click(within(sheet).getByRole('button', { name: 'Appliquer' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    // &22 is in API (with its subgroups) and in the new lane.
    expect(screen.getByRole('region', { name: 'Partenaires' })).toBeInTheDocument();
    expect(portal()).toHaveLength(2);
    expect(document.querySelector('.summary-line')).toHaveTextContent(/^5 couloirs/);
    expect(stored('gleipnir.lanes')).toHaveLength(5);
    expect(window.location.search).toBe('');

    // A new visit finds the lanes again.
    cleanup();
    await renderApp();
    expect(screen.getByRole('region', { name: 'Partenaires' })).toBeInTheDocument();
  });

  it('edits a lane from its header: « Toutes » shows the issues that block no epic', async () => {
    stubFetch();
    const { user } = await renderApp();
    expect(screen.queryByRole('button', { name: /^Issue #150 / })).toBeNull();
    await user.click(screen.getByRole('button', { name: `Modifier le couloir ${LANES[0]}` }));
    const sheet = screen.getByRole('dialog', { name: 'Configurer les couloirs' });
    expect(within(sheet).getByRole('textbox', { name: 'Nom' })).toHaveValue(LANES[0]);
    await user.click(within(within(sheet).getByRole('radiogroup', { name: 'Issues' })).getByRole('radio', { name: 'Toutes' }));
    // Nothing changes before Appliquer.
    expect(screen.queryByRole('button', { name: /^Issue #150 / })).toBeNull();
    await user.click(within(sheet).getByRole('button', { name: 'Appliquer' }));
    const card = screen.getByRole('button', { name: /^Issue #150 / });
    expect(card).toHaveTextContent('Ne bloque aucun epic');
    expect(screen.getByRole('region', { name: LANES[0] })).toHaveTextContent('toutes les issues');
  });

  it('Annuler leaves the board as it was', async () => {
    stubFetch();
    const { user, sidebar } = await renderApp();
    await user.click(within(sidebar).getByRole('button', { name: `Modifier ${LANES[1]}` }));
    const sheet = screen.getByRole('dialog', { name: 'Configurer les couloirs' });
    await user.click(within(sheet).getByRole('button', { name: `Supprimer ${LANES[1]}` }));
    await user.click(within(sheet).getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('region', { name: LANES[1] })).toBeInTheDocument();
    expect(localStorage.getItem('gleipnir.lanes')).toBeNull();
  });

  it('shows an empty state when no lane is active, which opens the lane settings', async () => {
    stubFetch();
    const { user, sidebar } = await renderApp();
    for (const name of LANES) await user.click(within(sidebar).getByRole('checkbox', { name }));
    expect(screen.getByText('Aucun couloir affiché')).toBeInTheDocument();
    expect(stored('gleipnir.lanes').map((l: { active: boolean }) => l.active)).toEqual([false, false, false, false]);
    await user.click(screen.getByRole('button', { name: 'Configurer les couloirs' }));
    expect(screen.getByRole('dialog', { name: 'Configurer les couloirs' })).toBeInTheDocument();
  });

  it('moves the window with the arrows and the presets, and remembers it', async () => {
    stubFetch();
    const { user } = await renderApp();
    await user.click(screen.getByRole('button', { name: 'Itération suivante' }));
    expect(windowButton()).toHaveAccessibleName('Fenêtre : It. 15 – It. 19');
    await user.click(screen.getByRole('button', { name: 'Itération précédente' }));
    await user.click(screen.getByRole('button', { name: 'Itération précédente' }));
    expect(windowButton()).toHaveAccessibleName('Fenêtre : It. 13 – It. 17');

    await user.click(windowButton());
    const menu = screen.getByRole('menu', { name: 'Fenêtre d’itérations' });
    // The end can't come before the start.
    expect(within(within(menu).getByRole('group', { name: 'Fin' })).getByRole('menuitemradio', { name: /It\. 12/ })).toBeDisabled();
    await user.click(within(within(menu).getByRole('group', { name: 'Début' })).getByRole('menuitemradio', { name: /It\. 16/ }));
    expect(windowButton()).toHaveAccessibleName('Fenêtre : It. 16 – It. 17');

    await user.click(within(menu).getByRole('menuitemradio', { name: 'Toutes' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(windowButton()).toHaveAccessibleName('Fenêtre : It. 12 – It. 21');
    expect(screen.getByRole('button', { name: 'Itération suivante' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Itération précédente' })).toBeDisabled();
    // Remembered in the browser by iteration ids, never in the URL.
    expect(stored('gleipnir.window')).toEqual({ from: 'gid://gitlab/Iteration/500', to: 'gid://gitlab/Iteration/509' });
    expect(window.location.search).toBe('');

    await user.click(windowButton());
    expect(screen.getByRole('menuitemradio', { name: 'Toutes' })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('menuitemradio', { name: 'En cours ± 2' }));
    expect(windowButton()).toHaveAccessibleName('Fenêtre : It. 13 – It. 17');
  });

  it('inspector: a dependency outside the window moves the window and selects it', async () => {
    stubFetch();
    const { user } = await renderApp();
    // &18 (It. 16 → It. 18) blocks &22 (It. 19 → It. 21), outside It. 14 – It. 18.
    const [epic] = screen.getAllByRole('button', { name: /^Epic &18 / });
    await user.click(epic);
    let panel = inspector()!;
    expect(panel).toHaveTextContent("API d'export des données");
    const blocks = within(panel).getByRole('group', { name: 'Bloque' });
    const row = within(blocks).getByRole('button', { name: /&22/ });
    expect(row).toHaveTextContent('It. 19 → It. 21');

    await user.click(row);
    expect(windowButton()).toHaveAccessibleName('Fenêtre : It. 17 – It. 21');
    panel = inspector()!;
    expect(within(panel).getByRole('heading', { name: 'Portail développeur' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Epic &22 / })[0]).toHaveAttribute('aria-pressed', 'true');
  });

  it('Escape clears the selection', async () => {
    stubFetch();
    const { user } = await renderApp();
    await user.click(screen.getAllByRole('button', { name: /^Epic &18 / })[0]);
    expect(inspector()).not.toBeNull();
    await user.keyboard('{Escape}');
    expect(inspector()).toBeNull();

    await user.click(screen.getAllByRole('button', { name: /^Epic &18 / })[0]);
    await user.click(screen.getByRole('button', { name: 'Fermer le détail' }));
    expect(inspector()).toBeNull();
  });

  it('⌘F focuses the search field', async () => {
    stubFetch();
    const { user } = await renderApp();
    await user.keyboard('{Control>}f{/Control}');
    expect(screen.getByRole('searchbox', { name: 'Rechercher un epic ou une issue' })).toHaveFocus();
  });

  it('reads the remembered lanes and window back, falling back on anything invalid', async () => {
    stubFetch();
    const data = mockupBoard();
    const atlas = data.groups[0].id;
    localStorage.setItem(
      'gleipnir.lanes',
      JSON.stringify([{ id: 'all', name: 'Tout', color: 'pink', groups: [atlas], includeSubgroups: true, showEpics: true, issueMode: 'all', labels: [], labelMode: 'any', active: true }]),
    );
    localStorage.setItem('gleipnir.window', JSON.stringify({ from: 'gid://gitlab/Iteration/503', to: 'gid://gitlab/Iteration/505' }));
    const user = userEvent.setup();
    render(<App />);
    const sidebar = await screen.findByRole('complementary', { name: 'Filtres' });
    expect(await within(sidebar).findByRole('checkbox', { name: 'Tout' })).toBeChecked();
    expect(windowButton()).toHaveAccessibleName('Fenêtre : It. 15 – It. 17');
    // &30 is in the root group: covered, so &15 has nothing "hors couloirs".
    expect(within(screen.getByRole('button', { name: /^Epic &15 / })).queryByText(/hors couloirs/)).toBeNull();
    await user.click(within(sidebar).getByRole('checkbox', { name: 'Tout' }));
    expect(screen.getByText('Aucun couloir affiché')).toBeInTheDocument();

    // Garbage: the defaults.
    cleanup();
    localStorage.setItem('gleipnir.lanes', '{not json');
    localStorage.setItem('gleipnir.window', JSON.stringify({ from: 'gid://gitlab/Iteration/1', to: 'x' }));
    await renderApp();
    expect(windowButton()).toHaveAccessibleName('Fenêtre : It. 14 – It. 18');
  });

  it('keeps no lane when the user removed them all', async () => {
    stubFetch();
    localStorage.setItem('gleipnir.lanes', '[]');
    render(<App />);
    expect(await screen.findByText('Aucun couloir affiché')).toBeInTheDocument();
    expect(screen.getByText('Aucun couloir.')).toBeInTheDocument();
  });

  it('forgets the link types, options and collapsed lanes with the session (spec §7)', async () => {
    stubFetch();
    const { user, sidebar } = await renderApp();
    await user.click(within(sidebar).getByRole('checkbox', { name: /Lié à/ }));
    await user.click(screen.getByRole('button', { name: `Replier le couloir ${LANES[0]}` }));
    expect(within(sidebar).getByRole('checkbox', { name: /Lié à/ })).not.toBeChecked();
    cleanup();
    const again = await renderApp();
    expect(within(again.sidebar).getByRole('checkbox', { name: /Lié à/ })).toBeChecked();
    expect(screen.getByRole('button', { name: `Replier le couloir ${LANES[0]}` })).toHaveAttribute('aria-expanded', 'true');
  });

  it('inspector: a dependency in no lane is listed but not clickable', async () => {
    stubFetch();
    const { user } = await renderApp();
    await user.click(screen.getByRole('button', { name: /^Epic &15 / }));
    const related = within(inspector()!).getByRole('group', { name: 'Lié à' });
    expect(within(related).getByText('Hors couloirs · Atlas')).toBeInTheDocument();
    expect(within(related).queryByRole('button', { name: /&30/ })).toBeNull();
  });

  it('opens a collapsed lane to reveal an item picked in the inspector', async () => {
    stubFetch();
    const { user } = await renderApp();
    await user.click(screen.getAllByRole('button', { name: /^Epic &18 / })[0]);
    await user.click(screen.getByRole('button', { name: `Replier le couloir ${LANES[1]}` }));
    expect(screen.queryByRole('button', { name: /^Epic &21 / })).toBeNull();
    await user.click(within(within(inspector()!).getByRole('group', { name: 'Bloque' })).getByRole('button', { name: /&21/ }));
    expect(screen.getByRole('button', { name: `Replier le couloir ${LANES[1]}` })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /^Epic &21 / })).toHaveAttribute('aria-pressed', 'true');
  });

  it('says when the search finds nothing, and clears it', async () => {
    stubFetch();
    const { user } = await renderApp();
    await user.type(screen.getByRole('searchbox', { name: 'Rechercher un epic ou une issue' }), 'zzz introuvable');
    expect(await screen.findByText('Aucun résultat')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Effacer la recherche' }));
    expect(screen.getByRole('searchbox', { name: 'Rechercher un epic ou une issue' })).toHaveValue('');
  });

  it('says when the window holds nothing, and shows every iteration', async () => {
    stubFetch();
    const atlas = mockupBoard().groups.find((g) => g.path.endsWith('/data'))!.id;
    // Data: &21 (It. 17 → 19) and &23 (It. 20 → 21), #131 (It. 14), #130 (It. 18): nothing in It. 12 – 13.
    localStorage.setItem(
      'gleipnir.lanes',
      JSON.stringify([{ id: 'd', name: 'Data', color: 'blue', groups: [atlas], includeSubgroups: true, showEpics: true, issueMode: 'blocking', labels: [], labelMode: 'any', active: true }]),
    );
    localStorage.setItem('gleipnir.window', JSON.stringify({ from: 'gid://gitlab/Iteration/500', to: 'gid://gitlab/Iteration/501' }));
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText('Rien dans cette fenêtre')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Afficher toutes les itérations' }));
    expect(windowButton()).toHaveAccessibleName('Fenêtre : It. 12 – It. 21');
  });
});

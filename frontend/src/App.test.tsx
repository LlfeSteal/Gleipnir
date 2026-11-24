// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { mockupBoard } from './board/fixtures';
import { decodeView } from './board/share';

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
const urlView = () => decodeView(window.location.search);

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
    expect(document.querySelector('.summary-line')).toHaveTextContent(/^4 couloirs · \d+ epics · \d+ issues bloquantes/);
    expect(within(sidebar).getByText(/7 issues synchronisées ne bloquent aucun epic/)).toBeInTheDocument();
    // The default view has a plain URL, and nothing is stored in the browser.
    expect(window.location.search).toBe('');
    expect(localStorage.getItem('gleipnir.lanes')).toBeNull();
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

  it('checking a subgroup gives it its own lane, out of its parent\'s, and writes the groups in the URL', async () => {
    stubFetch();
    const { user, sidebar } = await renderApp();
    await user.click(screen.getByRole('button', { name: 'Itération suivante' }));
    await user.click(screen.getByRole('button', { name: 'Itération suivante' }));
    await user.click(screen.getByRole('button', { name: 'Itération suivante' }));
    const portal = () => screen.getAllByRole('button', { name: /^Epic &22 / });
    expect(within(screen.getByRole('region', { name: LANES[0] })).getByText('API & intégrations')).toBeInTheDocument();
    expect(portal()).toHaveLength(1);

    await user.click(within(sidebar).getByRole('button', { name: `Déplier ${LANES[0]}` }));
    await user.click(within(sidebar).getByRole('checkbox', { name: 'Partenaires' }));
    expect(screen.getByRole('region', { name: 'Partenaires' })).toHaveTextContent('API & intégrations › Partenaires');
    expect(portal()).toHaveLength(1);
    await waitFor(() => expect(urlView().groups).toEqual(['41', '45', '42', '43', '44']));
    // Read only: no lane to create or edit.
    expect(screen.queryByRole('button', { name: /^Modifier|Nouveau couloir/ })).toBeNull();
  });

  it('shows an empty state when no lane is active', async () => {
    stubFetch();
    const { user, sidebar } = await renderApp();
    for (const name of LANES) await user.click(within(sidebar).getByRole('checkbox', { name }));
    expect(screen.getByText('Aucun couloir affiché')).toBeInTheDocument();
    await waitFor(() => expect(window.location.search).toBe('?groups='));
    await user.click(screen.getByRole('button', { name: 'Afficher les couloirs par défaut' }));
    for (const name of LANES) expect(within(sidebar).getByRole('checkbox', { name })).toBeChecked();
    await waitFor(() => expect(window.location.search).toBe(''));
  });

  it('moves the window with the arrows and the presets, and writes it in the URL', async () => {
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
    await waitFor(() => expect(window.location.search).toBe('?from=500&to=509'));

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

  it('opens the view a URL asks for, and keeps it in the URL', async () => {
    stubFetch();
    const query = 'groups=41,44&fold=41&from=503&to=505&links=blocks&critical=1&q=SSO&item=1012';
    window.history.replaceState(null, '', `/?${query}`);
    const { sidebar } = await renderApp();
    expect(within(sidebar).getByRole('checkbox', { name: LANES[3] })).toBeChecked();
    expect(within(sidebar).getByRole('checkbox', { name: LANES[0] })).toBeChecked();
    expect(within(sidebar).getByRole('checkbox', { name: LANES[1] })).not.toBeChecked();
    expect(within(sidebar).getByRole('checkbox', { name: LANES[2] })).not.toBeChecked();
    expect(within(sidebar).getByRole('switch', { name: /Chemin critique/ })).toBeChecked();
    expect(within(sidebar).getByRole('checkbox', { name: /Lié à/ })).not.toBeChecked();
    expect(windowButton()).toHaveAccessibleName('Fenêtre : It. 15 – It. 17');
    expect(screen.getByRole('searchbox', { name: 'Rechercher un epic ou une issue' })).toHaveValue('SSO');
    expect(within(inspector()!).getByRole('heading', { name: 'Authentification SSO' })).toBeInTheDocument();
    await waitFor(() => expect(window.location.search).toBe(`?${query}`));
  });

  it('leaves the URL alone while the board fails to load', async () => {
    stubFetch(() => new Response('Bad Gateway', { status: 502 }));
    window.history.replaceState(null, '', '/?groups=&q=x');
    render(<App />);
    await screen.findByRole('alert');
    expect(window.location.search).toBe('?groups=&q=x');
  });

  it('copies a link of the view that names its iterations', async () => {
    stubFetch();
    const writeText = vi.fn(async (_text: string) => {});
    const { user, sidebar } = await renderApp();
    // user-event installs its own clipboard: replace it after setup.
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await user.click(within(sidebar).getByRole('checkbox', { name: LANES[1] }));
    const button = screen.getByRole('button', { name: 'Copier le lien' });
    await user.click(button);
    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/?groups=41,43,44&from=502&to=506`,
    );
    expect(button).toHaveAttribute('title', 'Lien copié');
  });
});

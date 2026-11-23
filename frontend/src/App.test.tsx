// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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
const storedLanes = () => JSON.parse(localStorage.getItem('gleipnir.lanes') ?? 'null') as { name: string }[] | null;

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
    // The defaults are kept, so their ids stay stable.
    await waitFor(() => expect(storedLanes()?.map((lane) => lane.name)).toEqual(LANES));
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
    expect(fetchMock).toHaveBeenLastCalledWith('/api/board?refresh=1', expect.anything());
  });

  it('keeps the board when a refresh fails', async () => {
    stubFetch(ok, () => new Response('Bad Gateway', { status: 502 }));
    const { user, sidebar } = await renderApp();
    await user.click(screen.getByRole('button', { name: 'Synchroniser' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Serveur injoignable');
    expect(within(sidebar).getByRole('checkbox', { name: LANES[0] })).toBeInTheDocument();
  });

  it('lane settings: Annuler leaves the lanes unchanged, Appliquer applies and persists', async () => {
    stubFetch();
    const { user, sidebar } = await renderApp();
    await waitFor(() => expect(storedLanes()).not.toBeNull());
    const before = localStorage.getItem('gleipnir.lanes');

    await user.click(within(sidebar).getByRole('button', { name: `Modifier ${LANES[1]}` }));
    let sheet = screen.getByRole('dialog', { name: 'Couloirs' });
    let name = within(sheet).getByRole('textbox', { name: 'Nom' });
    expect(name).toHaveValue(LANES[1]);
    await user.clear(name);
    await user.type(name, 'Données');
    await user.click(within(sheet).getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(sidebar).getByRole('checkbox', { name: LANES[1] })).toBeInTheDocument();
    expect(localStorage.getItem('gleipnir.lanes')).toBe(before);

    await user.click(within(sidebar).getByRole('button', { name: 'Modifier…' }));
    sheet = screen.getByRole('dialog', { name: 'Couloirs' });
    await user.click(within(sheet).getByRole('button', { name: new RegExp(`^${LANES[1]}`) }));
    name = within(sheet).getByRole('textbox', { name: 'Nom' });
    await user.clear(name);
    await user.type(name, 'Données');
    await user.click(within(sheet).getByRole('checkbox', { name: `Afficher ${LANES[0]}` }));
    await user.click(within(sheet).getByRole('button', { name: 'Appliquer' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(sidebar).getByRole('checkbox', { name: 'Données' })).toBeChecked();
    expect(within(sidebar).getByRole('checkbox', { name: LANES[0] })).not.toBeChecked();
    expect(storedLanes()?.map((lane) => lane.name)).toEqual([LANES[0], 'Données', LANES[2], LANES[3]]);
  });

  it('shows an empty state when no lane is active', async () => {
    stubFetch();
    const { user, sidebar } = await renderApp();
    for (const name of LANES) await user.click(within(sidebar).getByRole('checkbox', { name }));
    expect(screen.getByText('Aucun couloir affiché')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Configurer les couloirs' }));
    expect(screen.getByRole('dialog', { name: 'Couloirs' })).toBeInTheDocument();
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
    expect(JSON.parse(localStorage.getItem('gleipnir.window') ?? 'null')).toEqual({ from: 0, to: 9 });

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
});

// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BoardData } from '../api/types';
import { G, mockupBoard } from '../board/fixtures';
import { defaultChecked, lanesOf } from '../board/lanes';
import { DEFAULT_OPTIONS, type BoardView, type DisplayOptions } from '../board/types';
import { computeBoardView } from '../board/view';
import { Sidebar } from './Sidebar';

const data = mockupBoard();
const DEFAULT = new Set(defaultChecked(data));

function viewOf(checked: ReadonlySet<string>, options: DisplayOptions = DEFAULT_OPTIONS): BoardView {
  const lanes = lanesOf(data, checked);
  return computeBoardView({ data, lanes, window: { from: 2, to: 6 }, options, query: '', collapsed: new Set() });
}

function setup(
  over: Partial<{ data: BoardData; view: BoardView | null; checked: ReadonlySet<string>; options: DisplayOptions; overlay: boolean; shareLink: () => string }> = {},
) {
  const handlers = {
    onToggleGroup: vi.fn(),
    onOptionsChange: vi.fn(),
    onClose: vi.fn(),
  };
  const checked = over.checked ?? DEFAULT;
  render(
    <Sidebar
      id="sidebar"
      data={over.data ?? data}
      view={over.view === undefined ? viewOf(checked) : over.view}
      checked={checked}
      options={over.options ?? DEFAULT_OPTIONS}
      overlay={over.overlay ?? false}
      shareLink={over.shareLink}
      {...handlers}
    />,
  );
  return { ...handlers, user: userEvent.setup(), sidebar: screen.getByRole('complementary', { name: 'Filtres' }) };
}

const groupBox = (name: string) => screen.getByRole('checkbox', { name, exact: true });

describe('Sidebar', () => {
  it('lists the GitLab groups as a tree, checked ones with their shown item counts', () => {
    const view = viewOf(DEFAULT);
    setup({ view });
    const tree = screen.getByRole('list', { name: 'Groupes GitLab' });
    // The root, unfolded, and its subgroups; Partenaires is folded away under API.
    expect(within(tree).getAllByRole('checkbox').map((box) => box.getAttribute('aria-label'))).toEqual([
      'Atlas',
      'API & intégrations',
      'Data',
      'Expérience produit',
      'Identité & sécurité',
    ]);
    expect(groupBox('Atlas')).not.toBeChecked();
    expect(groupBox('Atlas')).not.toHaveAttribute('aria-describedby');
    for (const block of view.lanes) {
      const box = groupBox(block.lane.name);
      expect(box).toBeChecked();
      expect(box).toHaveAccessibleDescription(String(block.counts.epics + block.counts.issues));
    }
    expect(screen.getByText(/créez le groupe dans GitLab puis synchronisez/)).toBeInTheDocument();
    // Read only: nothing to create or edit.
    expect(screen.queryByRole('button', { name: /^Modifier|Nouveau couloir/ })).toBeNull();
  });

  it('unfolds and folds a branch, and opens those leading to a checked group', async () => {
    const { user } = setup();
    const api = screen.getByRole('button', { name: 'Déplier API & intégrations' });
    expect(api).toHaveAttribute('aria-expanded', 'false');
    await user.click(api);
    expect(groupBox('Partenaires')).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Replier API & intégrations' }));
    expect(screen.queryByRole('checkbox', { name: 'Partenaires' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Replier Atlas' }));
    expect(screen.getAllByRole('checkbox', { name: /^(?!Bloque|Lié à|Epic parent)/ })).toHaveLength(1);
    cleanup();
    setup({ checked: new Set([G.partenaires]) });
    expect(groupBox('Partenaires')).toBeChecked();
  });

  it('without a view (loading), groups show no count and links count 0', () => {
    setup({ view: null });
    expect(groupBox('Data')).not.toHaveAttribute('aria-describedby');
    expect(screen.getByRole('checkbox', { name: 'Bloque' })).toHaveAccessibleDescription('0');
  });

  it('checks and unchecks a group', async () => {
    const { user, onToggleGroup } = setup();
    await user.click(groupBox('Data'));
    expect(onToggleGroup).toHaveBeenCalledWith(G.data);
    await user.click(groupBox('Atlas'));
    expect(onToggleGroup).toHaveBeenLastCalledWith(data.rootGroup.path);
  });

  it('filters the item types', async () => {
    const { user, onOptionsChange } = setup();
    await user.click(screen.getByRole('switch', { name: 'Epics' }));
    expect(onOptionsChange).toHaveBeenLastCalledWith({ ...DEFAULT_OPTIONS, showEpics: false });
    await user.click(screen.getByRole('switch', { name: 'Issues bloquantes' }));
    expect(onOptionsChange).toHaveBeenLastCalledWith({ ...DEFAULT_OPTIONS, showIssues: false });
  });

  it('filters labels from a pop-up: pick, match mode, clear', async () => {
    const { user, onOptionsChange } = setup();
    const button = screen.getByRole('button', { name: 'Labels\u00a0: Tous les labels' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await user.click(button);
    const popup = screen.getByRole('dialog', { name: 'Labels' });
    await user.click(within(popup).getByRole('option', { name: /bug/ }));
    expect(onOptionsChange).toHaveBeenLastCalledWith({ ...DEFAULT_OPTIONS, labels: ['bug'] });
    await user.click(within(popup).getByRole('radio', { name: 'Tous' }));
    expect(onOptionsChange).toHaveBeenLastCalledWith({ ...DEFAULT_OPTIONS, labelMode: 'all' });
    expect(within(popup).queryByRole('button', { name: 'Tous les labels' })).toBeNull();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Labels' })).toBeNull();
    expect(button).toHaveFocus();

    cleanup();
    const picked = setup({ options: { ...DEFAULT_OPTIONS, labels: ['bug', 'UX'], labelMode: 'all' } });
    const active = screen.getByRole('button', { name: 'Labels\u00a0: bug, UX' });
    expect(active).toHaveAttribute('data-active', 'true');
    await picked.user.click(active);
    await picked.user.click(within(screen.getByRole('dialog', { name: 'Labels' })).getByRole('button', { name: 'Tous les labels' }));
    expect(picked.onOptionsChange).toHaveBeenLastCalledWith({ ...DEFAULT_OPTIONS, labels: [], labelMode: 'all' });
  });

  it('switches a link type off, keeping the others', async () => {
    const view = viewOf(DEFAULT);
    const { user, onOptionsChange } = setup({ view });
    expect(screen.getByRole('checkbox', { name: 'Bloque' })).toHaveAccessibleDescription(String(view.linkCounts.blocks));
    await user.click(screen.getByRole('checkbox', { name: 'Lié à' }));
    expect(onOptionsChange).toHaveBeenCalledWith({ ...DEFAULT_OPTIONS, linkTypes: { ...DEFAULT_OPTIONS.linkTypes, relates: !DEFAULT_OPTIONS.linkTypes.relates } });
  });

  it('changes the display options', async () => {
    const { user, onOptionsChange } = setup();
    await user.click(screen.getByRole('switch', { name: 'Masquer les issues fermées' }));
    expect(onOptionsChange).toHaveBeenLastCalledWith({ ...DEFAULT_OPTIONS, hideClosed: !DEFAULT_OPTIONS.hideClosed });
    await user.click(screen.getByRole('switch', { name: 'Afficher les non planifiés' }));
    expect(onOptionsChange).toHaveBeenLastCalledWith({ ...DEFAULT_OPTIONS, showUnplanned: !DEFAULT_OPTIONS.showUnplanned });
    await user.click(screen.getByRole('switch', { name: /Chemin critique/ }));
    expect(onOptionsChange).toHaveBeenLastCalledWith({ ...DEFAULT_OPTIONS, criticalPath: !DEFAULT_OPTIONS.criticalPath });
  });

  it('has a header and a close button only as an overlay', async () => {
    setup();
    expect(screen.queryByRole('button', { name: 'Fermer les filtres' })).not.toBeInTheDocument();
  });

  it('closes from its overlay header', async () => {
    const { user, onClose, sidebar } = setup({ overlay: true });
    expect(sidebar).toHaveAttribute('data-overlay', 'true');
    expect(within(sidebar).getByRole('heading', { level: 2, name: 'Filtres' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fermer les filtres' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('holds the copy-link button in its overlay header only', () => {
    setup({ shareLink: () => 'http://x/' });
    expect(screen.queryByRole('button', { name: 'Copier le lien' })).toBeNull();
    cleanup();
    setup({ overlay: true, shareLink: () => 'http://x/' });
    expect(screen.getByRole('button', { name: 'Copier le lien' })).toBeInTheDocument();
  });

  it('counts the ignored issues, singular and plural, and hides the note at 0', () => {
    setup({ data: { ...data, ignoredIssues: 0 } });
    expect(screen.queryByText(/ne bloquen?t? aucun epic/)).not.toBeInTheDocument();
  });

  it.each([
    [1, '1 issue synchronisée ne bloque aucun epic : elle n’est pas affichée.'],
    [7, '7 issues synchronisées ne bloquent aucun epic : elles ne sont pas affichées.'],
  ])('ignored issues: %i', (n, text) => {
    setup({ data: { ...data, ignoredIssues: n } });
    expect(screen.getByText(text)).toBeInTheDocument();
  });
});

// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BoardData } from '../api/types';
import { mockupBoard } from '../board/fixtures';
import { defaultLanes } from '../board/lanes';
import { DEFAULT_OPTIONS, type BoardView, type DisplayOptions, type Lane } from '../board/types';
import { computeBoardView } from '../board/view';
import { Sidebar } from './Sidebar';

const data = mockupBoard();
const lanes = defaultLanes(data);

function viewOf(ls: Lane[]): BoardView {
  return computeBoardView({ data, lanes: ls, window: { from: 2, to: 6 }, options: DEFAULT_OPTIONS, query: '', collapsed: new Set() });
}

function setup(over: Partial<{ data: BoardData; view: BoardView | null; lanes: Lane[]; options: DisplayOptions; overlay: boolean }> = {}) {
  const handlers = {
    onToggleLane: vi.fn(),
    onEditLane: vi.fn(),
    onNewLane: vi.fn(),
    onConfigure: vi.fn(),
    onOptionsChange: vi.fn(),
    onClose: vi.fn(),
  };
  const ls = over.lanes ?? lanes;
  render(
    <Sidebar
      id="sidebar"
      data={over.data ?? data}
      view={over.view === undefined ? viewOf(ls) : over.view}
      lanes={ls}
      options={over.options ?? DEFAULT_OPTIONS}
      overlay={over.overlay ?? false}
      {...handlers}
    />,
  );
  return { ...handlers, user: userEvent.setup(), sidebar: screen.getByRole('complementary', { name: 'Filtres' }) };
}

describe('Sidebar', () => {
  it('lists the lanes with their shown item counts', () => {
    const view = viewOf(lanes);
    setup({ view });
    for (const block of view.lanes) {
      const box = screen.getByRole('checkbox', { name: block.lane.name });
      expect(box).toBeChecked();
      const count = block.counts.epics + block.counts.issues;
      expect(box).toHaveAccessibleDescription(String(count));
    }
    expect(screen.queryByText('Aucun couloir.')).not.toBeInTheDocument();
  });

  it('an inactive lane is unchecked and has no count; without a view, no lane has one', () => {
    const ls = lanes.map((lane, i) => (i === 0 ? { ...lane, active: false } : lane));
    setup({ lanes: ls });
    expect(screen.getByRole('checkbox', { name: ls[0].name })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: ls[0].name })).not.toHaveAttribute('aria-describedby');
    expect(screen.getByRole('checkbox', { name: ls[1].name })).toHaveAttribute('aria-describedby');
  });

  it('without a view (loading), lanes show no count and links count 0', () => {
    setup({ view: null });
    expect(screen.getByRole('checkbox', { name: lanes[0].name })).not.toHaveAttribute('aria-describedby');
    expect(screen.getByRole('checkbox', { name: 'Bloque' })).toHaveAccessibleDescription('0');
  });

  it('says when there is no lane', () => {
    setup({ lanes: [] });
    expect(screen.getByText('Aucun couloir.')).toBeInTheDocument();
  });

  it('toggles, edits and adds lanes, and opens the settings', async () => {
    const { user, onToggleLane, onEditLane, onNewLane, onConfigure } = setup();
    await user.click(screen.getByRole('checkbox', { name: lanes[1].name }));
    expect(onToggleLane).toHaveBeenCalledWith(lanes[1].id);
    await user.click(screen.getByRole('button', { name: `Modifier ${lanes[2].name}` }));
    expect(onEditLane).toHaveBeenCalledWith(lanes[2].id);
    await user.click(screen.getByRole('button', { name: 'Nouveau couloir' }));
    expect(onNewLane).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Modifier…' }));
    expect(onConfigure).toHaveBeenCalledOnce();
  });

  it('switches a link type off, keeping the others', async () => {
    const view = viewOf(lanes);
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

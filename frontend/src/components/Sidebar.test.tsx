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
const LANES = defaultLanes(data);

function viewOf(lanes: Lane[], options: DisplayOptions = DEFAULT_OPTIONS): BoardView {
  return computeBoardView({ data, lanes, window: { from: 2, to: 6 }, options, query: '', collapsed: new Set() });
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
  const lanes = over.lanes ?? LANES;
  render(
    <Sidebar
      id="sidebar"
      data={over.data ?? data}
      view={over.view === undefined ? viewOf(lanes) : over.view}
      lanes={lanes}
      options={over.options ?? DEFAULT_OPTIONS}
      overlay={over.overlay ?? false}
      {...handlers}
    />,
  );
  return { ...handlers, user: userEvent.setup(), sidebar: screen.getByRole('complementary', { name: 'Filtres' }) };
}

const laneBox = (name: string) => screen.getByRole('checkbox', { name });

describe('Sidebar', () => {
  it('lists the lanes in order, with their color and shown item counts (spec §4.8)', () => {
    const view = viewOf(LANES);
    setup({ view });
    const rows = screen.getByRole('heading', { name: 'Couloirs' }).closest('section')!.querySelectorAll('.sidebar-lane');
    expect([...rows].map((r) => r.textContent?.replace(/\d+$/, ''))).toEqual(LANES.map((l) => l.name));
    expect(rows[0]).toHaveAttribute('data-lane-color', 'indigo');
    const api = view.lanes[0].counts;
    expect(laneBox('API & intégrations')).toBeChecked();
    expect(laneBox('API & intégrations')).toHaveAccessibleDescription(String(api.epics + api.issues));
  });

  it('shows an inactive lane unchecked, without a count; without a view, no count at all', () => {
    const lanes = LANES.map((l, i) => (i === 1 ? { ...l, active: false } : l));
    setup({ lanes });
    expect(laneBox('Data')).not.toBeChecked();
    expect(laneBox('Data')).not.toHaveAttribute('aria-describedby');
    expect(laneBox('Data').closest('.sidebar-lane')).not.toHaveAttribute('data-checked');
  });

  it('without a view (loading), lanes show no count and links count 0', () => {
    setup({ view: null });
    expect(laneBox('Data')).not.toHaveAttribute('aria-describedby');
    expect(screen.getByRole('checkbox', { name: 'Bloque' })).toHaveAccessibleDescription('0');
  });

  it('shows, hides, edits and creates lanes', async () => {
    const { user, onToggleLane, onEditLane, onNewLane, onConfigure } = setup();
    await user.click(laneBox('Data'));
    expect(onToggleLane).toHaveBeenCalledWith(LANES[1].id);
    await user.click(screen.getByRole('button', { name: 'Modifier Data' }));
    expect(onEditLane).toHaveBeenCalledWith(LANES[1].id);
    await user.click(screen.getByRole('button', { name: 'Nouveau couloir' }));
    expect(onNewLane).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Configurer…' }));
    expect(onConfigure).toHaveBeenCalledOnce();
  });

  it('says when there is no lane', () => {
    setup({ lanes: [] });
    expect(screen.getByText('Aucun couloir.')).toBeInTheDocument();
  });

  it('switches a link type off, keeping the others', async () => {
    const view = viewOf(LANES);
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

  it('has no global item type or label filter: they belong to the lanes', () => {
    setup();
    expect(screen.queryByRole('switch', { name: 'Epics' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Labels/ })).not.toBeInTheDocument();
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

  it('tells how many synced issues block an epic (spec §5.1)', () => {
    setup();
    expect(screen.getByText('9 sur 12 issues synchronisées bloquent un epic.')).toBeInTheDocument();
  });

  it.each([
    [[true], '1 sur 1 issue synchronisée bloque un epic.'],
    [[false, false], '0 sur 2 issues synchronisées bloque un epic.'],
  ])('blocking issues: %j', (blocking, text) => {
    const issues = blocking.map((b, i) => ({ ...data.issues[i], blocksEpics: b ? data.issues[i].blocksEpics : [] }));
    setup({ data: { ...data, issues } });
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('hides the note without any issue', () => {
    setup({ data: { ...data, issues: [] } });
    expect(screen.queryByText(/issues? synchronisées?/)).not.toBeInTheDocument();
  });

  it('explains both dependency badges in its legend (spec §4.5)', () => {
    setup();
    const legend = screen.getByRole('heading', { name: 'Repères' }).closest('section')!;
    expect(legend).toHaveTextContent('Dépendances dans un couloir, hors de la fenêtre');
    expect(legend).toHaveTextContent('Dépendances dans aucun couloir actif');
    expect(legend.querySelector('.off-pill')).not.toBeNull();
    expect(legend.querySelector('.off-lanes-pill')).not.toBeNull();
  });
});

// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { G, mockupBoard } from '../../board/fixtures';
import { DEFAULT_OPTIONS, type Lane } from '../../board/types';
import { computeBoardView } from '../../board/view';
import { LaneRail } from './LaneRail';

const data = mockupBoard();

function lane(over: Partial<Lane>): Lane {
  return {
    id: over.name ?? 'lane',
    name: 'Couloir',
    color: 'blue',
    groups: [G.api],
    includeSubgroups: true,
    showEpics: true,
    showIssues: true,
    labels: [],
    labelMode: 'any',
    active: true,
    ...over,
  };
}

function renderRail(lanes: Lane[], collapsed: string[] = [], window = { from: 2, to: 6 }) {
  const view = computeBoardView({ data, lanes, window, options: DEFAULT_OPTIONS, query: '', collapsed: new Set(collapsed) });
  const handlers = { onToggleLane: vi.fn(), onEditLane: vi.fn() };
  render(<LaneRail view={view} data={data} {...handlers} />);
  return { ...handlers, view, user: userEvent.setup() };
}

const header = (name: string) => screen.getByRole('region', { name });

describe('LaneRail', () => {
  it('summarizes a lane: groups with subgroups, label filter, counts by type', () => {
    const { view } = renderRail([lane({ name: 'Tout', groups: [G.api, G.data], labels: ['bug', 'inconnu'], labelMode: 'all' })]);
    const h = header('Tout');
    expect(h).toHaveTextContent('API & intégrations, Data + sous-groupes');
    expect(h).toHaveTextContent('· tous');
    expect(within(h).getByText('bug').style.getPropertyValue('--label-color')).toBe('#e0532f');
    expect(within(h).getByText('inconnu').style.getPropertyValue('--label-color')).toBe('');
    const counts = view.lanes[0].counts;
    expect(within(h).getByTitle(counts.epics > 1 ? `${counts.epics} epics` : `${counts.epics} epic`)).toBeInTheDocument();
  });

  it('a lane without group, subgroups or label filter; any-label mode', () => {
    renderRail([
      lane({ name: 'Vide', groups: [] }),
      lane({ name: 'Exact', includeSubgroups: false, labels: ['UX'], labelMode: 'any' }),
    ]);
    expect(header('Vide')).toHaveTextContent('aucun groupe');
    expect(header('Vide')).not.toHaveTextContent('sous-groupes');
    expect(header('Exact')).not.toHaveTextContent('sous-groupes');
    expect(header('Exact')).toHaveTextContent('· au moins un');
  });

  it('shows only the counts of the types the lane shows', () => {
    renderRail([lane({ name: 'Epics', showIssues: false }), lane({ name: 'Issues', showEpics: false })]);
    expect(within(header('Epics')).getByText('epics')).toBeInTheDocument();
    expect(within(header('Epics')).queryByText('issues')).not.toBeInTheDocument();
    expect(within(header('Issues')).queryByText('epics')).not.toBeInTheDocument();
    expect(within(header('Issues')).getByText('issues')).toBeInTheDocument();
  });

  it('counts the items outside the window', () => {
    const { view } = renderRail([lane({ name: 'Large', groups: [data.rootGroup.path] })], [], { from: 3, to: 3 });
    const outside = view.lanes[0].counts.outside;
    expect(outside).toBeGreaterThan(0);
    expect(header('Large')).toHaveTextContent(`${outside} hors fenêtre`);
  });

  it('a collapsed lane hides its filters and offers to expand', async () => {
    const l = lane({ name: 'Plié', labels: ['bug'] });
    const { user, onToggleLane, onEditLane } = renderRail([l], [l.id]);
    const h = header('Plié');
    expect(h).toHaveAttribute('data-collapsed', 'true');
    expect(h).not.toHaveTextContent('sous-groupes');
    expect(within(h).queryByText('bug')).not.toBeInTheDocument();
    const chevron = within(h).getByRole('button', { name: 'Déplier le couloir Plié' });
    expect(chevron).toHaveAttribute('aria-expanded', 'false');
    await user.click(chevron);
    expect(onToggleLane).toHaveBeenCalledWith(l.id);
    await user.click(within(h).getByRole('button', { name: 'Modifier le couloir Plié' }));
    expect(onEditLane).toHaveBeenCalledWith(l.id);
  });
});

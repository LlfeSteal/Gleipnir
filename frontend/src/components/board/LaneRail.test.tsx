// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { G, mockupBoard } from '../../board/fixtures';
import { defaultLanes } from '../../board/lanes';
import { DEFAULT_OPTIONS, type Lane } from '../../board/types';
import { computeBoardView } from '../../board/view';
import { LaneRail } from './LaneRail';

const data = mockupBoard();
const gid = (path: string) => data.groups.find((g) => g.path === path)!.id;
const api = defaultLanes(data)[0];

function renderRail(lanes: Lane[], collapsed: string[] = [], window = { from: 2, to: 6 }) {
  const view = computeBoardView({ data, lanes, window, options: DEFAULT_OPTIONS, query: '', collapsed: new Set(collapsed) });
  const handlers = { onToggleLane: vi.fn(), onEditLane: vi.fn() };
  render(<LaneRail view={view} data={data} {...handlers} />);
  return { ...handlers, view, user: userEvent.setup() };
}

const header = (name: string) => screen.getByRole('region', { name });

describe('LaneRail', () => {
  it('shows a lane: name, color, groups with subgroups, issue mode and counts by type (spec §4.1)', () => {
    const { view } = renderRail([api]);
    const h = header('API & intégrations');
    expect(h).toHaveAttribute('data-lane-color', 'indigo');
    expect(h).toHaveTextContent('API & intégrations + sous-groupes');
    expect(h).toHaveTextContent('issues bloquantes');
    const counts = view.lanes[0].counts;
    expect(within(h).getByTitle(`${counts.epics} epics`)).toBeInTheDocument();
    expect(within(h).getByTitle(`${counts.issues} issues`)).toBeInTheDocument();
  });

  it('shows the labels and their mode, and hides the counts of a type the lane leaves out', () => {
    renderRail([{ ...api, groups: [gid(G.api), gid(G.data)], includeSubgroups: false, labels: ['API', 'bug'], labelMode: 'all', issueMode: 'none' }]);
    const h = header('API & intégrations');
    expect(h).toHaveTextContent('API & intégrations, Data');
    expect(h).not.toHaveTextContent('sous-groupes');
    expect(h).toHaveTextContent('aucune issue');
    expect(within(h).getByText('API').closest<HTMLElement>('.lane-label')!.style.getPropertyValue('--label-color')).toBe('#14a08a');
    expect(h).toHaveTextContent('Labels · tous');
    expect(within(h).queryByTitle(/issues?$/)).toBeNull();
    renderRail([{ ...api, id: 'b', name: 'B', showEpics: false, issueMode: 'all', labels: ['API'] }]);
    expect(header('B')).toHaveTextContent('toutes les issues');
    expect(header('B')).toHaveTextContent('Labels · au moins un');
    expect(within(header('B')).queryByTitle(/epics?$/)).toBeNull();
  });

  it('offers to edit the lane', async () => {
    const { user, onEditLane } = renderRail([api]);
    await user.click(screen.getByRole('button', { name: 'Modifier le couloir API & intégrations' }));
    expect(onEditLane).toHaveBeenCalledWith(api.id);
  });

  it('counts the items outside the window; a lane without a known group says so', () => {
    const { view } = renderRail([{ ...api, name: 'Tout', groups: [gid(data.rootGroup.path)] }, { ...api, id: 'x', name: 'X', groups: ['gid://gitlab/Group/999'] }], [], {
      from: 3,
      to: 3,
    });
    const outside = view.lanes[0].counts.outside;
    expect(outside).toBeGreaterThan(0);
    expect(header('Tout')).toHaveTextContent(`${outside} hors fenêtre`);
    expect(header('X')).toHaveTextContent('aucun groupe');
  });

  it('a collapsed lane hides its filters and offers to expand', async () => {
    const lane = defaultLanes(data)[1];
    const { user, onToggleLane } = renderRail([lane], [lane.id]);
    const h = header('Data');
    expect(h).toHaveAttribute('data-collapsed', 'true');
    expect(h).not.toHaveTextContent('issues bloquantes');
    const chevron = within(h).getByRole('button', { name: 'Déplier le couloir Data' });
    expect(chevron).toHaveAttribute('aria-expanded', 'false');
    await user.click(chevron);
    expect(onToggleLane).toHaveBeenCalledWith(lane.id);
  });
});

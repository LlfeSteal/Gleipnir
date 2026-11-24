// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { G, mockupBoard } from '../../board/fixtures';
import { lanesOf } from '../../board/lanes';
import { DEFAULT_OPTIONS } from '../../board/types';
import { computeBoardView } from '../../board/view';
import { LaneRail } from './LaneRail';

const data = mockupBoard();

function renderRail(groups: string[], collapsed: string[] = [], window = { from: 2, to: 6 }) {
  const lanes = lanesOf(data, new Set(groups));
  const view = computeBoardView({ data, lanes, window, options: DEFAULT_OPTIONS, query: '', collapsed: new Set(collapsed) });
  const handlers = { onToggleLane: vi.fn() };
  render(<LaneRail view={view} {...handlers} />);
  return { ...handlers, view, user: userEvent.setup() };
}

const header = (name: string) => screen.getByRole('region', { name });

describe('LaneRail', () => {
  it('names a lane after its GitLab group, with its path and counts by type', () => {
    const { view } = renderRail([G.api]);
    const h = header('API & intégrations');
    expect(h).toHaveAttribute('data-lane-color', 'indigo');
    expect(h).toHaveTextContent(G.api);
    const counts = view.lanes[0].counts;
    expect(within(h).getByTitle(`${counts.epics} epics`)).toBeInTheDocument();
    expect(within(h).getByTitle(`${counts.issues} issues`)).toBeInTheDocument();
    expect(within(h).getByText('epics')).toBeInTheDocument();
    expect(within(h).getByText('issues')).toBeInTheDocument();
  });

  it('says where a sublane sits, and never offers to edit a lane', () => {
    renderRail([G.partenaires], [], { from: 7, to: 9 });
    const h = header('Partenaires');
    expect(h).toHaveTextContent('API & intégrations › Partenaires');
    expect(within(h).getByTitle(`${1} epic`)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Modifier/ })).toBeNull();
  });

  it('counts the items outside the window', () => {
    const { view } = renderRail([data.rootGroup.path], [], { from: 3, to: 3 });
    const outside = view.lanes[0].counts.outside;
    expect(outside).toBeGreaterThan(0);
    expect(header('Atlas')).toHaveTextContent(`${outside} hors fenêtre`);
  });

  it('a collapsed lane hides its path and offers to expand', async () => {
    const { user, onToggleLane } = renderRail([G.data], [G.data]);
    const h = header('Data');
    expect(h).toHaveAttribute('data-collapsed', 'true');
    expect(h).not.toHaveTextContent(G.data);
    const chevron = within(h).getByRole('button', { name: 'Déplier le couloir Data' });
    expect(chevron).toHaveAttribute('aria-expanded', 'false');
    await user.click(chevron);
    expect(onToggleLane).toHaveBeenCalledWith(G.data);
  });
});

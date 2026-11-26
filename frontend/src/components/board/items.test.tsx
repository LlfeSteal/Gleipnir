// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Epic, Issue, LinkType } from '../../api/types';
import { epicId, issueId, mockupBoard } from '../../board/fixtures';
import { findItem } from '../../board/items';
import type { BoardView, LinkPath, PlacedItem } from '../../board/types';
import { EpicBar } from './EpicBar';
import { IssueCard } from './IssueCard';
import { ColumnHeaders } from './ColumnHeaders';
import { LinkLayer } from './LinkLayer';
import { OffLanesPill } from './OffLanesPill';
import { OffWindowPill } from './OffWindowPill';

// Unit tests of the canvas parts, for the states the mockup dataset doesn't reach through
// BoardCanvas.

const data = mockupBoard();
const baseEpic = findItem(data, epicId(12))!.item as Epic;
const baseIssue = data.issues.find((i) => i.labels.length > 0 && i.assignee)!;

function placed(over: Partial<PlacedItem> = {}): PlacedItem {
  return {
    key: 'lane|item',
    laneId: 'lane',
    itemId: 'item',
    kind: 'epic',
    rect: { x: 10, y: 20, w: 300, h: 28 },
    clippedStart: false,
    clippedEnd: false,
    unplanned: false,
    offWindow: [],
    offLanes: [],
    searchContext: false,
    ...over,
  };
}

const common = { data, selected: false, related: false, critical: false, offWindowRefs: [] as string[], offLanesRefs: [] as string[] };

describe('EpicBar', () => {
  it('a plain bar: no clip, no pill, open', () => {
    const onToggle = vi.fn();
    render(<EpicBar {...common} placed={placed()} epic={baseEpic} onToggle={onToggle} />);
    const bar = screen.getByRole('button', { name: `Epic &12 ${baseEpic.title}` });
    expect(bar).toHaveAttribute('aria-pressed', 'false');
    expect(bar).not.toHaveAttribute('data-closed');
    expect(bar).not.toHaveAttribute('aria-description');
    expect(bar.style.left).toBe('10px');
    expect(bar.style.width).toBe('300px');
    expect(bar.querySelector('.epic-clip')).toBeNull();
    expect(bar.querySelector('.off-pill')).toBeNull();
    expect(bar.querySelector('.off-lanes-pill')).toBeNull();
  });

  it('shows its dependencies outside every lane in full, after those off the window (spec §4.5)', () => {
    render(<EpicBar {...common} offWindowRefs={['&21']} offLanesRefs={['&30', '#7']} placed={placed()} epic={baseEpic} onToggle={vi.fn()} />);
    const bar = screen.getByRole('button');
    const pill = bar.querySelector('.off-lanes-pill')!;
    expect(pill).toHaveTextContent('2 hors couloirs');
    expect(pill).toHaveAttribute('title', 'Dépendances hors couloirs : &30, #7');
    expect(pill.querySelector('svg')).not.toBeNull();
    expect(bar).toHaveAttribute('aria-description', 'Dépendance hors fenêtre : &21. Dépendances hors couloirs : &30, #7');
  });

  it('marks a dependency brought in by the search, not a match', () => {
    const { rerender } = render(<EpicBar {...common} placed={placed({ searchContext: true })} epic={baseEpic} onToggle={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveAttribute('data-search-context', 'true');
    rerender(<EpicBar {...common} placed={placed()} epic={baseEpic} onToggle={vi.fn()} />);
    expect(screen.getByRole('button')).not.toHaveAttribute('data-search-context');
  });

  it('clipped on both sides: chevrons give the real start and end', () => {
    render(<EpicBar {...common} placed={placed({ clippedStart: true, clippedEnd: true })} epic={{ ...baseEpic, start: 0, end: 9 }} onToggle={vi.fn()} />);
    expect(screen.getByTitle('Commence en It. 12')).toBeInTheDocument();
    expect(screen.getByTitle('Se termine en It. 21')).toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveAttribute('data-clipped-start', 'true');
    expect(screen.getByRole('button')).toHaveAttribute('data-clipped-end', 'true');
  });

  it('a clipped side of an unplanned or out-of-range epic has an empty iteration', () => {
    render(<EpicBar {...common} placed={placed({ clippedStart: true, clippedEnd: true })} epic={{ ...baseEpic, start: null, end: 42 }} onToggle={vi.fn()} />);
    const clips = [...screen.getByRole('button').querySelectorAll('.epic-clip')].map((c) => c.getAttribute('title'));
    expect(clips).toEqual(['Commence en ', 'Se termine en ']);
  });

  it('closed, selected, related, critical, unplanned, with dependencies off the window', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <EpicBar
        {...common}
        selected
        related
        critical
        offWindowRefs={['#110', '&21']}
        placed={placed({ unplanned: true })}
        epic={{ ...baseEpic, state: 'closed' }}
        onToggle={onToggle}
      />,
    );
    const bar = screen.getByRole('button', { name: `Epic &12 ${baseEpic.title}, fermé` });
    for (const attr of ['data-closed', 'data-related', 'data-critical', 'data-unplanned']) expect(bar).toHaveAttribute(attr, 'true');
    expect(bar).toHaveAttribute('aria-pressed', 'true');
    expect(bar).toHaveAttribute('aria-description', 'Dépendances hors fenêtre : #110, &21');
    expect(screen.getByText('› 2')).toBeInTheDocument();
    await user.click(bar);
    expect(onToggle).toHaveBeenCalledWith(epicId(12));
  });
});

describe('IssueCard', () => {
  const issue = (over: Partial<Issue>): Issue => ({ ...baseIssue, ...over });
  const card = (i: Issue, extra: Partial<typeof common> = {}) =>
    render(<IssueCard {...common} {...extra} placed={placed({ kind: 'issue' })} issue={i} onToggle={vi.fn()} />);

  it('an open issue: state icon, assignee initials, blocked epics, labels', () => {
    card(issue({ assignee: { name: 'Sofia Nguyen', username: 'sn' }, labels: ['bug'], blocksEpics: [epicId(12), 'unknown', epicId(21)] }));
    expect(screen.getByRole('button')).not.toHaveAttribute('data-closed');
    expect(screen.queryByText('Fermée')).not.toBeInTheDocument();
    expect(screen.getByTitle('Sofia Nguyen')).toHaveTextContent('SN');
    expect(screen.getByText('Bloque &12, &21')).toBeInTheDocument();
    expect(screen.getByText('bug').closest<HTMLElement>('.issue-label')!.style.getPropertyValue('--label-color')).toBe('#e0532f');
  });

  it.each([
    ['one word', 'Ada', 'A'],
    ['three words', 'jean  claude van damme', 'JD'],
    ['padded', '  Chloé Dubois  ', 'CD'],
    ['blank', '   ', ''],
  ])('initials of %s', (_name, name, want) => {
    card(issue({ assignee: { name, username: 'x' } }));
    // Not by title: Testing Library would normalize the padded names.
    expect(screen.getByRole('button').querySelector('.avatar')!.textContent).toBe(want);
  });

  it('a closed issue without assignee, blocked epic or label: « Ne bloque aucun epic »', () => {
    card(issue({ state: 'closed', assignee: null, blocksEpics: ['unknown'], labels: [] }));
    const button = screen.getByRole('button', { name: new RegExp(`, fermée$`) });
    expect(button).toHaveAttribute('data-closed', 'true');
    expect(screen.getByText('Fermée')).toBeInTheDocument();
    expect(button.querySelector('.avatar')).toBeNull();
    expect(button.querySelector('.issue-blocks')).toHaveTextContent('Ne bloque aucun epic');
    expect(button.querySelector('.issue-blocks')).toHaveAttribute('data-none', 'true');
    expect(button.querySelector('.issue-labels')).toBeNull();
  });

  it('an issue that blocks no epic says so (spec §4.2)', () => {
    card(issue({ blocksEpics: [] }));
    expect(screen.getByText('Ne bloque aucun epic')).toBeInTheDocument();
    expect(screen.getByRole('button').querySelector('.issue-blocks svg')).toBeNull();
  });

  it('shows its dependencies outside every lane as an icon and a number, the label in the tooltip', () => {
    card(issue({}), { offLanesRefs: ['&30'] });
    const pill = screen.getByTitle('Dépendance hors couloirs : &30');
    expect(pill).toHaveTextContent(/^1$/);
    expect(pill).toHaveAttribute('data-compact', 'true');
    expect(screen.getByRole('button')).toHaveAttribute('aria-description', 'Dépendance hors couloirs : &30');
  });

  it('marks a dependency brought in by the search', () => {
    render(<IssueCard {...common} placed={placed({ kind: 'issue', searchContext: true })} issue={baseIssue} onToggle={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveAttribute('data-search-context', 'true');
    cleanup();
    card(baseIssue);
    expect(screen.getByRole('button')).not.toHaveAttribute('data-search-context');
  });

  it('shows two labels at most, then +N; an unknown label has no color', () => {
    card(issue({ labels: ['bug', 'UX', 'data', 'mobile', 'inconnu'] }));
    expect(screen.getByText('bug')).toBeInTheDocument();
    expect(screen.getByText('UX')).toBeInTheDocument();
    expect(screen.queryByText('data')).not.toBeInTheDocument();
    expect(screen.getByText('+3')).toBeInTheDocument();
  });

  it('exactly two labels: no +N', () => {
    card(issue({ labels: ['bug', 'inconnu'] }));
    expect(screen.queryByText(/^\+/)).not.toBeInTheDocument();
    expect(screen.getByText('inconnu').closest<HTMLElement>('.issue-label')!.style.getPropertyValue('--label-color')).toBe('');
  });

  it('one dependency off the window: singular tooltip', () => {
    card(issue({}), { offWindowRefs: ['&21'], selected: true });
    expect(screen.getByRole('button')).toHaveAttribute('aria-description', 'Dépendance hors fenêtre : &21');
    expect(screen.getByTitle('Dépendance hors fenêtre : &21')).toHaveTextContent('› 1');
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('reports its id when clicked', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<IssueCard {...common} placed={placed({ kind: 'issue' })} issue={baseIssue} onToggle={onToggle} />);
    await user.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledWith(baseIssue.id);
  });
});

describe('OffWindowPill and OffLanesPill', () => {
  it('render nothing without refs', () => {
    expect(render(<OffWindowPill refs={[]} />).container).toBeEmptyDOMElement();
    expect(render(<OffLanesPill refs={[]} />).container).toBeEmptyDOMElement();
  });
});

describe('ColumnHeaders', () => {
  it('marks the current iteration and ends with the unplanned column', () => {
    const view = {
      width: 1000,
      headerHeight: 40,
      railWidth: 200,
      columns: [
        { key: 'a', width: 200, current: false, iteration: data.iterations[2] },
        { key: 'b', width: 200, current: true, iteration: data.iterations[3] },
        { key: 'u', width: 200, current: false, iteration: null },
      ],
    } as unknown as BoardView;
    const { container } = render(<ColumnHeaders view={view} />);
    const headers = container.querySelectorAll('.column-header');
    expect(headers).toHaveLength(3);
    expect(headers[0]).not.toHaveAttribute('aria-current');
    expect(headers[0]).toHaveTextContent('Itération 14');
    expect(headers[1]).toHaveAttribute('aria-current', 'date');
    expect(headers[1]).toHaveTextContent('En cours');
    expect(headers[1]).toHaveTextContent('18 nov. – 1 déc.');
    expect(headers[2]).toHaveAttribute('data-unplanned', 'true');
    expect(headers[2]).toHaveTextContent('Non planifié');
    expect(screen.getByText('Couloirs')).toBeInTheDocument();
  });
});

describe('LinkLayer', () => {
  const link = (key: string, over: Partial<LinkPath> = {}): LinkPath =>
    ({ key, type: 'blocks' as LinkType, source: issueId(1), target: epicId(1), conflict: false, critical: false, d: 'M0 0L1 1', arrow: 'M1 1L2 2', ...over }) as LinkPath;

  it('draws the critical links last, and marks the ones touching the selection', () => {
    const links = [
      link('crit', { critical: true }),
      link('plain', { type: 'relates', arrow: null, source: 'x', target: 'y' }),
      link('conflict', { conflict: true }),
    ];
    const { container, rerender } = render(<LinkLayer links={links} width={100} height={50} selectedId={null} />);
    const groups = [...container.querySelectorAll('g.link')];
    expect(groups.map((g) => g.querySelector('.link-curve') && g.getAttribute('data-critical'))).toEqual([null, null, 'true']);
    expect(groups[0].querySelector('.link-arrow')).toBeNull();
    expect(groups[1]).toHaveAttribute('data-conflict', 'true');
    expect(container.querySelectorAll('[data-connected]')).toHaveLength(0);

    rerender(<LinkLayer links={links} width={100} height={50} selectedId={epicId(1)} />);
    expect(container.querySelectorAll('[data-connected]')).toHaveLength(2);
    rerender(<LinkLayer links={links} width={100} height={50} selectedId="y" />);
    expect(container.querySelectorAll('[data-connected]')).toHaveLength(1);
  });

  it('an empty board draws an empty, hidden SVG', () => {
    const { container } = render(<LinkLayer links={[]} width={0} height={0} selectedId={null} />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg.childElementCount).toBe(0);
  });
});

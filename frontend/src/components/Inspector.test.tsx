// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BoardData, Epic, Issue, Link } from '../api/types';
import { G, mockupBoard } from '../board/fixtures';
import { defaultChecked, lanesOf } from '../board/lanes';
import type { BoardWindow } from '../board/types';
import { Inspector } from './Inspector';

const defaultLanes = (data: BoardData) => lanesOf(data, new Set(defaultChecked(data)));

const id = (name: string) => `gid://gitlab/WorkItem/${name}`;

function epic(name: string, over: Partial<Epic> = {}): Epic {
  return {
    id: id(name),
    iid: name,
    ref: `&${name}`,
    groupPath: G.identite,
    title: `Epic ${name}`,
    labels: [],
    state: 'open',
    start: 2,
    end: 4,
    startDate: '',
    dueDate: '',
    datesFromChildren: false,
    unplanned: false,
    webUrl: `https://gitlab.exemple.fr/groups/x/-/work_items/${name}`,
    ...over,
  };
}

function issue(name: string, over: Partial<Issue> = {}): Issue {
  return {
    id: id(name),
    iid: name,
    ref: `#${name}`,
    groupPath: G.api,
    projectPath: `${G.api}/app`,
    title: `Issue ${name}`,
    labels: [],
    state: 'open',
    iteration: 3,
    parentEpic: '',
    assignee: null,
    blocksEpics: [id('E1')],
    unplanned: false,
    webUrl: `https://gitlab.exemple.fr/x/-/work_items/${name}`,
    ...over,
  };
}

const blocks = (source: string, target: string, conflict = false): Link => ({ source: id(source), target: id(target), type: 'blocks', conflict });
const relates = (source: string, target: string): Link => ({ source: id(source), target: id(target), type: 'relates', conflict: false });

function board(epics: Epic[], issues: Issue[], links: Link[]): BoardData {
  return { ...mockupBoard(), epics, issues, links, criticalPath: [] };
}

const WINDOW: BoardWindow = { from: 2, to: 5 };

function renderInspector(data: BoardData, itemId: string, win = WINDOW) {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <Inspector data={data} itemId={itemId} lanes={defaultLanes(data)} window={win} onSelect={onSelect} onClose={onClose} />,
  );
  return { ...view, onSelect, onClose, user: userEvent.setup() };
}

const panel = () => screen.getByRole('complementary', { name: 'Détail de l’élément' });
const fact = (term: string) => screen.getByText(term, { selector: 'dt' }).nextElementSibling as HTMLElement;
const group = (name: string) => screen.queryByRole('group', { name });

describe('Inspector', () => {
  it('renders nothing for an unknown item', () => {
    const { container } = renderInspector(board([epic('E1')], [], []), id('nope'));
    expect(container).toBeEmptyDOMElement();
  });

  it('shows an epic: type, state, group, lanes, period with inherited dates, labels', () => {
    const data = board([epic('E1', { datesFromChildren: true, labels: ['bug', 'inconnu'] })], [], []);
    renderInspector(data, id('E1'));
    const aside = panel();
    expect(aside).toHaveAttribute('data-kind', 'epic');
    expect(within(aside).getByText('Epic')).toBeInTheDocument();
    expect(within(aside).getByText('&E1')).toBeInTheDocument();
    expect(within(aside).getByText('Ouvert')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Epic E1' })).toBeInTheDocument();
    expect(fact('Groupe')).toHaveTextContent('Identité & sécurité');
    expect(fact('Groupe')).toHaveTextContent(G.identite);
    expect(fact('Couloir')).toHaveTextContent('Identité & sécurité');
    expect(fact('Période')).toHaveTextContent('It. 14 → It. 16');
    expect(fact('Période')).toHaveTextContent('dates héritées des issues');
    const labels = within(screen.getByRole('heading', { name: 'Labels' }).closest('section')!).getAllByRole('listitem');
    expect(labels.map((li) => li.textContent)).toEqual(['bug', 'inconnu']);
    // A label's color is data: set as a custom property only, none for an unknown label.
    const dots = aside.querySelectorAll<HTMLElement>('.label-dot');
    expect(dots[0].style.getPropertyValue('--label-color')).toBe('#e0532f');
    expect(dots[1].style.getPropertyValue('--label-color')).toBe('');
    expect(screen.getByText('Aucune dépendance.')).toBeInTheDocument();
  });

  it('shows an unplanned, closed epic of an unknown group, in no lane', () => {
    const data = board([epic('E1', { unplanned: true, start: null, end: null, state: 'closed', groupPath: 'ailleurs/x' })], [], []);
    renderInspector(data, id('E1'));
    expect(within(panel()).getByText('Fermé')).toBeInTheDocument();
    expect(fact('Période')).toHaveTextContent('Non planifié');
    expect(fact('Groupe')).toHaveTextContent('ailleurs/x');
    expect(fact('Couloir')).toHaveTextContent('—');
    expect(screen.queryByRole('heading', { name: 'Labels' })).not.toBeInTheDocument();
  });

  it('a single-iteration epic shows one iteration', () => {
    renderInspector(board([epic('E1', { start: 3, end: 3 })], [], []), id('E1'));
    expect(fact('Période')).toHaveTextContent(/^It\. 15$/);
  });

  it('shows an issue: iteration with dates, parent epic, assignee', async () => {
    const data = board(
      [epic('E1')],
      [issue('I1', { parentEpic: id('E1'), assignee: { name: 'Sofia Nguyen', username: 'snguyen' }, state: 'closed' })],
      [],
    );
    const { user, onSelect } = renderInspector(data, id('I1'));
    expect(within(panel()).getByText('Issue')).toBeInTheDocument();
    expect(within(panel()).getByText('Fermée')).toBeInTheDocument();
    expect(fact('Itération')).toHaveTextContent('Itération 15');
    expect(fact('Itération')).toHaveTextContent('18 nov. – 1 déc.');
    expect(fact('Assigné·e')).toHaveTextContent('Sofia Nguyen');
    await user.click(within(fact('Epic parent')).getByRole('button', { name: /&E1/ }));
    expect(onSelect).toHaveBeenCalledWith(id('E1'));
  });

  it('shows an unplanned issue without parent nor assignee', () => {
    // The parent epic is not in the data: shown as none rather than a dead button.
    const data = board([], [issue('I1', { iteration: null, unplanned: true, parentEpic: id('gone') })], []);
    renderInspector(data, id('I1'));
    expect(fact('Itération')).toHaveTextContent('Non planifié');
    expect(fact('Epic parent')).toHaveTextContent('—');
    expect(within(fact('Epic parent')).queryByRole('button')).not.toBeInTheDocument();
    expect(fact('Assigné·e')).toHaveTextContent('—');
  });

  it('an assignee with an empty name shows none', () => {
    renderInspector(board([], [issue('I1', { assignee: { name: '', username: 'x' } })], []), id('I1'));
    expect(fact('Assigné·e')).toHaveTextContent('—');
  });

  it('groups the dependencies of an epic; merges duplicates, skips itself and unknown items', async () => {
    const data = board(
      [epic('E1'), epic('E2'), epic('E3', { start: 7, end: 8 }), epic('E4', { unplanned: true, start: null, end: null })],
      [issue('I1', { iteration: 9 }), issue('I2', { state: 'closed' })],
      [
        blocks('E1', 'E2'),
        blocks('E1', 'E2', true), // the same link twice: one row, in conflict
        blocks('E1', 'E1'), // itself
        blocks('E1', 'unknown'),
        blocks('E3', 'E1', true),
        blocks('I1', 'E1'),
        relates('E1', 'I2'),
        relates('E4', 'E1'),
        { source: id('E1'), target: id('I1'), type: 'parent', conflict: false }, // not a dependency
        blocks('E2', 'E3'), // unrelated
      ],
    );
    const { user, onSelect } = renderInspector(data, id('E1'));
    const rows = (name: string) =>
      within(group(name)!)
        .getAllByRole('button')
        .map((b) => b.querySelector('.dependency-ref')!.textContent);
    expect(rows('Bloque')).toEqual(['&E2']);
    expect(rows('Bloqué par (epics)')).toEqual(['&E3']);
    expect(rows('Bloqué par (issues)')).toEqual(['#I1']);
    expect(rows('Lié à')).toEqual(['#I2', '&E4']);
    expect(within(group('Bloque')!).getByText('1')).toHaveClass('pill');

    // Conflicts are tagged; items outside the window say when they are.
    const e2 = within(group('Bloque')!).getByRole('button');
    expect(within(e2).getByText('Conflit')).toBeInTheDocument();
    const e3 = within(group('Bloqué par (epics)')!).getByRole('button');
    expect(within(e3).getByTitle('hors fenêtre')).toHaveTextContent('It. 19 → It. 20');
    const i1 = within(group('Bloqué par (issues)')!).getByRole('button');
    expect(within(i1).getByTitle('hors fenêtre')).toHaveTextContent('It. 21');
    expect(within(i1).queryByText('Conflit')).not.toBeInTheDocument();
    // Unplanned items have their own column: never "outside".
    const e4 = within(group('Lié à')!).getByRole('button', { name: /&E4/ });
    expect(within(e4).queryByTitle('hors fenêtre')).not.toBeInTheDocument();
    expect(within(group('Lié à')!).getByRole('button', { name: /#I2/ })).toHaveAttribute('data-closed', 'true');

    await user.click(e3);
    expect(onSelect).toHaveBeenCalledWith(id('E3'));
  });

  it('an issue lists every blocker under one group', () => {
    const data = board(
      [epic('E1'), epic('E2', { start: 0, end: 0 })],
      [issue('I1'), issue('I2', { iteration: null, unplanned: true })],
      [blocks('I1', 'E1'), blocks('E2', 'I1'), blocks('I2', 'I1'), relates('I1', 'I2')],
    );
    renderInspector(data, id('I1'));
    expect(within(group('Bloque')!).getAllByRole('button')).toHaveLength(1);
    expect(within(group('Bloqué par')!).getAllByRole('button')).toHaveLength(2);
    expect(group('Bloqué par (epics)')).not.toBeInTheDocument();
    expect(within(group('Lié à')!).getAllByRole('button')).toHaveLength(1);
    const e2 = within(group('Bloqué par')!).getByRole('button', { name: /&E2/ });
    expect(within(e2).getByTitle('hors fenêtre')).toHaveTextContent(/^It\. 12$/);
  });

  it('opens http(s) links in GitLab safely, and never another scheme', () => {
    const data = board(
      [epic('E1'), epic('E2', { webUrl: 'javascript:alert(1)' }), epic('E3', { webUrl: 'HTTP://gitlab.exemple.fr/x' })],
      [],
      [],
    );
    const { rerender } = renderInspector(data, id('E1'));
    const link = screen.getByRole('link', { name: /Ouvrir dans GitLab/ });
    expect(link).toHaveAttribute('href', data.epics[0].webUrl);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');

    const props = { data, lanes: defaultLanes(data), window: WINDOW, onSelect: vi.fn(), onClose: vi.fn() };
    rerender(<Inspector {...props} itemId={id('E2')} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    rerender(<Inspector {...props} itemId={id('E3')} />);
    expect(screen.getByRole('link')).toHaveAttribute('href', 'HTTP://gitlab.exemple.fr/x');
  });

  it('closes with its button', async () => {
    const { user, onClose } = renderInspector(board([epic('E1')], [], []), id('E1'));
    await user.click(screen.getByRole('button', { name: 'Fermer le détail' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('Inspector bottom sheet drag', () => {
  const data = board([epic('E1')], [], []);

  function setup() {
    const view = renderInspector(data, id('E1'));
    const aside = panel();
    Object.defineProperty(aside, 'offsetHeight', { configurable: true, value: 300 });
    const header = aside.querySelector('header')!;
    const grabber = aside.querySelector<HTMLElement>('.inspector-grabber')!;
    return { ...view, aside, header, grabber };
  }

  // jsdom has no PointerEvent: a MouseEvent carrying its fields stands in for it. React reads a
  // timeStamp of 0 as unset (Date.now()), hence the times from 1.
  function pointer(target: Element, type: string, init: { pointerId?: number; pointerType?: string; clientY: number; timeStamp?: number }) {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY: init.clientY });
    Object.assign(event, { pointerId: init.pointerId ?? 1, pointerType: init.pointerType ?? 'touch' });
    if (init.timeStamp !== undefined) Object.defineProperty(event, 'timeStamp', { value: init.timeStamp });
    fireEvent(target, event);
  }

  it('dismisses when pulled down by more than a third', () => {
    const { aside, header, onClose } = setup();
    pointer(header, 'pointerdown', { clientY: 100, timeStamp: 1 });
    expect(aside.style.transition).toBe('none');
    pointer(header, 'pointermove', { clientY: 250 });
    expect(aside.style.transform).toBe('translateY(150px)');
    pointer(header, 'pointerup', { clientY: 250, timeStamp: 2000 });
    expect(onClose).toHaveBeenCalledOnce();
    expect(aside.style.transform).toBe('');
    expect(aside.style.transition).toBe('');
  });

  it('dismisses on a quick flick, even short', () => {
    const { header, onClose } = setup();
    pointer(header, 'pointerdown', { clientY: 100, timeStamp: 1000 });
    pointer(header, 'pointermove', { clientY: 140 });
    pointer(header, 'pointerup', { clientY: 140, timeStamp: 1040 });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('springs back after a short, slow pull, and rubber-bands upwards', () => {
    const { aside, grabber, onClose } = setup();
    pointer(grabber, 'pointerdown', { clientY: 100, timeStamp: 1 });
    pointer(grabber, 'pointermove', { clientY: 40 });
    expect(aside.style.transform).toBe('translateY(-10px)');
    pointer(grabber, 'pointermove', { clientY: 150 });
    pointer(grabber, 'pointerup', { clientY: 150, timeStamp: 5000 });
    expect(onClose).not.toHaveBeenCalled();
    expect(aside.style.transform).toBe('');
  });

  it('a cancelled pull never dismisses', () => {
    const { header, onClose } = setup();
    pointer(header, 'pointerdown', { clientY: 0, timeStamp: 1 });
    pointer(header, 'pointermove', { clientY: 290 });
    pointer(header, 'pointercancel', { clientY: 290, timeStamp: 10 });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ignores the mouse, the close button, other pointers and a hidden grabber', () => {
    const { aside, header, grabber, onClose } = setup();
    const pull = (target: Element, init: { pointerType?: string; moveId?: number } = {}) => {
      pointer(target, 'pointerdown', { clientY: 0, timeStamp: 1, pointerType: init.pointerType });
      pointer(target, 'pointermove', { clientY: 290, pointerId: init.moveId });
      pointer(target, 'pointerup', { clientY: 290, timeStamp: 10, pointerId: init.moveId });
    };
    pull(header, { pointerType: 'mouse' });
    pull(screen.getByRole('button', { name: 'Fermer le détail' }));
    pull(header, { moveId: 2 });
    expect(aside.style.transform).toBe('');
    pointer(header, 'pointercancel', { clientY: 0 }); // ends that drag
    // Without a drag in progress, moves and ends do nothing.
    pointer(header, 'pointermove', { clientY: 50 });
    pointer(header, 'pointerup', { clientY: 50 });
    expect(onClose).not.toHaveBeenCalled();

    grabber.style.display = 'none'; // the side panel on wide screens
    pull(header);
    expect(onClose).not.toHaveBeenCalled();
  });
});

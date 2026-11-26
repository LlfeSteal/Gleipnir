// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { G, idOf, mockupBoard } from '../../board/fixtures';
import { defaultLanes } from '../../board/lanes';
import { DEFAULT_OPTIONS, type BoardView } from '../../board/types';
import { COMPACT_LAYOUT, computeBoardView } from '../../board/view';
import { BoardCanvas, type BoardCanvasProps } from './BoardCanvas';
import { ItemGlyph } from './ItemGlyph';
import { LinkSwatch } from './LinkSwatch';

const data = mockupBoard();
const lanes = defaultLanes(data);
const dataLane = lanes.find((l) => l.groups[0] === data.groups.find((g) => g.path === G.data)!.id)!.id;

function makeView(collapsed: string[] = []): BoardView {
  return computeBoardView({
    data,
    lanes,
    window: { from: 2, to: 6 },
    options: DEFAULT_OPTIONS,
    query: '',
    collapsed: new Set(collapsed),
  });
}

function setup(props: Partial<BoardCanvasProps> = {}) {
  const handlers = {
    onSelect: vi.fn(),
    onToggleLane: vi.fn(),
    onEditLane: vi.fn(),
    onRevealed: vi.fn(),
  };
  const all: BoardCanvasProps = {
    data,
    view: makeView(),
    selectedId: null,
    revealId: null,
    criticalPath: false,
    ...handlers,
    ...props,
  };
  const result = render(<BoardCanvas {...all} />);
  return { ...result, ...handlers, rerender: (p: Partial<BoardCanvasProps>) => result.rerender(<BoardCanvas {...all} {...p} />) };
}

describe('BoardCanvas', () => {
  it('renders columns, lanes and items', () => {
    const { container } = setup();
    expect(screen.getByText('Couloirs')).toBeInTheDocument();
    expect(screen.getByText('Itération 15')).toBeInTheDocument();
    expect(screen.getByText('En cours')).toBeInTheDocument();
    expect(screen.getByText('18 nov. – 1 déc.')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'API & intégrations' })).toBeInTheDocument();
    expect(screen.getAllByRole('region')).toHaveLength(4);
    const epic = screen.getByRole('button', { name: "Epic &18 API d'export des données" });
    expect(epic).toHaveAttribute('aria-pressed', 'false');
    expect(within(epic).getByText('› 2')).toHaveAttribute('title', 'Dépendances hors fenêtre : &22, #140');
    // &30, in the root group, is in no lane (spec §4.5).
    const e15 = screen.getByRole('button', { name: 'Epic &15 Refonte du tableau de bord' });
    expect(within(e15).getByText('1 hors couloirs').closest('.off-lanes-pill')).toHaveAttribute('title', 'Dépendance hors couloirs : &30');
    const closed = screen.getByRole('button', { name: 'Issue #131 Montée de version Kafka, fermée' });
    expect(closed).toHaveAttribute('data-closed');
    expect(within(closed).getByText('Fermée')).toBeInTheDocument();
    const card = screen.getByRole('button', { name: 'Issue #104 Corriger la déconnexion intempestive' });
    expect(within(card).getByText('Bloque &13')).toBeInTheDocument();
    expect(within(card).getByText('+1')).toBeInTheDocument();
    expect(within(card).getByTitle('Thomas Roux')).toHaveTextContent('TR');
    // clipped epic &19 (It. 12 → It. 15) starts before the window
    const e19 = screen.getByRole('button', { name: 'Epic &19 Webhooks sortants' });
    expect(e19).toHaveAttribute('data-clipped-start');
    expect(within(e19).getByTitle('Commence en It. 12')).toBeInTheDocument();
    expect(container.querySelectorAll('.link-layer .link').length).toBe(makeView().links.length);
    expect(container.querySelector('.link[data-critical]')).not.toBeNull();
    expect(container.querySelector('.link[data-conflict]')).not.toBeNull();
  });

  it('toggles the selection and dims unrelated items and links', async () => {
    const user = userEvent.setup();
    const { onSelect, rerender, container } = setup();
    const epic = screen.getByRole('button', { name: "Epic &18 API d'export des données" });
    await user.click(epic);
    expect(onSelect).toHaveBeenLastCalledWith(idOf('&18'));

    rerender({ selectedId: idOf('&18') });
    expect(epic).toHaveAttribute('aria-pressed', 'true');
    const canvas = container.querySelector('.board-canvas')!;
    expect(canvas).toHaveAttribute('data-selection');
    expect(epic).toHaveAttribute('data-related');
    expect(screen.getByRole('button', { name: 'Epic &12 Authentification SSO' })).toHaveAttribute('data-related');
    expect(screen.getByRole('button', { name: 'Epic &15 Refonte du tableau de bord' })).not.toHaveAttribute('data-related');
    const connected = container.querySelectorAll('.link[data-connected]');
    expect(connected.length).toBe(4);

    await user.click(epic);
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it('clears the selection on a click in the empty canvas', () => {
    const { onSelect, container } = setup({ selectedId: idOf('&18') });
    fireEvent.click(container.querySelector('.board-column')!);
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('does not dim anything for a selection outside the view', () => {
    const { container } = setup({ selectedId: idOf('&22') });
    expect(container.querySelector('.board-canvas')).not.toHaveAttribute('data-selection');
  });

  it('collapses and edits lanes', async () => {
    const user = userEvent.setup();
    const { onToggleLane, onEditLane, rerender } = setup();
    const collapse = screen.getByRole('button', { name: 'Replier le couloir Data' });
    expect(collapse).toHaveAttribute('aria-expanded', 'true');
    await user.click(collapse);
    expect(onToggleLane).toHaveBeenCalledWith(dataLane);
    await user.click(screen.getByRole('button', { name: 'Modifier le couloir Data' }));
    expect(onEditLane).toHaveBeenCalledWith(dataLane);

    rerender({ view: makeView([dataLane]) });
    const expand = screen.getByRole('button', { name: 'Déplier le couloir Data' });
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /Pipeline analytique/ })).toBeNull();
    const lane = screen.getByRole('region', { name: 'Data' });
    expect(lane).toHaveAttribute('data-collapsed');
    expect(within(lane).getByText('1 hors fenêtre')).toBeInTheDocument();
  });

  it('marks the critical path', () => {
    const { container } = setup({ criticalPath: true });
    expect(container.querySelector('.board-canvas')).toHaveAttribute('data-critical-path');
    expect(screen.getByRole('button', { name: "Epic &18 API d'export des données" })).toHaveAttribute('data-critical');
    expect(screen.getByRole('button', { name: 'Epic &15 Refonte du tableau de bord' })).not.toHaveAttribute('data-critical');
  });

  it('reveals an item then reports it', () => {
    const scrollTo = vi.fn();
    const original = Element.prototype.scrollTo;
    Element.prototype.scrollTo = scrollTo as unknown as typeof Element.prototype.scrollTo;
    try {
      const { onRevealed } = setup({ revealId: idOf('&21') });
      expect(scrollTo).toHaveBeenCalledTimes(1);
      expect(onRevealed).toHaveBeenCalledTimes(1);
    } finally {
      Element.prototype.scrollTo = original;
    }
  });

  it('switches the rail to its compact form with the compact layout, keeping names and the chevron', () => {
    const view = computeBoardView({ data, lanes, window: { from: 2, to: 6 }, options: DEFAULT_OPTIONS, query: '', collapsed: new Set() }, COMPACT_LAYOUT);
    const { container } = setup({ view });
    expect(container.querySelector('.board-canvas')).toHaveAttribute('data-compact');
    expect(container.querySelector('.board-scroll')).toHaveStyle({ scrollPaddingLeft: `${COMPACT_LAYOUT.railWidth + 8}px` });
    expect(screen.getByRole('button', { name: `Replier le couloir ${lanes[0].name}` })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /^Epic &18/ })).toBeInTheDocument();
  });

  it('keeps an item reached with the keyboard clear of the rail', () => {
    const scrollTo = vi.fn();
    const original = Element.prototype.scrollTo;
    Element.prototype.scrollTo = scrollTo as unknown as typeof Element.prototype.scrollTo;
    try {
      const { container } = setup();
      const scroller = container.querySelector<HTMLElement>('.board-scroll')!;
      Object.defineProperties(scroller, {
        clientWidth: { value: 600 },
        clientHeight: { value: 400 },
        scrollWidth: { value: 2000 },
        scrollHeight: { value: 1200 },
      });
      scroller.scrollLeft = 900;
      const epic = screen.getByRole('button', { name: /^Epic &18/ });
      vi.spyOn(epic, 'matches').mockImplementation((s: string) => s === ':focus-visible');
      fireEvent.focus(epic);
      expect(scrollTo).toHaveBeenCalledTimes(1);
      const { left } = scrollTo.mock.calls[0][0] as { left: number };
      const rect = makeView().items.find((p) => p.key === epic.dataset.itemKey)!.rect;
      expect(rect.x - left).toBe(220 + 16);
    } finally {
      Element.prototype.scrollTo = original;
    }
  });

  it('shows an empty lane message', () => {
    // Only the Identité lane holds "sécurité" items.
    const labelled = lanes.map((l) => ({ ...l, labels: ['sécurité'] }));
    const view = computeBoardView({ data, lanes: labelled, window: { from: 2, to: 6 }, options: DEFAULT_OPTIONS, query: '', collapsed: new Set() });
    setup({ view });
    expect(screen.getAllByText('Aucun élément de ce couloir dans la fenêtre.')).toHaveLength(lanes.length - 1);
  });

  it('reports the width of its scroll container on mount and on resize', () => {
    const observers: { callback: () => void; disconnect: ReturnType<typeof vi.fn> }[] = [];
    const original = window.ResizeObserver;
    window.ResizeObserver = class {
      disconnect = vi.fn();
      constructor(public callback: () => void) {
        observers.push(this);
      }
      observe() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver;
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1400);
    try {
      const onViewportWidth = vi.fn();
      const { unmount } = setup({ onViewportWidth });
      expect(onViewportWidth).toHaveBeenLastCalledWith(1400);
      width.mockReturnValue(1100);
      observers[0].callback();
      expect(onViewportWidth).toHaveBeenLastCalledWith(1100);
      unmount();
      expect(observers[0].disconnect).toHaveBeenCalled();
    } finally {
      width.mockRestore();
      window.ResizeObserver = original;
    }
  });
});

describe('ItemGlyph and LinkSwatch', () => {
  it('render decorative shapes', () => {
    const { container } = render(
      <>
        <ItemGlyph kind="epic" />
        <ItemGlyph kind="issue" closed size="small" />
        <LinkSwatch type="blocks" />
        <LinkSwatch type="relates" />
      </>,
    );
    const glyphs = container.querySelectorAll('.item-glyph');
    expect(glyphs[0]).toHaveAttribute('data-kind', 'epic');
    expect(glyphs[1]).toHaveAttribute('data-closed');
    expect(glyphs[1]).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelectorAll('.link-swatch .link-arrow')).toHaveLength(1);
    expect(container.querySelector('.link-swatch .link[data-type="relates"]')).not.toBeNull();
  });
});

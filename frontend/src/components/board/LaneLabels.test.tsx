// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LaneLabels } from './LaneLabels';

const colors = new Map([
  ['backend', '#6699cc'],
  ['API', '#14a08a'],
  ['bug', '#d9534f'],
  ['UX', '#5843ad'],
  ['data', '#428bca'],
  ['mobile', '#f0ad4e'],
  ['frontend', '#cc6699'],
  ['sécurité', '#990000'],
]);
const eight = [...colors.keys()];
const five = eight.slice(0, 5);

function renderLabels(labels: string[], mode: 'any' | 'all' = 'any') {
  const { container } = render(<LaneLabels labels={labels} mode={mode} colors={colors} />);
  return { line: container.querySelector<HTMLElement>('.lane-labels')!, user: userEvent.setup() };
}

const more = () => screen.getByRole('button', { name: /^et \d+ autres?…$/ });
const card = () => screen.queryByRole('tooltip');
const rows = (line: HTMLElement) => Array.from(line.querySelectorAll<HTMLElement>('.lane-label-row'));

describe('LaneLabels (spec §4.1)', () => {
  it('shows « Labels · mode », then one or two labels, one per line, by name and color, without « et N autres… »', () => {
    const { line } = renderLabels(['API', 'bug'], 'all');
    expect(line).toHaveTextContent(/^Labels · tous/);
    expect(rows(line).map((r) => r.textContent)).toEqual(['API', 'bug']);
    expect(within(line).getByText('API').closest<HTMLElement>('.lane-label')!.style.getPropertyValue('--label-color')).toBe('#14a08a');
    expect(screen.queryByRole('button')).toBeNull();
    render(<LaneLabels labels={['UX']} mode="any" colors={colors} />);
    expect(screen.getByText('UX').closest('.lane-labels')).toHaveTextContent('Labels · au moins un');
  });

  it('names the first two labels, and ends the second line with « et N autres… » counting the hidden ones only', () => {
    const { line } = renderLabels(eight);
    expect(rows(line).map((r) => r.textContent)).toEqual(['backend', 'APIet 6 autres…']);
    expect(within(rows(line)[1]).getByRole('button')).toHaveTextContent('et 6 autres…');
    render(<LaneLabels labels={['API', 'bug', 'UX']} mode="any" colors={colors} />);
    expect(screen.getByRole('button', { name: 'et 1 autre…' })).toBeInTheDocument();
  });

  it('lists the hidden labels only, with their color, on hover, and hides them when the pointer leaves', async () => {
    const { user } = renderLabels(eight);
    expect(card()).toBeNull();
    await user.hover(more());
    const tooltip = card()!;
    expect(more()).toHaveAttribute('aria-describedby', tooltip.id);
    expect(tooltip.parentElement).toBe(document.body);
    expect(tooltip).toHaveTextContent('Autres labels');
    const items = within(tooltip).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(eight.slice(2));
    expect(within(tooltip).queryByText('backend')).toBeNull();
    expect(within(tooltip).queryByText('API')).toBeNull();
    expect(within(tooltip).getByText('mobile').closest<HTMLElement>('.lane-hovercard-label')!.style.getPropertyValue('--label-color')).toBe('#f0ad4e');
    await user.unhover(more());
    expect(card()).toBeNull();
    expect(more()).not.toHaveAttribute('aria-describedby');
  });

  it('opens on focus and on a tap; blur and Escape close it, Escape without reaching the page', async () => {
    const { user } = renderLabels(five);
    await user.tab();
    expect(card()).toHaveTextContent('Autres labels');
    let reached = false;
    const onKey = () => (reached = true);
    document.addEventListener('keydown', onKey);
    await user.keyboard('{Escape}');
    document.removeEventListener('keydown', onKey);
    expect(card()).toBeNull();
    expect(reached).toBe(false);
    await user.click(more());
    expect(card()).not.toBeNull();
    await user.click(more());
    expect(card()).not.toBeNull();
    await user.tab();
    expect(card()).toBeNull();
  });

  it('closes on Escape from the page, on scroll and on resize', async () => {
    const { user } = renderLabels(five);
    await user.hover(more());
    await user.keyboard('{Escape}');
    expect(card()).toBeNull();
    await user.unhover(more());
    await user.hover(more());
    act(() => {
      fireEvent.scroll(window);
    });
    expect(card()).toBeNull();
    await user.unhover(more());
    await user.hover(more());
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(card()).toBeNull();
  });

  it('sits under its button, above it near the bottom, and inside the viewport', async () => {
    const { user } = renderLabels(five);
    const button = more();
    const rect = (r: Partial<DOMRect>) => () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}), ...r }) as DOMRect;
    button.getBoundingClientRect = rect({ top: 100, bottom: 116, left: 900 });
    const proto = HTMLDivElement.prototype.getBoundingClientRect;
    HTMLDivElement.prototype.getBoundingClientRect = rect({ width: 200, height: 120 });
    try {
      await user.hover(button);
      expect(card()!.style.top).toBe('120px');
      expect(card()!.style.left).toBe(`${window.innerWidth - 8 - 200}px`);
      await user.unhover(button);
      button.getBoundingClientRect = rect({ top: window.innerHeight - 30, bottom: window.innerHeight - 14, left: 20 });
      await user.hover(button);
      expect(card()!.style.top).toBe(`${window.innerHeight - 30 - 4 - 120}px`);
      expect(card()!.style.left).toBe('20px');
    } finally {
      HTMLDivElement.prototype.getBoundingClientRect = proto;
    }
  });
});

// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { BoardData } from '../api/types';
import type { BoardWindow } from '../board/types';
import { mockupBoard } from '../board/fixtures';
import { WindowControl } from './WindowControl';

// The mockup: It. 12 → It. 21 (indexes 0 → 9), It. 15 (index 3) current.
function Harness({ data = mockupBoard(), initial, onChange }: { data?: BoardData; initial: BoardWindow; onChange?: (w: BoardWindow) => void }) {
  const [win, setWin] = useState(initial);
  return (
    <WindowControl
      data={data}
      window={win}
      onChange={(next) => {
        onChange?.(next);
        setWin(next);
      }}
    />
  );
}

const windowButton = () => screen.getByRole('button', { name: /^Fenêtre :/ });
const previous = () => screen.getByRole('button', { name: 'Itération précédente' });
const next = () => screen.getByRole('button', { name: 'Itération suivante' });

describe('WindowControl', () => {
  it('renders nothing without iterations', () => {
    const { container } = render(<WindowControl data={{ ...mockupBoard(), iterations: [] }} window={{ from: 0, to: 0 }} onChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('labels a one-iteration window with that iteration only', () => {
    render(<Harness initial={{ from: 3, to: 3 }} />);
    expect(windowButton()).toHaveAccessibleName('Fenêtre : It. 15');
  });

  it('shifts by one iteration, keeping the width, and stops at the ends', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial={{ from: 1, to: 3 }} onChange={onChange} />);
    expect(windowButton()).toHaveAccessibleName('Fenêtre : It. 13 – It. 15');
    await user.click(previous());
    expect(onChange).toHaveBeenLastCalledWith({ from: 0, to: 2 });
    expect(previous()).toBeDisabled();
    expect(next()).toBeEnabled();
    for (let i = 0; i < 7; i++) await user.click(next());
    expect(windowButton()).toHaveAccessibleName('Fenêtre : It. 19 – It. 21');
    expect(next()).toBeDisabled();
  });

  it('a window over the whole cadence disables both arrows', () => {
    render(<Harness initial={{ from: 0, to: 9 }} />);
    expect(previous()).toBeDisabled();
    expect(next()).toBeDisabled();
  });

  it('picks the start and the end in the menu, never past each other', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ from: 2, to: 4 }} />);
    await user.click(windowButton());
    expect(windowButton()).toHaveAttribute('aria-expanded', 'true');
    const start = screen.getByRole('group', { name: 'Début' });
    const end = screen.getByRole('group', { name: 'Fin' });
    expect(within(start).getByRole('menuitemradio', { name: 'It. 14' })).toHaveAttribute('aria-checked', 'true');
    // The current iteration is marked in both lists.
    expect(within(start).getByRole('menuitemradio', { name: /It\. 15/ })).toHaveTextContent('en cours');
    // A start after the end, or an end before the start, is disabled.
    expect(within(start).getByRole('menuitemradio', { name: 'It. 17' })).toBeDisabled();
    expect(within(end).getByRole('menuitemradio', { name: 'It. 13' })).toBeDisabled();

    await user.click(within(start).getByRole('menuitemradio', { name: 'It. 12' }));
    expect(windowButton()).toHaveAccessibleName('Fenêtre : It. 12 – It. 16');
    await user.click(within(end).getByRole('menuitemradio', { name: 'It. 21' }));
    expect(windowButton()).toHaveAccessibleName('Fenêtre : It. 12 – It. 21');
    // Picking a bound keeps the menu open.
    expect(windowButton()).toHaveAttribute('aria-expanded', 'true');
  });

  it('applies a preset, closes and gives the focus back', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ from: 1, to: 5 }} />);
    await user.click(windowButton());
    expect(screen.getByRole('menuitemradio', { name: 'En cours ± 2' })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('menuitemradio', { name: 'Toutes' }));
    expect(windowButton()).toHaveAccessibleName('Fenêtre : It. 12 – It. 21');
    expect(windowButton()).toHaveAttribute('aria-expanded', 'false');
    expect(windowButton()).toHaveFocus();

    await user.click(windowButton());
    expect(screen.getByRole('menuitemradio', { name: 'Toutes' })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('menuitemradio', { name: '6 prochaines' }));
    expect(windowButton()).toHaveAccessibleName('Fenêtre : It. 15 – It. 20');
  });

  it('no preset is checked for a custom window', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ from: 0, to: 1 }} />);
    await user.click(windowButton());
    for (const name of ['En cours ± 2', '6 prochaines', 'Toutes']) {
      expect(screen.getByRole('menuitemradio', { name })).toHaveAttribute('aria-checked', 'false');
    }
  });

  it('closes with Escape, and toggles with its button', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ from: 1, to: 5 }} />);
    await user.click(windowButton());
    await user.keyboard('{Escape}');
    expect(windowButton()).toHaveAttribute('aria-expanded', 'false');
    expect(windowButton()).toHaveFocus();
    await user.click(windowButton());
    await user.click(windowButton());
    expect(windowButton()).toHaveAttribute('aria-expanded', 'false');
  });

  it('without a current iteration, presets start from the first one', async () => {
    const user = userEvent.setup();
    const data = { ...mockupBoard(), current: -1, iterations: mockupBoard().iterations.map((it) => ({ ...it, current: false })) };
    render(<Harness data={data} initial={{ from: 4, to: 6 }} />);
    await user.click(windowButton());
    expect(screen.queryByText('en cours')).not.toBeInTheDocument();
    await user.click(screen.getByRole('menuitemradio', { name: 'En cours ± 2' }));
    expect(windowButton()).toHaveAccessibleName('Fenêtre : It. 12 – It. 14');
  });
});

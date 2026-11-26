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
function Harness({
  data = mockupBoard(),
  initial,
  onChange,
  onCadencesChange = vi.fn(),
}: {
  data?: BoardData;
  initial: BoardWindow | null;
  onChange?: (w: BoardWindow) => void;
  onCadencesChange?: (ids: string[]) => void;
}) {
  const [win, setWin] = useState(initial);
  return (
    <WindowControl
      data={data}
      window={win}
      onChange={(next) => {
        onChange?.(next);
        setWin(next);
      }}
      onCadencesChange={onCadencesChange}
    />
  );
}

const PRODUIT = 'gid://gitlab/Iterations::Cadence/1';
const DATA = 'gid://gitlab/Iterations::Cadence/2';
/** The mockup with a second cadence, both active unless told otherwise. */
function twoCadences(active = [PRODUIT, DATA]): BoardData {
  return {
    ...mockupBoard(),
    cadences: [
      { id: PRODUIT, title: 'Sprints produit', active: active.includes(PRODUIT) },
      { id: DATA, title: 'Squad data', active: active.includes(DATA) },
    ],
  };
}

const windowButton = () => screen.getByRole('button', { name: /^Fenêtre :/ });
const previous = () => screen.getByRole('button', { name: 'Itération précédente' });
const next = () => screen.getByRole('button', { name: 'Itération suivante' });

describe('WindowControl', () => {
  it('renders nothing without iterations', () => {
    const { container } = render(
      <WindowControl data={{ ...mockupBoard(), iterations: [] }} window={{ from: 0, to: 0 }} onChange={vi.fn()} onCadencesChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  describe('cadences (ADR-38)', () => {
    it('offers no cadence choice with a single cadence', async () => {
      const user = userEvent.setup();
      render(<Harness initial={{ from: 2, to: 6 }} />);
      await user.click(windowButton());
      expect(screen.queryByRole('group', { name: 'Cadences' })).toBeNull();
      expect(screen.queryByRole('menuitemcheckbox')).toBeNull();
    });

    it('checks the active cadences and toggles one, the pop-up staying open', async () => {
      const user = userEvent.setup();
      const onCadencesChange = vi.fn();
      render(<Harness data={twoCadences()} initial={{ from: 2, to: 6 }} onCadencesChange={onCadencesChange} />);
      await user.click(windowButton());
      const group = screen.getByRole('group', { name: 'Cadences' });
      const produit = within(group).getByRole('menuitemcheckbox', { name: 'Sprints produit' });
      const data = within(group).getByRole('menuitemcheckbox', { name: 'Squad data' });
      expect(produit).toHaveAttribute('aria-checked', 'true');
      expect(data).toHaveAttribute('aria-checked', 'true');
      await user.click(produit);
      expect(onCadencesChange).toHaveBeenLastCalledWith([DATA]);
      expect(screen.getByRole('group', { name: 'Cadences' })).toBeInTheDocument();
    });

    it('cannot uncheck the last active cadence', async () => {
      const user = userEvent.setup();
      const onCadencesChange = vi.fn();
      render(<Harness data={twoCadences([DATA])} initial={{ from: 2, to: 6 }} onCadencesChange={onCadencesChange} />);
      await user.click(windowButton());
      expect(screen.getByRole('menuitemcheckbox', { name: 'Squad data' })).toBeDisabled();
      await user.click(screen.getByRole('menuitemcheckbox', { name: 'Sprints produit' }));
      expect(onCadencesChange).toHaveBeenLastCalledWith([PRODUIT, DATA]);
    });

    it('without a column, still offers the cadences, and nothing else', async () => {
      const user = userEvent.setup();
      const data = { ...twoCadences([DATA]), iterations: [], current: -1 };
      render(<Harness data={data} initial={null} />);
      expect(windowButton()).toHaveAccessibleName('Fenêtre : Aucune itération');
      expect(previous()).toBeDisabled();
      expect(next()).toBeDisabled();
      await user.click(windowButton());
      expect(screen.getAllByRole('menuitemcheckbox')).toHaveLength(2);
      expect(screen.queryByRole('group', { name: 'Début' })).toBeNull();
      expect(screen.queryByRole('menuitemradio')).toBeNull();
    });

    it('renders nothing without a column and a single cadence', () => {
      const { container } = render(<Harness data={{ ...mockupBoard(), iterations: [] }} initial={null} />);
      expect(container).toBeEmptyDOMElement();
    });
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

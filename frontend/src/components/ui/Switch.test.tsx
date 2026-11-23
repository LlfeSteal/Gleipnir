// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Checkbox } from './Checkbox';
import { Switch } from './Switch';

describe('Switch', () => {
  it('is a switch named by its label, described by its description', async () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Sous-groupes" description="Inclure les sous-groupes" />);
    const toggle = screen.getByRole('switch', { name: 'Sous-groupes' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle).toHaveAccessibleDescription('Inclure les sous-groupes');
    await userEvent.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith(true);
  });

  it('toggles from its label too, and turns off', async () => {
    const onChange = vi.fn();
    render(<Switch checked onChange={onChange} label="Epics" />);
    expect(screen.getByRole('switch', { name: 'Epics' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByText('Epics'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('does nothing when disabled', async () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Issues" disabled />);
    await userEvent.click(screen.getByRole('switch', { name: 'Issues' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Checkbox', () => {
  it('is a native checkbox row, its label clickable', async () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} onChange={onChange} label="Masquer les fermées" detail="3" />);
    const box = screen.getByRole('checkbox', { name: 'Masquer les fermées' });
    expect(box).not.toBeChecked();
    await userEvent.click(screen.getByText('Masquer les fermées'));
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(box).toHaveAccessibleDescription('3');
  });

  it('takes an explicit accessible name', () => {
    render(<Checkbox checked onChange={vi.fn()} label={<span>●</span>} aria-label="Identité" />);
    expect(screen.getByRole('checkbox', { name: 'Identité' })).toBeChecked();
  });
});

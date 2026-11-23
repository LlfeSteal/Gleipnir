// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SegmentedControl } from './SegmentedControl';

const options = [
  { label: 'Au moins un', value: 'any' },
  { label: 'Tous', value: 'all' },
  { label: 'Aucun', value: 'none' },
];

describe('SegmentedControl', () => {
  it('is a radio group whose choice is checked', async () => {
    const onChange = vi.fn();
    render(<SegmentedControl label="Correspondance" options={options} value="all" onChange={onChange} />);
    const group = screen.getByRole('radiogroup', { name: 'Correspondance' });
    expect(within(group).getByRole('radio', { name: 'Tous' })).toHaveAttribute('aria-checked', 'true');
    expect(within(group).getByRole('radio', { name: 'Au moins un' })).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(within(group).getByRole('radio', { name: 'Aucun' }));
    expect(onChange).toHaveBeenCalledWith('none');
  });

  it('is one tab stop, and the arrow keys move the choice, wrapping around', async () => {
    const onChange = vi.fn();
    render(<SegmentedControl label="Correspondance" options={options} value="any" onChange={onChange} size="small" />);
    expect(screen.getByRole('radiogroup')).toHaveAttribute('data-size', 'small');
    await userEvent.tab();
    expect(screen.getByRole('radio', { name: 'Au moins un' })).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith('none');
    expect(screen.getByRole('radio', { name: 'Aucun' })).toHaveFocus();
  });
});

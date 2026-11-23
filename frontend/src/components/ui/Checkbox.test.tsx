// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Checkbox } from './Checkbox';

describe('Checkbox', () => {
  it('is named by its label and described by its detail', () => {
    render(<Checkbox checked={false} onChange={vi.fn()} label="Data" detail={3} />);
    const box = screen.getByRole('checkbox', { name: 'Data' });
    expect(box).toHaveAccessibleDescription('3');
    expect(box).not.toBeChecked();
  });

  it('a detail of 0 still shows; none without detail', () => {
    const { rerender } = render(<Checkbox checked onChange={vi.fn()} label="Data" detail={0} />);
    expect(screen.getByRole('checkbox')).toHaveAccessibleDescription('0');
    rerender(<Checkbox checked onChange={vi.fn()} label="Data" detail={null} />);
    expect(screen.getByRole('checkbox')).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('an explicit aria-label replaces the label as its name', () => {
    render(<Checkbox checked onChange={vi.fn()} label={<span>● Data</span>} aria-label="Afficher Data" />);
    const box = screen.getByRole('checkbox', { name: 'Afficher Data' });
    expect(box).not.toHaveAttribute('aria-labelledby');
  });

  it('reports the new state, with the mouse on its label and with the keyboard', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<Checkbox checked={false} onChange={onChange} label="Data" />);
    await user.click(screen.getByText('Data'));
    expect(onChange).toHaveBeenLastCalledWith(true);
    rerender(<Checkbox checked onChange={onChange} label="Data" />);
    screen.getByRole('checkbox').focus();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('does nothing when disabled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(<Checkbox checked={false} onChange={onChange} label="Data" disabled />);
    await user.click(screen.getByText('Data'));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(container.querySelector('label')).toHaveAttribute('data-disabled', 'true');
  });
});

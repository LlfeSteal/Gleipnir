// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MenuHeader, MenuItem, MenuSeparator, Popover } from './Popover';

function Harness({ onClose = vi.fn(), onSelect = vi.fn(), role }: { onClose?: (r: boolean) => void; onSelect?: (v: string) => void; role?: 'menu' | 'dialog' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="menu-anchor">
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
          Période
        </button>
        <Popover
          open={open}
          role={role}
          label="Période"
          onClose={(restore) => {
            setOpen(false);
            onClose(restore);
          }}
        >
          <MenuHeader>Réglages rapides</MenuHeader>
          <MenuItem onSelect={() => onSelect('around')}>En cours ± 2</MenuItem>
          <MenuItem checked onSelect={() => onSelect('next')} detail="6">
            6 prochaines
          </MenuItem>
          <MenuItem checked={false} disabled onSelect={() => onSelect('off')}>
            Indisponible
          </MenuItem>
          <MenuSeparator />
          <MenuItem checked={false} onSelect={() => onSelect('all')}>
            Toutes
          </MenuItem>
          {role === 'dialog' && <input aria-label="Début" />}
        </Popover>
      </div>
      <button type="button">Ailleurs</button>
    </>
  );
}

describe('Popover', () => {
  it('focuses the checked item on open, and selects with the keyboard', async () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: 'Période' }));
    const menu = screen.getByRole('menu', { name: 'Période' });
    expect(menu).toHaveAttribute('data-align', 'start');
    expect(screen.getByRole('menuitemradio', { name: /6 prochaines/ })).toHaveFocus();
    expect(screen.getByRole('menuitemradio', { name: /6 prochaines/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitem', { name: 'En cours ± 2' })).not.toHaveAttribute('aria-checked');
    expect(screen.getByRole('separator')).toBeInTheDocument();

    // Down skips the disabled item; it wraps around both ways.
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitemradio', { name: 'Toutes' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'En cours ± 2' })).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(screen.getByRole('menuitemradio', { name: 'Toutes' })).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(screen.getByRole('menuitem', { name: 'En cours ± 2' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('around');
  });

  it('focuses the first item when none is checked', async () => {
    function Plain() {
      return (
        <div className="menu-anchor">
          <Popover open label="Actions" onClose={vi.fn()}>
            <MenuItem onSelect={vi.fn()}>Modifier</MenuItem>
            <MenuItem onSelect={vi.fn()}>Supprimer</MenuItem>
          </Popover>
        </div>
      );
    }
    render(<Plain />);
    expect(screen.getByRole('menuitem', { name: 'Modifier' })).toHaveFocus();
  });

  it('closes on Escape and on Tab, asking to restore the focus', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Période' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(onClose).toHaveBeenLastCalledWith(true);

    await userEvent.click(screen.getByRole('button', { name: 'Période' }));
    await userEvent.tab();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenLastCalledWith(true);
  });

  it('closes on a press outside its anchor, not on its trigger', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const trigger = screen.getByRole('button', { name: 'Période' });
    await userEvent.click(trigger);
    fireEvent.pointerDown(trigger);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Ailleurs' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledWith(false);
  });

  it('as a dialog, leaves Tab and the arrows to its fields, and closes when the focus leaves', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} role="dialog" />);
    await userEvent.click(screen.getByRole('button', { name: 'Période' }));
    expect(screen.getByRole('dialog', { name: 'Période' })).toBeInTheDocument();
    await userEvent.tab();
    const field = screen.getByRole('textbox', { name: 'Début' });
    expect(field).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(field).toHaveFocus();
    await userEvent.tab();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledWith(false);
  });

  it('renders nothing while closed', () => {
    render(
      <Popover open={false} label="Rien" onClose={vi.fn()}>
        <MenuItem onSelect={vi.fn()}>A</MenuItem>
      </Popover>,
    );
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

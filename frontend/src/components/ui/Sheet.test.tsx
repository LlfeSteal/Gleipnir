// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Sheet } from './Sheet';

function Harness({ onClose = vi.fn() }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Modifier…
      </button>
      <Sheet
        open={open}
        title="Couloirs"
        subtitle="4 couloirs"
        footer={<button type="button">Appliquer</button>}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
      >
        <input aria-label="Nom" />
      </Sheet>
    </>
  );
}

const sheet = () => document.querySelector('dialog')!;

describe('Sheet', () => {
  it('opens as a modal labelled by its title, its content mounted only while open', async () => {
    render(<Harness />);
    expect(sheet()).not.toHaveAttribute('open');
    expect(screen.queryByRole('textbox', { name: 'Nom' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Modifier…' }));
    expect(sheet()).toHaveAttribute('open');
    const dialog = screen.getByRole('dialog', { name: 'Couloirs' });
    expect(dialog).toHaveAccessibleDescription('4 couloirs');
    expect(screen.getByRole('textbox', { name: 'Nom' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Appliquer' })).toBeInTheDocument();
  });

  it('closes with its close button', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Modifier…' }));
    await userEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(sheet()).not.toHaveAttribute('open');
    expect(screen.queryByRole('textbox', { name: 'Nom' })).not.toBeInTheDocument();
  });

  it('asks its owner on Escape (the cancel event) instead of closing by itself', async () => {
    const onClose = vi.fn();
    const { rerender } = render(<Sheet open title="Réglages" onClose={onClose}>contenu</Sheet>);
    const cancel = new Event('cancel', { cancelable: true });
    fireEvent(sheet(), cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    // The owner said no: still open.
    expect(sheet()).toHaveAttribute('open');
    rerender(<Sheet open={false} title="Réglages" onClose={onClose}>contenu</Sheet>);
    expect(sheet()).not.toHaveAttribute('open');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on a press and release on the backdrop, not on a drag out of the sheet', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Modifier…' }));
    const field = screen.getByRole('textbox', { name: 'Nom' });
    // A selection dragged out: pressed inside, released outside.
    fireEvent.mouseDown(field);
    fireEvent.click(sheet(), { clientX: 900, clientY: 900 });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(sheet(), { clientX: 900, clientY: 900 });
    fireEvent.click(sheet(), { clientX: 900, clientY: 900 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('tells its owner when closed natively', () => {
    const onClose = vi.fn();
    render(<Sheet open title="Réglages" onClose={onClose}>contenu</Sheet>);
    sheet().close();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('leaves the top layer when unmounted open, without calling onClose', () => {
    const onClose = vi.fn();
    const { unmount } = render(<Sheet open title="Réglages" onClose={onClose}>contenu</Sheet>);
    const element = sheet();
    unmount();
    expect(element).not.toHaveAttribute('open');
    expect(onClose).not.toHaveBeenCalled();
  });
});

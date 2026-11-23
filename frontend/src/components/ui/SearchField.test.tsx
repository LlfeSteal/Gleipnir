// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SearchField } from './SearchField';

function Harness({ onEscape = vi.fn() }: { onEscape?: () => void }) {
  const [value, setValue] = useState('');
  return (
    <div onKeyDown={(event) => event.key === 'Escape' && onEscape()}>
      <SearchField value={value} onChange={setValue} label="Rechercher" placeholder="#110, &18, titre…" />
    </div>
  );
}

describe('SearchField', () => {
  it('shows a clear button once something is typed, which empties it and keeps the focus', async () => {
    render(<Harness />);
    const field = screen.getByRole('searchbox', { name: 'Rechercher' });
    expect(field).toHaveAttribute('placeholder', '#110, &18, titre…');
    expect(screen.queryByRole('button', { name: 'Effacer' })).not.toBeInTheDocument();
    await userEvent.type(field, '#110');
    expect(field).toHaveValue('#110');
    await userEvent.click(screen.getByRole('button', { name: 'Effacer' }));
    expect(field).toHaveValue('');
    expect(field).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Effacer' })).not.toBeInTheDocument();
  });

  it('clears on Escape, and lets Escape through once empty', async () => {
    const onEscape = vi.fn();
    render(<Harness onEscape={onEscape} />);
    const field = screen.getByRole('searchbox', { name: 'Rechercher' });
    await userEvent.type(field, 'api');
    await userEvent.keyboard('{Escape}');
    expect(field).toHaveValue('');
    expect(onEscape).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('hands its input to inputRef (⌘F)', () => {
    const ref = createRef<HTMLInputElement>();
    render(<SearchField value="" onChange={vi.fn()} label="Rechercher" inputRef={ref} className="toolbar-search" />);
    expect(ref.current).toBe(screen.getByRole('searchbox'));
    expect(ref.current?.parentElement).toHaveClass('search-field', 'toolbar-search');
  });
});

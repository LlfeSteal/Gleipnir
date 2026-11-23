// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toolbar } from './Toolbar';
import { mockupBoard } from '../board/fixtures';

/** The toolbar with its own search state, as App holds it. */
function Harness({ compact }: { compact: boolean }) {
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  return (
    <>
      <Toolbar
        data={mockupBoard()}
        window={{ from: 2, to: 6 }}
        onWindowChange={vi.fn()}
        query={query}
        onQueryChange={setQuery}
        searchRef={{ current: null }}
        fetchedAt={null}
        refreshing={false}
        onRefresh={vi.fn()}
        appearance="system"
        onAppearanceChange={vi.fn()}
        sidebarOpen={false}
        compact={compact}
        onToggleSidebar={vi.fn()}
        searchOpen={searchOpen}
        onSearchOpenChange={setSearchOpen}
      />
      <button type="button">ailleurs</button>
    </>
  );
}

const searchbox = () => screen.queryByRole('searchbox', { name: 'Rechercher un epic ou une issue' });

describe('Toolbar', () => {
  it('shows the search field on wide screens', () => {
    render(<Harness compact={false} />);
    expect(searchbox()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rechercher' })).toBeNull();
  });

  it('compact: the search button unfolds a focused field, Escape folds it back', async () => {
    const user = userEvent.setup();
    render(<Harness compact />);
    expect(searchbox()).toBeNull();
    expect(screen.getByRole('button', { name: 'Filtres' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Rechercher' }));
    expect(searchbox()).toHaveFocus();
    // The field takes the first row over.
    expect(screen.queryByRole('button', { name: 'Filtres' })).toBeNull();

    // Escape clears the text first, then folds the empty field.
    await user.keyboard('&18');
    await user.keyboard('{Escape}');
    expect(searchbox()).toHaveValue('');
    await user.keyboard('{Escape}');
    expect(searchbox()).toBeNull();
    expect(screen.getByRole('button', { name: 'Rechercher' })).toHaveFocus();
  });

  it('compact: a query keeps the field open on blur, Annuler clears and folds it', async () => {
    const user = userEvent.setup();
    render(<Harness compact />);
    await user.click(screen.getByRole('button', { name: 'Rechercher' }));
    await user.keyboard('#110');
    await user.click(screen.getByRole('button', { name: 'ailleurs' }));
    expect(searchbox()).toHaveValue('#110');

    await user.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(searchbox()).toBeNull();
  });

  it('compact: an empty field folds when the focus leaves it', async () => {
    const user = userEvent.setup();
    render(<Harness compact />);
    await user.click(screen.getByRole('button', { name: 'Rechercher' }));
    await user.click(screen.getByRole('button', { name: 'ailleurs' }));
    expect(searchbox()).toBeNull();
  });
});

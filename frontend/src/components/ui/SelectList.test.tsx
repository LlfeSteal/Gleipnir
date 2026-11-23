// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { SelectOption } from './SelectList';
import { SelectList } from './SelectList';

const groups = (n: number): SelectOption[] => Array.from({ length: n }, (_, i) => ({ value: `g${i}`, label: `Groupe ${i}` }));

function Harness({ options, initial = [], onChange = vi.fn() }: { options: SelectOption[]; initial?: string[]; onChange?: (v: string[]) => void }) {
  const [selected, setSelected] = useState(initial);
  return (
    <SelectList
      label="Groupes"
      options={options}
      selected={selected}
      searchPlaceholder="Rechercher un groupe"
      emptyText="Aucun groupe"
      onChange={(next) => {
        onChange(next);
        setSelected(next);
      }}
    />
  );
}

describe('SelectList', () => {
  it('is a multi-select listbox whose rows toggle', async () => {
    const onChange = vi.fn();
    render(<Harness options={groups(3)} initial={['g1']} onChange={onChange} />);
    const list = screen.getByRole('listbox', { name: 'Groupes' });
    expect(list).toHaveAttribute('aria-multiselectable', 'true');
    expect(within(list).getByRole('option', { name: 'Groupe 1' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(within(list).getByRole('option', { name: 'Groupe 2' }));
    expect(onChange).toHaveBeenLastCalledWith(['g1', 'g2']);
    await userEvent.click(within(list).getByRole('option', { name: 'Groupe 1' }));
    expect(onChange).toHaveBeenLastCalledWith(['g2']);
    expect(within(list).getByRole('option', { name: 'Groupe 2' })).toHaveAttribute('aria-selected', 'true');
  });

  it('is one tab stop: the arrows move, Space and Enter toggle', async () => {
    const onChange = vi.fn();
    render(<Harness options={groups(3)} onChange={onChange} />);
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    await userEvent.tab();
    expect(screen.getByRole('option', { name: 'Groupe 0' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: 'Groupe 1' })).toHaveFocus();
    await userEvent.keyboard(' ');
    expect(onChange).toHaveBeenLastCalledWith(['g1']);
    await userEvent.keyboard('{End}{Enter}');
    expect(onChange).toHaveBeenLastCalledWith(['g1', 'g2']);
    await userEvent.tab({ shift: true });
    await userEvent.tab();
    expect(screen.getByRole('option', { name: 'Groupe 2' })).toHaveFocus();
  });

  it('offers a search field from 8 options, ignoring case and accents, keeping the selection', async () => {
    const options = [...groups(7), { value: 'id', label: 'Identité', detail: 'acme/identite' }];
    const onChange = vi.fn();
    render(<Harness options={options} initial={['g0']} onChange={onChange} />);
    const search = screen.getByRole('searchbox', { name: 'Rechercher un groupe' });
    await userEvent.type(search, 'IDENTITE');
    expect(screen.getAllByRole('option').map((o) => o.getAttribute('aria-label'))).toEqual(['Identité, acme/identite']);
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: /Identité/ })).toHaveFocus();
    await userEvent.keyboard(' ');
    expect(onChange).toHaveBeenLastCalledWith(['g0', 'id']);
    await userEvent.clear(search);
    await userEvent.type(search, 'zzz');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText('Aucun résultat')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(search).toHaveValue('');
    expect(screen.getAllByRole('option')).toHaveLength(8);
  });

  it('says when there is nothing to pick', () => {
    render(<Harness options={[]} />);
    expect(screen.getByText('Aucun groupe')).toBeInTheDocument();
  });

  it('indents subgroups and paints label colors through custom properties', () => {
    render(<Harness options={[{ value: 'a', label: 'a/b', depth: 2 }, { value: 'bug', label: 'bug', color: '#d9534f' }]} />);
    expect(screen.getByRole('option', { name: 'a/b' }).style.getPropertyValue('--depth')).toBe('2');
    const bug = screen.getByRole('option', { name: 'bug' });
    expect(bug.style.getPropertyValue('--label-color')).toBe('#d9534f');
    expect(bug.querySelector('.select-list-dot')).not.toBeNull();
  });
});

// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LaneSettingsSheet } from './LaneSettingsSheet';
import type { LaneSettingsFocus } from './LaneSettingsSheet';
import { SummaryLine } from './SummaryLine';
import { defaultLanes } from '../board/lanes';
import { mockupBoard } from '../board/fixtures';
import type { Lane } from '../board/types';

function setup(focus: LaneSettingsFocus = null) {
  const data = mockupBoard();
  const lanes = defaultLanes(data);
  const onApply = vi.fn<(lanes: Lane[]) => void>();
  const onClose = vi.fn();
  render(<LaneSettingsSheet data={data} lanes={lanes} focus={focus} onApply={onApply} onClose={onClose} />);
  return { data, lanes, onApply, onClose, user: userEvent.setup() };
}

const names = () =>
  within(screen.getByRole('list', { name: 'Liste des couloirs' }))
    .getAllByRole('listitem')
    .map((item) => item.querySelector('.lane-settings-name')?.textContent);

describe('LaneSettingsSheet', () => {
  it('edits a draft: nothing is applied before Appliquer', async () => {
    const { lanes, onApply, onClose, user } = setup({ laneId: defaultLanes(mockupBoard())[1].id });
    const name = screen.getByRole('textbox', { name: 'Nom' });
    expect(name).toHaveValue(lanes[1].name);
    await user.clear(name);
    await user.type(name, 'Données');
    await user.click(screen.getByRole('radio', { name: 'Rose' }));
    await user.click(screen.getByRole('button', { name: `Monter Données` }));
    expect(names()[0]).toBe('Données');
    expect(onApply).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Appliquer' }));
    const applied = onApply.mock.calls[0][0];
    expect(applied[0]).toMatchObject({ id: lanes[1].id, name: 'Données', color: 'pink' });
    expect(applied[1].id).toBe(lanes[0].id);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Annuler and Escape discard', async () => {
    const { onApply, onClose, user } = setup();
    await user.click(screen.getAllByRole('button', { name: /^Supprimer/ })[0]);
    await user.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.keyboard('{Escape}');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('opens on a new lane, and resets to the default lanes', async () => {
    const { lanes, onApply, user } = setup({ newLane: true });
    expect(names()).toHaveLength(lanes.length + 1);
    expect(screen.getByRole('textbox', { name: 'Nom' })).toHaveValue('Nouveau couloir');
    // No label: the match mode is disabled.
    expect(screen.getByRole('radio', { name: 'Tous' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Rétablir les couloirs par défaut' }));
    expect(names()).toHaveLength(lanes.length);
    await user.click(screen.getByRole('button', { name: 'Appliquer' }));
    expect(onApply.mock.calls[0][0].map((lane) => lane.id)).toEqual(lanes.map((lane) => lane.id));
  });

  it('turns a lane off and picks its groups and labels', async () => {
    const { lanes, onApply, user } = setup();
    await user.click(screen.getByRole('checkbox', { name: `Afficher ${lanes[0].name}` }));
    await user.click(screen.getByRole('option', { name: /^Data/ }));
    await user.click(screen.getByRole('option', { name: /^bug/ }));
    expect(screen.getByRole('radio', { name: 'Tous' })).toBeEnabled();
    await user.click(screen.getByRole('radio', { name: 'Tous' }));
    await user.click(screen.getByRole('button', { name: 'Appliquer' }));
    const lane = onApply.mock.calls[0][0][0];
    expect(lane.active).toBe(false);
    expect(lane.groups).toEqual([...lanes[0].groups, 'plateforme/atlas/data']);
    expect(lane.labels).toEqual(['bug']);
    expect(lane.labelMode).toBe('all');
  });
});

describe('SummaryLine', () => {
  it('shows the counts, the conflicts in red only when any', () => {
    const { container, rerender } = render(
      <SummaryLine stats={{ lanes: 4, epics: 10, issues: 9, blocks: 12, conflicts: 2 }} />,
    );
    expect(container).toHaveTextContent('4 couloirs · 10 epics · 9 issues bloquantes · 12 blocages · 2 conflits');
    expect(container.querySelector('[data-alert="true"]')).toHaveTextContent('2 conflits');

    rerender(<SummaryLine stats={{ lanes: 1, epics: 0, issues: 1, blocks: 0, conflicts: 0 }} />);
    expect(container).toHaveTextContent('1 couloir · 0 epic · 1 issue bloquante');
    expect(container).not.toHaveTextContent('conflit');
    expect(container.querySelector('[data-alert="true"]')).toBeNull();
  });
});

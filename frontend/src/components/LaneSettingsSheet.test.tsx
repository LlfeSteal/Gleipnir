// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LaneSettingsSheet } from './LaneSettingsSheet';
import type { LaneSettingsFocus } from './LaneSettingsSheet';
import { defaultLanes } from '../board/lanes';
import { groupId, mockupBoard } from '../board/fixtures';
import type { Lane } from '../board/types';

function setup(focus: LaneSettingsFocus = null, lanes?: Lane[]) {
  const data = mockupBoard();
  const current = lanes ?? defaultLanes(data);
  const onApply = vi.fn<(lanes: Lane[]) => void>();
  const onClose = vi.fn();
  render(<LaneSettingsSheet data={data} lanes={current} focus={focus} onApply={onApply} onClose={onClose} />);
  return { data, lanes: current, onApply, onClose, user: userEvent.setup() };
}

const names = () =>
  within(screen.getByRole('list', { name: 'Liste des couloirs' }))
    .getAllByRole('listitem')
    .map((item) => item.querySelector('.lane-settings-name')?.textContent);

describe('LaneSettingsSheet (« Configurer les couloirs », spec §4.4)', () => {
  it('is a modal titled « Configurer les couloirs »', () => {
    setup();
    expect(screen.getByRole('dialog', { name: 'Configurer les couloirs' })).toBeInTheDocument();
  });

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
    // Escape: the browser fires "cancel" on the modal dialog (jsdom doesn't, on a key press).
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('opens on a new lane, which needs a group before Appliquer', async () => {
    const { lanes, onApply, user } = setup({ newLane: true });
    expect(names()).toHaveLength(lanes.length + 1);
    expect(screen.getByRole('textbox', { name: 'Nom' })).toHaveValue('Nouveau couloir');
    // The next free color.
    expect(screen.getByRole('radio', { name: 'Jaune' })).toHaveAttribute('aria-checked', 'true');
    // No group yet: Appliquer waits, and says why.
    expect(screen.getByText('Choisissez au moins un groupe.')).toBeInTheDocument();
    expect(screen.getByText('Chaque couloir doit avoir au moins un groupe.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Appliquer' })).toBeDisabled();
    // No label: the match mode is disabled.
    expect(screen.getByRole('radio', { name: 'Tous' })).toBeDisabled();

    await user.click(screen.getByRole('option', { name: /^Partenaires/ }));
    expect(screen.getByRole('button', { name: 'Appliquer' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Appliquer' }));
    expect(onApply.mock.calls[0][0].at(-1)).toMatchObject({ name: 'Nouveau couloir', groups: [groupId(5)], color: 'yellow' });
  });

  it('picks groups from the GitLab tree, by id, indented', async () => {
    const { lanes, onApply, user } = setup();
    const tree = screen.getByRole('listbox', { name: 'Groupes GitLab' });
    const options = within(tree).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringMatching(/^Atlas/),
      expect.stringMatching(/^API & intégrations/),
      expect.stringMatching(/^Partenaires/),
      expect.stringMatching(/^Data/),
      expect.stringMatching(/^Expérience produit/),
      expect.stringMatching(/^Identité & sécurité/),
    ]);
    await user.click(within(tree).getByRole('option', { name: /^Data/ }));
    await user.click(screen.getByRole('switch', { name: /Inclure les sous-groupes/ }));
    await user.click(screen.getByRole('button', { name: 'Appliquer' }));
    expect(onApply.mock.calls[0][0][0]).toMatchObject({ groups: [...lanes[0].groups, groupId(2)], includeSubgroups: false });
  });

  it('sets the epics and the issue mode: Toutes, Bloquantes or Aucune', async () => {
    const { onApply, user } = setup();
    const modes = screen.getByRole('radiogroup', { name: 'Issues' });
    expect(within(modes).getByRole('radio', { name: 'Bloquantes' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Uniquement les issues qui bloquent un epic.')).toBeInTheDocument();
    await user.click(within(modes).getByRole('radio', { name: 'Toutes' }));
    expect(screen.getByText('Toutes les issues des groupes du couloir.')).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Epics' }));
    await user.click(screen.getByRole('button', { name: 'Appliquer' }));
    expect(onApply.mock.calls[0][0][0]).toMatchObject({ issueMode: 'all', showEpics: false });
    await user.click(within(modes).getByRole('radio', { name: 'Aucune' }));
    expect(screen.getByText('Aucune issue dans ce couloir.')).toBeInTheDocument();
  });

  it('turns a lane off and picks its labels', async () => {
    const { lanes, onApply, user } = setup();
    await user.click(screen.getByRole('checkbox', { name: `Afficher ${lanes[0].name}` }));
    await user.click(screen.getByRole('option', { name: /^bug/ }));
    expect(screen.getByRole('radio', { name: 'Tous' })).toBeEnabled();
    await user.click(screen.getByRole('radio', { name: 'Tous' }));
    await user.click(screen.getByRole('button', { name: 'Appliquer' }));
    const lane = onApply.mock.calls[0][0][0];
    expect(lane).toMatchObject({ active: false, labels: ['bug'], labelMode: 'all' });
  });

  it('moves, deletes, adds, and resets to the example configuration', async () => {
    const { lanes, onApply, user } = setup();
    expect(screen.getByRole('button', { name: `Monter ${lanes[0].name}` })).toBeDisabled();
    expect(screen.getByRole('button', { name: `Descendre ${lanes.at(-1)!.name}` })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: `Descendre ${lanes[0].name}` }));
    expect(names().slice(0, 2)).toEqual([lanes[1].name, lanes[0].name]);
    // Deleting the selected lane selects its neighbour.
    await user.click(screen.getByRole('button', { name: `Supprimer ${lanes[0].name}` }));
    expect(names()).toHaveLength(lanes.length - 1);
    expect(screen.getByRole('textbox', { name: 'Nom' })).toHaveValue(lanes[2].name);
    for (const name of names()) await user.click(screen.getByRole('button', { name: `Supprimer ${name}` }));
    expect(screen.getAllByText('Aucun couloir. Créez-en un pour afficher des éléments.')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Rétablir la configuration d’exemple' }));
    expect(names()).toHaveLength(lanes.length);
    await user.click(screen.getByRole('button', { name: 'Nouveau couloir' }));
    expect(names()).toHaveLength(lanes.length + 1);
    await user.click(screen.getByRole('button', { name: `Supprimer Nouveau couloir` }));
    await user.click(screen.getByRole('button', { name: 'Appliquer' }));
    expect(onApply.mock.calls[0][0].map((lane) => lane.id)).toEqual(lanes.map((lane) => lane.id));
  });

  it('names an unnamed lane on Appliquer, and opens on the first lane, or none', async () => {
    const { onApply, user } = setup({ laneId: 'unknown' });
    const name = screen.getByRole('textbox', { name: 'Nom' });
    expect(name).toHaveValue('API & intégrations');
    await user.clear(name);
    expect(names()[0]).toBe('Couloir sans nom');
    await user.click(screen.getByRole('button', { name: 'Appliquer' }));
    expect(onApply.mock.calls[0][0][0].name).toBe('Couloir sans nom');
  });

  it('with no lane at all, invites to create one', () => {
    setup(null, []);
    expect(screen.getAllByText('Aucun couloir. Créez-en un pour afficher des éléments.')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Appliquer' })).toBeEnabled();
  });

  it('selects a lane from the list, and moves the color with the arrow keys', async () => {
    const { lanes, onApply, user } = setup();
    await user.click(screen.getByRole('button', { name: new RegExp(`^${lanes[2].name}`) }));
    expect(screen.getByRole('textbox', { name: 'Nom' })).toHaveValue(lanes[2].name);
    const cyan = screen.getByRole('radio', { name: 'Cyan' });
    expect(cyan).toHaveAttribute('aria-checked', 'true');
    cyan.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Menthe' })).toHaveFocus();
    await user.keyboard('{ArrowUp}{ArrowUp}{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'Indigo' })).toHaveAttribute('aria-checked', 'true');
    // Wraps around; another key changes nothing.
    await user.keyboard('{ArrowLeft}a');
    expect(screen.getByRole('radio', { name: 'Marron' })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('button', { name: 'Appliquer' }));
    expect(onApply.mock.calls[0][0][2].color).toBe('brown');
  });
});

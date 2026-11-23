import { useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import type { BoardData } from '../api/types';
import type { Lane, LaneColor } from '../board/types';
import { LANE_COLORS } from '../board/types';
import { defaultLanes, laneSummary, newLane } from '../board/lanes';
import { Sheet } from './ui/Sheet';
import { Switch } from './ui/Switch';
import { Checkbox } from './ui/Checkbox';
import { SelectList } from './ui/SelectList';
import { SegmentedControl } from './ui/SegmentedControl';
import { ChevronDownIcon, ChevronUpIcon, PlusIcon, TrashIcon } from './ui/Icons';
import { APP } from '../strings';

/** Which lane the sheet opens on: an existing one, a new one, or the first. */
export type LaneSettingsFocus = { laneId: string } | { newLane: true } | null;

interface Props {
  data: BoardData;
  lanes: Lane[];
  focus: LaneSettingsFocus;
  onApply: (lanes: Lane[]) => void;
  onClose: () => void;
}

const copy = (lanes: Lane[]) => lanes.map((lane) => ({ ...lane, groups: [...lane.groups], labels: [...lane.labels] }));

/** The lane settings (spec §4.4), master–detail like macOS Settings. It edits a draft copy:
 * nothing changes on the board before "Appliquer"; Annuler, Escape and the backdrop discard.
 * Mounted while open, so each opening starts from the current lanes. */
export function LaneSettingsSheet({ data, lanes, focus, onApply, onClose }: Props) {
  const [initial] = useState(() => {
    const draft = copy(lanes);
    if (focus && 'newLane' in focus) {
      const lane = newLane(draft);
      return { draft: [...draft, lane], selected: lane.id };
    }
    const selected = focus && 'laneId' in focus && draft.some((l) => l.id === focus.laneId) ? focus.laneId : draft[0]?.id ?? null;
    return { draft, selected };
  });
  const [draft, setDraft] = useState<Lane[]>(initial.draft);
  const [selectedId, setSelectedId] = useState<string | null>(initial.selected);
  const nameInput = useRef<HTMLInputElement>(null);
  const selected = draft.find((lane) => lane.id === selectedId) ?? null;

  const rootDepth = data.rootGroup.path.split('/').length;
  const groupOptions = useMemo(
    () =>
      data.groups.map((group) => ({
        value: group.path,
        label: group.name,
        detail: group.path,
        depth: Math.max(0, group.path.split('/').length - rootDepth),
      })),
    [data.groups, rootDepth],
  );
  const labelOptions = useMemo(
    () => data.labels.map((label) => ({ value: label.title, label: label.title, color: label.color })),
    [data.labels],
  );

  const update = (id: string, patch: Partial<Lane>) =>
    setDraft((list) => list.map((lane) => (lane.id === id ? { ...lane, ...patch } : lane)));
  const move = (index: number, delta: number) =>
    setDraft((list) => {
      const target = index + delta;
      if (target < 0 || target >= list.length) return list;
      const next = [...list];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  const remove = (index: number) => {
    const next = draft.filter((_, i) => i !== index);
    setDraft(next);
    if (draft[index]?.id === selectedId) setSelectedId(next[Math.min(index, next.length - 1)]?.id ?? null);
  };
  const add = () => {
    const lane = newLane(draft);
    setDraft([...draft, lane]);
    setSelectedId(lane.id);
    // The name is the first thing to change in a new lane.
    requestAnimationFrame(() => nameInput.current?.select());
  };
  const reset = () => {
    const next = defaultLanes(data);
    setDraft(next);
    setSelectedId(next[0]?.id ?? null);
  };
  const apply = () =>
    onApply(draft.map((lane) => ({ ...lane, name: lane.name.trim() || APP.settings.untitled })));

  const footer = (
    <>
      <button type="button" className="button plain" onClick={reset}>
        {APP.settings.reset}
      </button>
      <span className="sheet-footer-spacer" />
      <button type="button" className="button" onClick={onClose}>
        {APP.settings.cancel}
      </button>
      <button type="button" className="button primary" onClick={apply}>
        {APP.settings.apply}
      </button>
    </>
  );

  return (
    <Sheet
      open
      onClose={onClose}
      title={APP.settings.title}
      subtitle={APP.settings.subtitle}
      footer={footer}
      className="lane-settings"
    >
      <div className="lane-settings-layout">
        <div className="lane-settings-master">
          <ul className="lane-settings-list" aria-label={APP.settings.list}>
            {draft.map((lane, index) => {
              const name = lane.name.trim() || APP.settings.untitled;
              return (
                <li
                  key={lane.id}
                  className="lane-settings-item"
                  data-lane-color={lane.color}
                  data-selected={lane.id === selectedId || undefined}
                >
                  <Checkbox
                    checked={lane.active}
                    onChange={(active) => update(lane.id, { active })}
                    label={null}
                    aria-label={APP.settings.showLane(name)}
                  />
                  <button
                    type="button"
                    className="lane-settings-select"
                    aria-current={lane.id === selectedId ? 'true' : undefined}
                    onClick={() => setSelectedId(lane.id)}
                  >
                    <span className="lane-dot" aria-hidden="true" />
                    <span className="lane-settings-text">
                      <span className="lane-settings-name">{name}</span>
                      <span className="lane-settings-summary">{laneSummary(lane, data.groups)}</span>
                    </span>
                  </button>
                  <span className="lane-settings-tools">
                    <button
                      type="button"
                      className="button icon"
                      aria-label={APP.settings.moveUp(name)}
                      title={APP.settings.moveUp(name)}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ChevronUpIcon size={13} />
                    </button>
                    <button
                      type="button"
                      className="button icon"
                      aria-label={APP.settings.moveDown(name)}
                      title={APP.settings.moveDown(name)}
                      disabled={index === draft.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ChevronDownIcon size={13} />
                    </button>
                    <button
                      type="button"
                      className="button icon"
                      aria-label={APP.settings.remove(name)}
                      title={APP.settings.remove(name)}
                      onClick={() => remove(index)}
                    >
                      <TrashIcon size={13} />
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
          {draft.length === 0 && <p className="hint">{APP.settings.noLane}</p>}
          <button type="button" className="button plain lane-settings-add" onClick={add}>
            <PlusIcon size={13} />
            {APP.settings.newLane}
          </button>
        </div>

        <div className="lane-settings-detail">
          {selected ? (
            <LaneForm
              key={selected.id}
              lane={selected}
              nameRef={nameInput}
              groupOptions={groupOptions}
              labelOptions={labelOptions}
              onChange={(patch) => update(selected.id, patch)}
            />
          ) : (
            <p className="hint lane-settings-empty">{draft.length ? APP.settings.pick : APP.settings.noLane}</p>
          )}
        </div>
      </div>
    </Sheet>
  );
}

interface FormProps {
  lane: Lane;
  nameRef: RefObject<HTMLInputElement | null>;
  groupOptions: { value: string; label: string; detail: string; depth: number }[];
  labelOptions: { value: string; label: string; color: string }[];
  onChange: (patch: Partial<Lane>) => void;
}

function LaneForm({ lane, nameRef, groupOptions, labelOptions, onChange }: FormProps) {
  const swatches = useRef<(HTMLButtonElement | null)[]>([]);
  const pickColor = (color: LaneColor) => onChange({ color });
  // Arrow keys move the choice, as in a native radio group.
  const onSwatchKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + LANE_COLORS.length) % LANE_COLORS.length;
    pickColor(LANE_COLORS[next]);
    swatches.current[next]?.focus();
  };
  const noLabel = lane.labels.length === 0;

  return (
    <div className="lane-form">
      <label className="form-field">
        <span className="form-label">{APP.settings.name}</span>
        <input
          ref={nameRef}
          type="text"
          className="text-field"
          value={lane.name}
          autoComplete="off"
          onChange={(event) => onChange({ name: event.target.value })}
        />
      </label>

      <div className="form-field">
        <span className="form-label" id={`color-${lane.id}`}>
          {APP.settings.color}
        </span>
        <div className="color-swatches" role="radiogroup" aria-labelledby={`color-${lane.id}`}>
          {LANE_COLORS.map((color, index) => (
            <button
              key={color}
              ref={(element) => {
                swatches.current[index] = element;
              }}
              type="button"
              role="radio"
              className="color-swatch"
              data-lane-color={color}
              aria-checked={lane.color === color}
              aria-label={APP.settings.colors[color]}
              title={APP.settings.colors[color]}
              tabIndex={lane.color === color ? 0 : -1}
              onClick={() => pickColor(color)}
              onKeyDown={(event) => onSwatchKey(event, index)}
            />
          ))}
        </div>
      </div>

      <div className="form-field">
        <span className="form-label" aria-hidden="true">
          {APP.settings.groups}
        </span>
        <SelectList
          label={APP.settings.groups}
          options={groupOptions}
          selected={lane.groups}
          onChange={(groups) => onChange({ groups })}
          searchPlaceholder={APP.settings.groupsSearch}
          emptyText={APP.settings.noGroup}
          maxHeight={200}
        />
        <div className="form-group">
          <Switch
            checked={lane.includeSubgroups}
            onChange={(includeSubgroups) => onChange({ includeSubgroups })}
            label={APP.settings.includeSubgroups}
            description={APP.settings.includeSubgroupsHelp}
          />
        </div>
      </div>

      <div className="form-field">
        <span className="form-label">{APP.settings.show}</span>
        <div className="form-group">
          <Switch checked={lane.showEpics} onChange={(showEpics) => onChange({ showEpics })} label={APP.settings.epics} />
          <Switch
            checked={lane.showIssues}
            onChange={(showIssues) => onChange({ showIssues })}
            label={APP.settings.issues}
            description={APP.settings.issuesHelp}
          />
        </div>
      </div>

      <div className="form-field">
        <span className="form-label" aria-hidden="true">
          {APP.settings.labels}
        </span>
        <SelectList
          label={APP.settings.labels}
          options={labelOptions}
          selected={lane.labels}
          onChange={(labels) => onChange({ labels })}
          searchPlaceholder={APP.settings.labelsSearch}
          emptyText={APP.settings.noLabelAvailable}
          maxHeight={200}
        />
        <div className="label-mode">
          <fieldset className="plain-fieldset" disabled={noLabel}>
            <SegmentedControl
              label={APP.settings.labelMode}
              size="small"
              options={[
                { label: APP.settings.any, value: 'any' },
                { label: APP.settings.all, value: 'all' },
              ]}
              value={lane.labelMode}
              onChange={(labelMode) => onChange({ labelMode })}
            />
          </fieldset>
          <span className="hint">{noLabel ? APP.settings.noLabel : APP.settings.labelsApply}</span>
        </div>
      </div>
    </div>
  );
}

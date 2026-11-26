import { useRef, useState } from 'react';
import type { BoardData } from '../api/types';
import type { BoardWindow } from '../board/types';
import type { PresetId } from '../board/window';
import { activePreset, presetWindow, shiftWindow } from '../board/window';
import { shortIterationLabel } from '../board/format';
import { activeCadenceIds, toggleCadence } from '../board/cadences';
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from './ui/Icons';
import { MenuHeader, MenuItem, MenuSeparator, Popover } from './ui/Popover';
import { APP } from '../strings';

const PRESETS: PresetId[] = ['around', 'next', 'all'];

interface Props {
  data: BoardData;
  /** null when the active cadences have no iteration: only the cadences can be picked. */
  window: BoardWindow | null;
  onChange: (next: BoardWindow) => void;
  /** The new active cadences, by ID (ADR-38). */
  onCadencesChange: (ids: string[]) => void;
}

/** The iteration window: ‹ [It. 14 – It. 18 ▾] ›. The arrows shift it by one iteration (same
 * width); the pop-up picks the active cadences (ADR-38), the window's start and end, or a
 * preset (spec §4.3). */
export function WindowControl({ data, window: requested, onChange, onCadencesChange }: Props) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const iterations = data.iterations;
  const count = iterations.length;
  const cadences = data.cadences;
  // A choice only with several cadences; without a column, nothing else to pick.
  const pickCadences = cadences.length > 1;
  const win = requested && count > 0 ? requested : null;
  if (!win && !pickCadences) return null;

  const label = win
    ? APP.window.range(shortIterationLabel(iterations[win.from]), shortIterationLabel(iterations[win.to]))
    : APP.window.noIteration;
  const preset = win ? activePreset(win, data) : null;
  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) button.current?.focus();
  };
  const active = activeCadenceIds(data);

  return (
    <div className="window-control" role="group" aria-label={APP.window.group}>
      <button
        type="button"
        className="button icon"
        aria-label={APP.window.previous}
        title={APP.window.previous}
        disabled={!win || win.from <= 0}
        onClick={() => win && onChange(shiftWindow(win, -1, count))}
      >
        <ChevronLeftIcon size={14} />
      </button>
      <div className="menu-anchor">
        <button
          ref={button}
          type="button"
          className="button popup-button window-button"
          aria-label={APP.window.button(label)}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="window-button-text">{label}</span>
          <ChevronDownIcon size={12} />
        </button>
        <Popover open={open} onClose={close} label={APP.window.menu} align="center" className="window-menu">
          {pickCadences && (
            <>
              <div role="group" aria-label={APP.window.cadences}>
                <MenuHeader>{APP.window.cadences}</MenuHeader>
                {cadences.map((c) => (
                  <MenuItem
                    key={c.id}
                    role="menuitemcheckbox"
                    checked={c.active}
                    // At least one cadence stays active: the last one cannot be unchecked.
                    disabled={c.active && active.length === 1}
                    onSelect={() => onCadencesChange(toggleCadence(data, c.id))}
                  >
                    {c.title}
                  </MenuItem>
                ))}
              </div>
              {win && <MenuSeparator />}
            </>
          )}
          {win && (
            <WindowLists data={data} window={win} onChange={onChange} preset={preset} close={close} />
          )}
        </Popover>
      </div>
      <button
        type="button"
        className="button icon"
        aria-label={APP.window.next}
        title={APP.window.next}
        disabled={!win || win.to >= count - 1}
        onClick={() => win && onChange(shiftWindow(win, 1, count))}
      >
        <ChevronRightIcon size={14} />
      </button>
    </div>
  );
}

/** The start and end lists, then the presets. */
function WindowLists({
  data,
  window: win,
  onChange,
  preset,
  close,
}: {
  data: BoardData;
  window: BoardWindow;
  onChange: (next: BoardWindow) => void;
  preset: PresetId | null;
  close: (restoreFocus: boolean) => void;
}) {
  const iterations = data.iterations;
  return (
    <>
      <div className="window-lists">
        <div className="window-list" role="group" aria-label={APP.window.start}>
          <MenuHeader>{APP.window.start}</MenuHeader>
          {iterations.map((it, index) => (
            <MenuItem
              key={it.id}
              role="menuitemradio"
              checked={index === win.from}
              disabled={index > win.to}
              detail={it.current ? APP.window.current : undefined}
              onSelect={() => onChange({ from: index, to: win.to })}
            >
              {shortIterationLabel(it)}
            </MenuItem>
          ))}
        </div>
        <div className="window-list" role="group" aria-label={APP.window.end}>
          <MenuHeader>{APP.window.end}</MenuHeader>
          {iterations.map((it, index) => (
            <MenuItem
              key={it.id}
              role="menuitemradio"
              checked={index === win.to}
              disabled={index < win.from}
              detail={it.current ? APP.window.current : undefined}
              onSelect={() => onChange({ from: win.from, to: index })}
            >
              {shortIterationLabel(it)}
            </MenuItem>
          ))}
        </div>
      </div>
      <MenuSeparator />
      <MenuHeader>{APP.window.presetsHeader}</MenuHeader>
      {PRESETS.map((id) => (
        <MenuItem
          key={id}
          role="menuitemradio"
          checked={preset === id}
          onSelect={() => {
            onChange(presetWindow(id, data));
            close(true);
          }}
        >
          {APP.window.presets[id]}
        </MenuItem>
      ))}
    </>
  );
}

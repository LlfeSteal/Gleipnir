import { useRef, useState } from 'react';
import type { BoardData } from '../api/types';
import type { BoardWindow } from '../board/types';
import type { PresetId } from '../board/window';
import { activePreset, presetWindow, shiftWindow } from '../board/window';
import { shortIterationLabel } from '../board/format';
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from './ui/Icons';
import { MenuHeader, MenuItem, MenuSeparator, Popover } from './ui/Popover';
import { APP } from '../strings';

const PRESETS: PresetId[] = ['around', 'next', 'all'];

interface Props {
  data: BoardData;
  window: BoardWindow;
  onChange: (next: BoardWindow) => void;
}

/** The iteration window: ‹ [It. 14 – It. 18 ▾] ›. The arrows shift it by one iteration (same
 * width); the pop-up picks its start and end, or a preset (spec §4.3). */
export function WindowControl({ data, window: win, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const iterations = data.iterations;
  const count = iterations.length;
  if (count === 0) return null;

  const label = APP.window.range(shortIterationLabel(iterations[win.from]), shortIterationLabel(iterations[win.to]));
  const preset = activePreset(win, data);
  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) button.current?.focus();
  };

  return (
    <div className="window-control" role="group" aria-label={APP.window.group}>
      <button
        type="button"
        className="button icon"
        aria-label={APP.window.previous}
        title={APP.window.previous}
        disabled={win.from <= 0}
        onClick={() => onChange(shiftWindow(win, -1, count))}
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
        </Popover>
      </div>
      <button
        type="button"
        className="button icon"
        aria-label={APP.window.next}
        title={APP.window.next}
        disabled={win.to >= count - 1}
        onClick={() => onChange(shiftWindow(win, 1, count))}
      >
        <ChevronRightIcon size={14} />
      </button>
    </div>
  );
}

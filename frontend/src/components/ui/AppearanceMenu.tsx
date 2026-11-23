import { useRef, useState } from 'react';
import type { Appearance } from '../../hooks/useAppearance';
import { UI } from '../../strings/ui';
import { AutoAppearanceIcon, MoonIcon, SunIcon } from './Icons';
import { MenuHeader, MenuItem, Popover } from './Popover';

const OPTIONS: { value: Appearance; Icon: typeof SunIcon }[] = [
  { value: 'system', Icon: AutoAppearanceIcon },
  { value: 'light', Icon: SunIcon },
  { value: 'dark', Icon: MoonIcon },
];

interface Props {
  appearance: Appearance;
  onChange: (appearance: Appearance) => void;
}

/** Toolbar button with a macOS pull-down menu to pick the appearance. */
export function AppearanceMenu({ appearance, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const current = OPTIONS.find((o) => o.value === appearance) ?? OPTIONS[0];

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) button.current?.focus();
  };

  return (
    <div className="menu-anchor">
      <button
        ref={button}
        type="button"
        className="button icon"
        aria-label={UI.appearance}
        title={UI.appearanceTitle(UI.appearanceOptions[current.value])}
        aria-haspopup="menu"
        aria-expanded={open}
        data-appearance={appearance}
        onClick={() => setOpen((value) => !value)}
      >
        <current.Icon size={15} />
      </button>
      <Popover open={open} onClose={close} label={UI.appearance} align="end">
        <MenuHeader>{UI.appearance}</MenuHeader>
        {OPTIONS.map(({ value, Icon }) => (
          <MenuItem
            key={value}
            role="menuitemradio"
            checked={value === appearance}
            icon={<Icon size={14} />}
            onSelect={() => {
              onChange(value);
              close(true);
            }}
          >
            {UI.appearanceOptions[value]}
          </MenuItem>
        ))}
      </Popover>
    </div>
  );
}

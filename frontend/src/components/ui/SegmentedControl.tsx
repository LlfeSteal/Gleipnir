import { useRef } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';

interface Props<T extends string> {
  label: string;
  options: { label: string; value: T }[];
  value: T;
  onChange: (value: T) => void;
  size?: 'regular' | 'small';
}

/** Apple-style segmented control: a radio group whose selection is a sliding thumb. Like native
 * radios, it is one tab stop and the arrow keys move the selection. */
export function SegmentedControl<T extends string>({ label, options, value, onChange, size = 'regular' }: Props<T>) {
  const group = useRef<HTMLDivElement>(null);
  const index = Math.max(0, options.findIndex((o) => o.value === value));

  const onKeyDown = (event: KeyboardEvent) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step || options.length === 0) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    onChange(options[next].value);
    group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  };

  return (
    <div
      ref={group}
      className="segmented"
      role="radiogroup"
      aria-label={label}
      data-size={size}
      style={{ '--segments': options.length } as CSSProperties}
      onKeyDown={onKeyDown}
    >
      <span className="segmented-thumb" style={{ transform: `translateX(${index * 100}%)` }} />
      {options.map((option, i) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={i === index ? 0 : -1}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

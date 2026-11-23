import { useId } from 'react';
import type { ReactNode } from 'react';

interface Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  /** Trailing secondary text, e.g. a count. */
  detail?: ReactNode;
  disabled?: boolean;
  /** When the visible label isn't a good accessible name (e.g. it holds a swatch). */
  'aria-label'?: string;
}

/** A macOS checkbox row: the native control (accent blue), its label and an optional detail. */
export function Checkbox({ checked, onChange, label, detail, disabled, 'aria-label': ariaLabel }: Props) {
  const id = useId();
  const hasDetail = detail !== undefined && detail !== null;
  // Named by the label alone: the detail (a count) describes it.
  return (
    <label className="checkbox-row" data-disabled={disabled ? 'true' : undefined}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabel ? undefined : `${id}-label`}
        aria-describedby={hasDetail ? `${id}-detail` : undefined}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span id={`${id}-label`} className="checkbox-label">
        {label}
      </span>
      {hasDetail && (
        <span id={`${id}-detail`} className="checkbox-detail">
          {detail}
        </span>
      )}
    </label>
  );
}

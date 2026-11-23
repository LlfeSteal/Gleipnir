import { useId } from 'react';

interface Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}

/** A settings row with an iOS / macOS toggle switch on the right. The whole label is
 * clickable, like a native one. */
export function Switch({ checked, onChange, label, description, disabled }: Props) {
  const id = useId();
  return (
    <div className="switch-row" data-disabled={disabled ? 'true' : undefined}>
      <label className="switch-text" htmlFor={id}>
        <span id={`${id}-label`}>{label}</span>
        {description && (
          <span id={`${id}-description`} className="switch-description">
            {description}
          </span>
        )}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        className="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-description` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <span className="switch-knob" />
      </button>
    </div>
  );
}

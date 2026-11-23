import { useCallback, useRef } from 'react';
import type { KeyboardEvent, Ref } from 'react';
import { UI } from '../../strings/ui';
import { ClearIcon, SearchIcon } from './Icons';

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label: string;
  inputRef?: Ref<HTMLInputElement>;
  className?: string;
}

/** Apple search field: magnifier, text, and a round clear button once something is typed.
 * Escape clears it (and only then stops there, so an empty field lets Escape close a sheet). */
export function SearchField({ value, onChange, placeholder, label, inputRef, className }: Props) {
  const input = useRef<HTMLInputElement | null>(null);
  const setInput = useCallback(
    (element: HTMLInputElement | null) => {
      input.current = element;
      if (typeof inputRef === 'function') inputRef(element);
      else if (inputRef) inputRef.current = element;
    },
    [inputRef],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && value) {
      event.preventDefault();
      event.stopPropagation();
      onChange('');
    }
  };

  return (
    <div className={className ? `search-field ${className}` : 'search-field'}>
      <SearchIcon size={14} />
      <input
        ref={setInput}
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {value && (
        <button
          type="button"
          className="search-clear"
          aria-label={UI.clear}
          title={UI.clear}
          // Keep the focus in the field.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onChange('');
            input.current?.focus();
          }}
        >
          <ClearIcon size={14} />
        </button>
      )}
    </div>
  );
}

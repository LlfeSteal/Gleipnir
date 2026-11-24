import { useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { UI } from '../../strings/ui';
import { CheckIcon, SearchIcon } from './Icons';

export interface SelectOption {
  value: string;
  label: string;
  /** Trailing secondary text (a path, a count); also searched. */
  detail?: string;
  /** A GitLab label color: data, so it goes through --label-color. */
  color?: string;
  /** Indentation level (subgroups), dropped while searching. */
  depth?: number;
}

interface Props {
  label: string;
  options: SelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  searchPlaceholder?: string;
  emptyText?: string;
  maxHeight?: number;
}

// Long lists get a search field on top, as in the Nornir filter menus.
const SEARCH_FROM = 8;

/** Case- and accent-insensitive, so "equipe" finds "Équipe". */
export function normalizeText(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/**
 * An inline multi-select list, as in the label filter: a bordered inset list of checkable rows
 * (a listbox with aria-multiselectable). One tab stop; the arrow keys, Home and End move between
 * rows, Space and Enter toggle the focused one.
 */
export function SelectList({ label, options, selected, onChange, searchPlaceholder, emptyText, maxHeight = 220 }: Props) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const searchable = options.length >= SEARCH_FROM;
  const text = normalizeText(query.trim());

  const shown = useMemo(
    () =>
      text
        ? options.filter((o) => normalizeText(o.label).includes(text) || (!!o.detail && normalizeText(o.detail).includes(text)))
        : options,
    [options, text],
  );
  const activeIndex = Math.min(active, Math.max(0, shown.length - 1));

  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);

  const focusRow = (index: number) => {
    setActive(index);
    list.current?.querySelectorAll<HTMLElement>('[role="option"]')[index]?.focus();
  };

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = shown.length - 1;
    if (last < 0) return;
    const index = { ArrowDown: Math.min(activeIndex + 1, last), ArrowUp: activeIndex - 1, Home: 0, End: last }[event.key];
    if (index === undefined) return;
    event.preventDefault();
    if (index < 0) search.current?.focus();
    else focusRow(index);
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && shown.length > 0) {
      event.preventDefault();
      focusRow(0);
    } else if (event.key === 'Escape' && query) {
      event.preventDefault();
      event.stopPropagation();
      setQuery('');
    }
  };

  const searchLabel = searchPlaceholder ?? UI.search;
  return (
    <div className="select-list">
      {searchable && (
        <div className="select-list-search">
          <SearchIcon size={13} />
          <input
            ref={search}
            type="search"
            value={query}
            placeholder={searchLabel}
            aria-label={searchLabel}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onSearchKeyDown}
          />
        </div>
      )}
      <div
        ref={list}
        className="select-list-options"
        role="listbox"
        aria-label={label}
        aria-multiselectable="true"
        style={{ maxHeight }}
        onKeyDown={onListKeyDown}
      >
        {shown.length === 0 && (
          <div className="select-list-empty" role="presentation">
            {options.length === 0 ? (emptyText ?? UI.noOptions) : UI.noMatch}
          </div>
        )}
        {shown.map((option, index) => {
          const checked = selected.includes(option.value);
          const style = {
            ...(option.depth && !text ? { '--depth': option.depth } : null),
            ...(option.color ? { '--label-color': option.color } : null),
          } as CSSProperties;
          return (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={checked}
              aria-label={option.detail ? `${option.label}, ${option.detail}` : option.label}
              className="select-list-option"
              tabIndex={index === activeIndex ? 0 : -1}
              style={style}
              onFocus={() => setActive(index)}
              onClick={() => toggle(option.value)}
            >
              <span className="select-list-check" aria-hidden="true">
                <CheckIcon size={11} />
              </span>
              {option.color && <span className="select-list-dot" aria-hidden="true" />}
              <span className="select-list-label">{option.label}</span>
              {option.detail && <span className="select-list-detail">{option.detail}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

import { useEffect, useRef } from 'react';
import type { FocusEvent, KeyboardEvent, ReactNode } from 'react';
import { CheckIcon } from './Icons';

const ITEMS = '[role^="menuitem"]:not(:disabled)';
const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

interface PopoverProps {
  open: boolean;
  /** restoreFocus: give the focus back to the trigger (Escape, Tab), not after a click elsewhere. */
  onClose: (restoreFocus: boolean) => void;
  label: string;
  role?: 'menu' | 'dialog';
  align?: 'start' | 'center' | 'end';
  className?: string;
  children: ReactNode;
}

/**
 * A macOS menu or popover, under its trigger: render both inside a `.menu-anchor`. Opening
 * focuses the checked item (or the first one); the arrow keys move between items; Escape closes,
 * and so does a press outside the anchor. Tab closes a menu; in a dialog popover it moves
 * between its fields, and the popover closes when the focus leaves it.
 */
export function Popover({ open, onClose, label, role = 'menu', align = 'start', className, children }: PopoverProps) {
  const popover = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const element = popover.current;
    if (!open || !element) return;
    const items = element.querySelectorAll<HTMLElement>(ITEMS);
    const first = element.querySelector<HTMLElement>(`${ITEMS}[aria-checked="true"]`) ?? items[0] ?? element.querySelector<HTMLElement>(FOCUSABLE) ?? element;
    first.focus();
    // The trigger lives in the anchor too: pressing it toggles the popover itself.
    const anchor = element.closest('.menu-anchor') ?? element;
    const onPointerDown = (event: PointerEvent) => {
      if (!anchor.contains(event.target as Node)) onCloseRef.current(false);
    };
    // Capture: a canvas that stops the event must still close the menu.
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  if (!open) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      // Not the sheet around it, nor the native dialog close request.
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
      return;
    }
    if (event.key === 'Tab' && role === 'menu') {
      event.preventDefault();
      onClose(true);
      return;
    }
    const target = event.target as HTMLElement;
    // The arrow keys belong to the fields of a dialog popover (a <select>, an <input>).
    if (target !== event.currentTarget && !target.matches(ITEMS)) return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(ITEMS));
    if (items.length === 0) return;
    const index = items.indexOf(target);
    let next: number;
    if (event.key === 'ArrowDown') next = index < 0 ? 0 : (index + 1) % items.length;
    else if (event.key === 'ArrowUp') next = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else return;
    event.preventDefault();
    items[next].focus();
  };

  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (role !== 'dialog') return;
    const anchor = event.currentTarget.closest('.menu-anchor') ?? event.currentTarget;
    const to = event.relatedTarget as Node | null;
    // relatedTarget is null for a press on nothing focusable: the pointerdown listener handles it.
    if (to && !anchor.contains(to)) onClose(false);
  };

  return (
    <div
      ref={popover}
      className={className ? `menu ${className}` : 'menu'}
      role={role}
      aria-label={label}
      data-align={align}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    >
      {children}
    </div>
  );
}

interface MenuItemProps {
  onSelect: () => void;
  /** Shows a check mark when true; a checkable item defaults to menuitemradio. */
  checked?: boolean;
  role?: 'menuitem' | 'menuitemradio' | 'menuitemcheckbox';
  icon?: ReactNode;
  detail?: ReactNode;
  disabled?: boolean;
  children: ReactNode;
}

/** A 28 px menu row: highlighted solid blue under the pointer or the keyboard, like macOS. */
export function MenuItem({ onSelect, checked, role, icon, detail, disabled, children }: MenuItemProps) {
  const itemRole = role ?? (checked === undefined ? 'menuitem' : 'menuitemradio');
  const checkable = itemRole !== 'menuitem';
  return (
    <button
      type="button"
      role={itemRole}
      aria-checked={checkable ? !!checked : undefined}
      className="menu-item"
      disabled={disabled}
      tabIndex={-1}
      onClick={onSelect}
    >
      {icon && <span className="menu-item-icon">{icon}</span>}
      <span className="menu-item-label">{children}</span>
      {detail !== undefined && detail !== null && <span className="menu-item-detail">{detail}</span>}
      {checkable && <CheckIcon size={13} className="check" />}
    </button>
  );
}

export function MenuSeparator() {
  return <div className="menu-separator" role="separator" />;
}

export function MenuHeader({ children }: { children: ReactNode }) {
  return (
    <div className="menu-header" role="presentation">
      {children}
    </div>
  );
}

import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import type { MouseEvent, ReactNode, SyntheticEvent } from 'react';
import { UI } from '../../strings/ui';
import { CloseIcon } from './Icons';

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * A modal sheet on the native <dialog> (focus trap, inert page, top layer for free). `open`
 * drives showModal() / close(); Escape, the close button and a click on the backdrop ask the
 * owner to close through onClose. Its content is only mounted while it is open, so a draft
 * inside starts afresh each time. A bottom sheet on phones (see theme.css).
 */
export function Sheet({ open, onClose, title, subtitle, footer, className, children }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const subtitleId = useId();
  const isOpen = useRef(open);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useLayoutEffect(() => {
    isOpen.current = open;
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      // showModal() focuses the first control, the close button: prefer the content's first
      // one, unless something asked for autofocus.
      if (document.activeElement === element.querySelector('.sheet-close')) {
        element.querySelector<HTMLElement>(`.sheet-body :is(${FOCUSABLE})`)?.focus();
      }
    } else if (!open && element.open) element.close();
  }, [open]);

  // Unmounted while open (the owner went away): leave the top layer.
  useEffect(() => {
    const element = dialog.current;
    return () => {
      isOpen.current = false; // no onClose for this one
      if (element?.open) element.close();
    };
  }, []);

  // Escape: the owner decides, so the dialog never closes behind its back.
  const onCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    onClose();
  };
  // Closed some other way (a form with method="dialog", a browser that ignores preventDefault
  // on repeated Escapes): tell the owner, unless it asked for it.
  // The close event is async: when it lands the dialog may be open again (StrictMode's
  // simulated unmount closes then reopens it), and then nothing closed.
  const onNativeClose = () => {
    if (isOpen.current && !dialog.current?.open) onCloseRef.current();
  };

  // A click on the backdrop targets the dialog itself, like one on its padding: tell them apart
  // by the dialog's box. Both the press and the release must be outside, so a text selection
  // dragged out of the sheet doesn't close it.
  const pressedOutside = useRef(false);
  const outside = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target !== event.currentTarget) return false;
    const box = event.currentTarget.getBoundingClientRect();
    return event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
  };

  return (
    <dialog
      ref={dialog}
      className={className ? `sheet ${className}` : 'sheet'}
      aria-labelledby={titleId}
      aria-describedby={subtitle ? subtitleId : undefined}
      onCancel={onCancel}
      onClose={onNativeClose}
      onMouseDown={(event) => {
        pressedOutside.current = outside(event);
      }}
      onClick={(event) => {
        if (pressedOutside.current && outside(event)) onClose();
        pressedOutside.current = false;
      }}
    >
      <header className="sheet-header">
        <div className="sheet-title">
          <h2 id={titleId}>{title}</h2>
          {subtitle && <p id={subtitleId}>{subtitle}</p>}
        </div>
        <button type="button" className="button icon plain sheet-close" aria-label={UI.close} title={UI.close} onClick={onClose}>
          <CloseIcon size={14} />
        </button>
      </header>
      {open && (
        <>
          <div className="sheet-body">{children}</div>
          {footer && <footer className="sheet-footer">{footer}</footer>}
        </>
      )}
    </dialog>
  );
}

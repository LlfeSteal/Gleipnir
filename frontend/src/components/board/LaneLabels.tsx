import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { LabelMode } from '../../board/types';
import { BOARD } from '../../strings/board';

/** Labels shown in a lane header before « et N autres… », like an issue card's two (§4.2). */
export const MAX_LANE_LABELS = 2;
const MARGIN = 8;
const GAP = 4;

interface LaneLabelsProps {
  labels: string[];
  mode: LabelMode;
  colors: Map<string, string>;
}

/**
 * The label filter of a lane header (§4.1): up to two labels, then « et N autres… ». Hovering,
 * focusing or tapping that button shows a card listing every label with its color. The card is
 * portalled to the body: the header clips its overflow.
 */
export function LaneLabels({ labels, mode, colors }: LaneLabelsProps) {
  const shown = labels.slice(0, MAX_LANE_LABELS);
  const more = labels.length - shown.length;
  const modeText = mode === 'all' ? BOARD.labelModeAll : BOARD.labelModeAny;
  return (
    <div className="lane-meta lane-labels">
      {shown.map((title) => (
        <LabelChip key={title} title={title} color={colors.get(title)} className="lane-label" />
      ))}
      {more > 0 && <MoreLabels more={more} labels={labels} mode={mode} colors={colors} />}
      <span className="lane-label-mode">· {modeText}</span>
    </div>
  );
}

function LabelChip({ title, color, className }: { title: string; color: string | undefined; className: string }) {
  return (
    <span className={className} title={title} style={{ '--label-color': color } as CSSProperties}>
      <span className="label-dot" />
      <span className="lane-label-text">{title}</span>
    </span>
  );
}

function MoreLabels({ more, labels, mode, colors }: { more: number } & LaneLabelsProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const id = useId();

  // Below the button, above it when the viewport has no room left, always inside the viewport.
  useLayoutEffect(() => {
    if (!open || !button.current || !card.current) return;
    const anchor = button.current.getBoundingClientRect();
    const { width, height } = card.current.getBoundingClientRect();
    const below = anchor.bottom + GAP;
    const top = below + height + MARGIN > window.innerHeight ? Math.max(MARGIN, anchor.top - GAP - height) : below;
    const left = Math.max(MARGIN, Math.min(anchor.left, window.innerWidth - MARGIN - width));
    setPosition({ top, left });
  }, [open]);

  // The card is fixed: scrolling or resizing would leave it behind its button.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const show = () => setOpen(true);
  const hide = () => {
    setOpen(false);
    setPosition(null);
  };
  // With the focus on the button, Escape only closes the card, not the inspector around.
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape' && open) {
      event.stopPropagation();
      hide();
    }
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        className="lane-label-more"
        aria-describedby={open ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        // A click only opens: the mouse already opened it on hover, a tap on focus. A press
        // elsewhere (blur) or Escape closes it.
        onClick={show}
        onKeyDown={onKeyDown}
      >
        {BOARD.moreLaneLabels(more)}
      </button>
      {open &&
        createPortal(
          <div
            ref={card}
            id={id}
            role="tooltip"
            className="lane-hovercard"
            style={position ? { top: position.top, left: position.left } : { visibility: 'hidden' }}
          >
            <p className="lane-hovercard-title">{BOARD.laneLabelsTitle}</p>
            <ul className="lane-hovercard-list">
              {labels.map((title) => (
                <li key={title}>
                  <LabelChip title={title} color={colors.get(title)} className="lane-hovercard-label" />
                </li>
              ))}
            </ul>
            <p className="lane-hovercard-mode">{mode === 'all' ? BOARD.labelModeAllLong : BOARD.labelModeAnyLong}</p>
          </div>,
          document.body,
        )}
    </>
  );
}

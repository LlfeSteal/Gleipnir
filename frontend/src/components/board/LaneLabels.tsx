import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { MAX_LANE_LABELS } from '../../board/lanes';
import type { LabelMode } from '../../board/types';
import { BOARD } from '../../strings/board';

const MARGIN = 8;
const GAP = 4;

interface LaneLabelsProps {
  labels: string[];
  mode: LabelMode;
  colors: Map<string, string>;
}

/**
 * The label filter of a lane header (§4.1): a « Labels · au moins un » line, then one label per
 * line with its color, two at most; the second ends with « et N autres… », N counting the hidden
 * labels only. Hovering, focusing or tapping it shows a card listing those hidden labels. The
 * card is portalled to the body: the header clips its overflow. The lane's height leaves room
 * for these lines (laneHeaderHeight in board/view.ts).
 */
export function LaneLabels({ labels, mode, colors }: LaneLabelsProps) {
  const shown = labels.slice(0, MAX_LANE_LABELS);
  const hidden = labels.slice(MAX_LANE_LABELS);
  return (
    <div className="lane-meta lane-labels">
      <span className="lane-labels-heading">
        {BOARD.laneLabelsHeading} · {mode === 'all' ? BOARD.labelModeAll : BOARD.labelModeAny}
      </span>
      {shown.map((title, index) => (
        <span key={title} className="lane-label-row">
          <LabelChip title={title} color={colors.get(title)} className="lane-label" />
          {index === shown.length - 1 && hidden.length > 0 && <MoreLabels hidden={hidden} colors={colors} />}
        </span>
      ))}
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

function MoreLabels({ hidden, colors }: { hidden: string[]; colors: Map<string, string> }) {
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
        {BOARD.moreLaneLabels(hidden.length)}
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
              {hidden.map((title) => (
                <li key={title}>
                  <LabelChip title={title} color={colors.get(title)} className="lane-hovercard-label" />
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        )}
    </>
  );
}

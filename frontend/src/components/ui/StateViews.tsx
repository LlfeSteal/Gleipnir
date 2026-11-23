import type { CSSProperties, ReactNode } from 'react';
import { UI } from '../../strings/ui';
import { LanesIcon, WarningIcon } from './Icons';

// Placeholder bars of the skeleton, per lane: [first column, columns spanned, row]. Fixed, so the
// shimmer doesn't jump between renders.
const LANES: [number, number, number][][] = [
  [[1, 3, 1], [2, 2, 2], [4, 1, 3]],
  [[2, 2, 1], [1, 1, 2], [3, 3, 2]],
  [[1, 4, 1], [3, 1, 2]],
];
const COLUMNS = 5;

/** The board's shape while it loads for the first time: column headers, then lanes with their
 * rail and a few bars, shimmering. */
export function Skeleton() {
  return (
    <div className="skeleton" role="status" aria-busy="true" aria-label={UI.loading} style={{ '--columns': COLUMNS } as CSSProperties}>
      <div className="skeleton-row skeleton-header">
        <div className="skeleton-rail">
          <span className="skeleton-bar" style={{ width: '50%' }} />
        </div>
        {Array.from({ length: COLUMNS }, (_, i) => (
          <div key={i} className="skeleton-cell">
            <span className="skeleton-bar" style={{ width: `${40 + ((i * 17) % 30)}%` }} />
          </div>
        ))}
      </div>
      {LANES.map((bars, lane) => (
        <div key={lane} className="skeleton-row skeleton-lane">
          <div className="skeleton-rail">
            <span className="skeleton-bar" style={{ width: `${55 + lane * 10}%` }} />
            <span className="skeleton-bar small" style={{ width: `${35 + lane * 8}%` }} />
          </div>
          {bars.map(([column, span, row], i) => (
            <span
              key={i}
              className="skeleton-bar block"
              style={{ gridColumn: `${column + 1} / span ${span}`, gridRow: row }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

interface ErrorBannerProps {
  title: string;
  message: string;
  onRetry?: () => void;
}

export function ErrorBanner({ title, message, onRetry }: ErrorBannerProps) {
  return (
    <div className="banner" role="alert">
      <WarningIcon size={20} />
      <div className="banner-text">
        <strong>{title}</strong>
        <span>{message}</span>
      </div>
      {onRetry && (
        <button type="button" className="button" onClick={onRetry}>
          {UI.retry}
        </button>
      )}
    </div>
  );
}

interface EmptyStateProps {
  title: string;
  message?: string;
  action?: ReactNode;
  /** 40 px, tertiary; the lanes glyph by default. */
  icon?: ReactNode;
  className?: string;
}

export function EmptyState({ title, message, action, icon, className }: EmptyStateProps) {
  return (
    <div className={className ? `empty-state ${className}` : 'empty-state'}>
      <span className="empty-state-icon">{icon ?? <LanesIcon size={40} />}</span>
      <strong>{title}</strong>
      {message && <p>{message}</p>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}

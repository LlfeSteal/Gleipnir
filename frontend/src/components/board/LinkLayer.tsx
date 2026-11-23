import { memo, useMemo } from 'react';
import type { LinkPath } from '../../board/types';

/** Every link of the board in one SVG, under the items and above the columns. States are data
 * attributes (type, conflict, critical, connected to the selection); board.css styles them. */
export const LinkLayer = memo(function LinkLayer({
  links,
  width,
  height,
  selectedId,
}: {
  links: LinkPath[];
  width: number;
  height: number;
  selectedId: string | null;
}) {
  // The critical path is drawn last, on top of the rest.
  const ordered = useMemo(() => [...links.filter((l) => !l.critical), ...links.filter((l) => l.critical)], [links]);
  return (
    <svg className="link-layer" width={width} height={height} aria-hidden="true" focusable="false">
      {ordered.map((l) => (
        <g
          key={l.key}
          className="link"
          data-type={l.type}
          data-conflict={l.conflict || undefined}
          data-critical={l.critical || undefined}
          data-connected={(selectedId !== null && (l.source === selectedId || l.target === selectedId)) || undefined}
        >
          <path className="link-curve" d={l.d} />
          {l.arrow && <path className="link-arrow" d={l.arrow} />}
        </g>
      ))}
    </svg>
  );
});

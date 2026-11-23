import type { LinkType } from '../../api/types';

/** A short sample of a link type's line (sidebar, legend), drawn with the canvas' link styles:
 * solid with an arrow for "blocks", dotted for "relates", dashed for "parent". */
export function LinkSwatch({ type }: { type: LinkType }) {
  return (
    <svg className="link-swatch" width="28" height="10" viewBox="0 0 28 10" aria-hidden="true" focusable="false">
      <g className="link" data-type={type}>
        <path className="link-curve" d={type === 'blocks' ? 'M1 5 L21 5' : 'M1 5 L27 5'} />
        {type === 'blocks' && <path className="link-arrow" d="M27 5 L21 1.5 L21 8.5 Z" />}
      </g>
    </svg>
  );
}

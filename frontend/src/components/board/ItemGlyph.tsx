import type { ItemKind } from '../../board/types';
import { EpicIcon, IssueClosedIcon, IssueOpenIcon } from '../ui/Icons';

/** The miniature shape of an item type (spec §4.2): a purple bar with the layers icon for an
 * epic, a small card with the state icon for an issue. Same shape in the legend, the lane
 * settings, the inspector and the lane rail. Decorative: the text next to it names the type. */
export function ItemGlyph({ kind, closed = false, size = 'regular' }: { kind: ItemKind; closed?: boolean; size?: 'small' | 'regular' }) {
  const icon = size === 'small' ? 8 : 10;
  return (
    <span className="item-glyph" data-kind={kind} data-closed={closed || undefined} data-size={size} aria-hidden="true">
      {kind === 'epic' ? <EpicIcon size={icon} /> : closed ? <IssueClosedIcon size={icon} /> : <IssueOpenIcon size={icon} />}
    </span>
  );
}

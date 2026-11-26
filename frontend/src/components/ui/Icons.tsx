import type { ReactNode } from 'react';

// Inline SVG icons in the spirit of SF Symbols: 24 × 24 view box, 1.8 px strokes, round caps and
// joins, currentColor, decorative (aria-hidden). The name of an icon button is its aria-label.

export type IconProps = { size?: number; className?: string };

function Icon({ size = 16, className, strokeWidth = 1.8, children }: IconProps & { strokeWidth?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const ChevronRightIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M9 6l6 6-6 6" />
  </Icon>
);

export const ChevronLeftIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M15 6l-6 6 6 6" />
  </Icon>
);

export const ChevronDownIcon = (props: IconProps) => (
  <Icon {...props} strokeWidth={2}>
    <path d="M7 10l5 5 5-5" />
  </Icon>
);

export const ChevronUpIcon = (props: IconProps) => (
  <Icon {...props} strokeWidth={2}>
    <path d="M7 14l5-5 5 5" />
  </Icon>
);

/** Arc with an arrowhead, like SF Symbols' arrow.clockwise: synchronize. */
export const RefreshIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M20 11a8 8 0 1 0-2.3 5.7" />
    <path d="M20 4v7h-7" />
  </Icon>
);

export const SearchIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="M15.5 15.5L20 20" />
  </Icon>
);

/** Filled circle with a cross, like SF Symbols' xmark.circle.fill (clears a field). */
export const ClearIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="9" fill="currentColor" stroke="none" />
    <path d="M9 9l6 6M15 9l-6 6" stroke="var(--card)" strokeWidth={2} />
  </Icon>
);

export const CheckIcon = (props: IconProps) => (
  <Icon {...props} strokeWidth={2.2}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icon>
);

/** Like SF Symbols' xmark: closes a sheet or a panel. */
export const CloseIcon = (props: IconProps) => (
  <Icon {...props} strokeWidth={2}>
    <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
  </Icon>
);

/** Like SF Symbols' pencil: edits. */
export const PencilIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M15.5 5.5l3 3L8 19l-4 1 1-4z" />
    <path d="M13.5 7.5l3 3" />
  </Icon>
);

/** Like SF Symbols' trash: deletes. */
export const TrashIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4.5 6.5h15M9.5 6.5V4.5h5v2" />
    <path d="M6.5 6.5l1 13h9l1-13" />
    <path d="M10.5 10v6.5M13.5 10v6.5" />
  </Icon>
);

export const PlusIcon = (props: IconProps) => (
  <Icon {...props} strokeWidth={2}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

/** Rounded window with a left column, like SF Symbols' sidebar.left: shows or hides the sidebar. */
export const SidebarIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="4.5" width="18" height="15" rx="3" />
    <path d="M9.5 4.5v15" />
    <path d="M5.5 8.5h1.5M5.5 11.5h1.5" />
  </Icon>
);

/** Three stacked lanes: the lanes of the board. */
export const LanesIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="3.5" width="18" height="4.5" rx="1.5" />
    <rect x="3" y="9.75" width="18" height="4.5" rx="1.5" />
    <rect x="3" y="16" width="18" height="4.5" rx="1.5" />
  </Icon>
);

/** Like SF Symbols' line.3.horizontal.decrease: filters. */
export const FilterIcon = (props: IconProps) => (
  <Icon {...props} strokeWidth={2}>
    <path d="M4 7h16M7 12h10M10 17h4" />
  </Icon>
);

/** Two stacked layers (a rhombus over a chevron), like the mockup's: an epic. */
export const EpicIcon = (props: IconProps) => (
  <Icon {...props} strokeWidth={2}>
    <path d="M12 3.5l8.5 4.75L12 13 3.5 8.25z" />
    <path d="M3.5 13l8.5 4.75L20.5 13" />
  </Icon>
);

/** Circle with a center dot, like GitLab's open issue: an open issue. */
export const IssueOpenIcon = (props: IconProps) => (
  <Icon {...props} strokeWidth={2}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" />
  </Icon>
);

/** Circle with a check, like SF Symbols' checkmark.circle: a closed issue. */
export const IssueClosedIcon = (props: IconProps) => (
  <Icon {...props} strokeWidth={2}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M8.5 12.3l2.4 2.4 4.6-5" />
  </Icon>
);

/** Circle with a slash, like SF Symbols' nosign: blocks. Stroked, so it never reads as a filled
 * warning glyph. */
export const BlockIcon = (props: IconProps) => (
  <Icon {...props} strokeWidth={2.2}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M6 6l12 12" />
  </Icon>
);

/** Two chain links, like SF Symbols' link. */
export const LinkIcon = (props: IconProps) => (
  <Icon {...props} strokeWidth={2}>
    <path d="M10 13.5a4.5 4.5 0 0 0 6.4.4l2.8-2.8a4.5 4.5 0 0 0-6.4-6.4l-1.4 1.4" />
    <path d="M14 10.5a4.5 4.5 0 0 0-6.4-.4l-2.8 2.8a4.5 4.5 0 0 0 6.4 6.4l1.4-1.4" />
  </Icon>
);

/** Like SF Symbols' arrow.up.forward: opens in GitLab (another tab). */
export const ExternalIcon = (props: IconProps) => (
  <Icon {...props} strokeWidth={2}>
    <path d="M7 17L17 7" />
    <path d="M8.5 7H17v8.5" />
  </Icon>
);

/** A door with an arrow leaving it, like SF Symbols' rectangle.portrait.and.arrow.right: a
 * dependency outside every active lane. */
export const ExitIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M14 4H6.5A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20H14" />
    <path d="M10 12h10M17 9l3 3-3 3" />
  </Icon>
);

export const WarningIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 3.5L2.5 20h19L12 3.5z" />
    <path d="M12 10v4.5M12 17.2v.3" />
  </Icon>
);

/** Circled letter i, like SF Symbols' info.circle. */
export const InfoIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5" />
    <circle cx="12" cy="7.6" r="1.1" fill="currentColor" stroke="none" />
  </Icon>
);

export const SunIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" />
  </Icon>
);

export const MoonIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
  </Icon>
);

/** Half-filled circle, like SF Symbols' circle.lefthalf.filled: the Automatic appearance. */
export const AutoAppearanceIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 3.5a8.5 8.5 0 0 0 0 17z" fill="currentColor" stroke="none" />
  </Icon>
);

/** Like SF Symbols' calendar: iterations. */
export const CalendarIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </Icon>
);

/** The app glyph, white on the 32 px gradient tile: two items chained by a dependency, the
 * fetter that gives Gleipnir its name. Bolder strokes, since it is the brand mark. */
export const AppGlyph = (props: IconProps) => (
  <Icon size={18} {...props} strokeWidth={2.2}>
    <rect x="2.5" y="4" width="9" height="5" rx="1.75" />
    <rect x="12.5" y="15" width="9" height="5" rx="1.75" />
    <path d="M11.5 6.5h1.25a2 2 0 0 1 2 2V13" />
    <path d="M12.5 11l2.25 2.5L17 11" />
  </Icon>
);

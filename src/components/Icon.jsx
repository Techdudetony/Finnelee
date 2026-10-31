// Finnelee's icon set: 24×24 grid, 1.75px rounded strokes in currentColor,
// so an icon always takes the color of the text around it.

import { Children, Fragment, cloneElement, isValidElement } from "react";

const ICONS = {
  // Navigation
  dashboard: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="M8 16v-3M12 16V8M16 16v-5" />
    </>
  ),
  networth: (
    <path d="M3.5 9.5 12 4.5l8.5 5M5.5 10.5v7M10 10.5v7M14 10.5v7M18.5 10.5v7M3.5 20h17" />
  ),
  transactions: (
    <>
      <path d="M6 3.5h12v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z" />
      <path d="M9 8h6M9 11.5h6M9 15h3" />
    </>
  ),
  // A 50/30/20 split
  budget: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 12V3.5M12 12v8.5M12 12 3.9 9.4" />
    </>
  ),
  debt: (
    <>
      <rect x="2.5" y="5.5" width="19" height="13" rx="2.5" />
      <path d="M2.5 10h19M6 14.5h4" />
    </>
  ),
  // Solid history, dashed projection
  forecast: (
    <>
      <path d="M3.5 20.5h17" />
      <path d="M3.5 16 8 11.5l3.5 3 3.5-4" />
      <path d="m15 10.5 5.5-5.5" strokeDasharray="1.5 2.5" />
    </>
  ),
  goals: <path d="M5.5 21V3.5M5.5 4h12l-2.5 4.25L17.5 12.5h-12" />,
  bills: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
      <circle cx="12" cy="15.25" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
  categories: (
    <>
      <path d="M3.5 4.5a1 1 0 0 1 1-1h7.2a2 2 0 0 1 1.4.6l7.4 7.4a2 2 0 0 1 0 2.8l-6.6 6.6a2 2 0 0 1-2.8 0l-7.4-7.4a2 2 0 0 1-.6-1.4z" />
      <circle cx="8.25" cy="8.25" r="1.5" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h9M17.5 7H20M4 17h3M11.5 17H20" />
      <circle cx="15.25" cy="7" r="2.25" />
      <circle cx="9.25" cy="17" r="2.25" />
    </>
  ),

  // Status (paired with text, never shown alone)
  check: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.25 12.25 2.5 2.5 5-5.25" />
    </>
  ),
  warning: (
    <>
      <path d="M10.3 4.5a2 2 0 0 1 3.4 0l7 12a2 2 0 0 1-1.7 3H5a2 2 0 0 1-1.7-3z" />
      <path d="M12 9.5v4M12 16.5h.01" />
    </>
  ),
  critical: (
    <>
      <path d="M8.3 3.5h7.4l4.8 4.8v7.4l-4.8 4.8H8.3l-4.8-4.8V8.3z" />
      <path d="M12 8v4.5M12 15.75h.01" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5.5" width="16" height="14.5" rx="2.5" />
      <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
    </>
  ),

  // Actions and small marks
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  edit: (
    <path d="M4.5 19.5h4l10.3-10.3a2.1 2.1 0 0 0-3-3L5.5 16.5v3M14.5 7.5l3 3" />
  ),
  upload: (
    <path d="M12 15.5V4.5M7.5 9 12 4.5 16.5 9M4.5 15v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" />
  ),
  up: <path d="m7 14 5-5 5 5" />,
  forward: <path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5" />,
  down: <path d="m7 10 5 5 5-5" />,
  summary: (
    <>
      <rect x="5" y="4.5" width="14" height="16.5" rx="2.5" />
      <path d="M9.5 3h5v3h-5zM8.5 11h7M8.5 14.5h7M8.5 18h4" />
    </>
  ),
  "trend-up": <path d="M3.5 17 9 11.5l4 4L20.5 8M15 8h5.5v5.5" />,
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.8h.01" />
    </>
  ),
  idea: (
    <>
      <path d="M12 3.5a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.1v.6h5v-.6c0-.8.4-1.6 1.1-2.1A6 6 0 0 0 12 3.5z" />
      <path d="M9.5 20.5h5" />
    </>
  ),
  celebrate: (
    <>
      <path d="M12 3.5 13.7 8.3 18.5 10l-4.8 1.7L12 16.5l-1.7-4.8L5.5 10l4.8-1.7z" />
      <path d="M18.5 15.5v4M16.5 17.5h4" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </>
  ),
  moon: <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z" />,
  // Debt strategies: balls growing (snowball), a peak to come down from (avalanche)
  snowball: (
    <>
      <circle cx="5" cy="17.5" r="1.75" />
      <circle cx="10.5" cy="15.75" r="3.5" />
      <circle cx="17.5" cy="13" r="5" />
    </>
  ),
  avalanche: (
    <>
      <path d="m2.5 19.5 7-12.5 4 6.5 2-3 6 9z" />
      <path d="m7.4 10.75 2.1 1.25 1.9-1.1" />
    </>
  ),
};

export const ICON_NAMES = Object.keys(ICONS);

// pathLength={1} on every shape lets CSS redraw a stroke with dasharray/dashoffset of 1
// (the nav icons do this at Full motion), whatever the shape's real length. Shapes that
// are dashed on purpose are skipped: pathLength would rescale their dashes.
const measured = (node) => {
  if (!isValidElement(node)) return node;
  if (node.type === Fragment)
    return Children.map(node.props.children, measured);
  return node.props.strokeDasharray
    ? node
    : cloneElement(node, { pathLength: 1 });
};

/**
 * <Icon name="bills" />. Decorative by default (hidden from screen readers);
 * pass `label` when the icon is the only thing that explains a control.
 */
export default function Icon({ name, size = 18, label, className = "" }) {
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {measured(ICONS[name])}
    </svg>
  );
}

/** The Finnelee mark: an F whose top stroke ends in a forward arrow, on an accent tile. */
export function BrandMark({ size = 24 }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="24" height="24" rx="6" fill="var(--accent)" />
      <path
        d="M9 18V6.5h6.5M9 12.25h4.5M14 4.5l2 2-2 2"
        fill="none"
        stroke="var(--accent-text)"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

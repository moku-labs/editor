/**
 * @file renderView components — Mission control's stroke icons (spec 09 § M15 "Text is text, art:
 * none"): inline SVG on a 16 px grid, 1.6 stroke at 16, 12 and 14 px, and the source icon at 22 with
 * a 1.5 stroke. Decorative: every icon is `aria-hidden`; the control around it carries the words.
 */
import type { VNode } from "preact";

/**
 * The icons Mission control draws.
 */
export type MissionIconName =
  | "phone"
  | "laptop"
  | "wire"
  | "wifi"
  | "pause"
  | "play"
  | "gauge"
  | "chevron"
  | "close"
  | "open"
  | "unplug"
  | "brush"
  | "left"
  | "right"
  | "skip-left"
  | "skip-right"
  | "live"
  | "copy";

/**
 * Path data of every icon on a 16 × 16 grid (drawn for this view).
 */
const PATHS: Readonly<Record<MissionIconName, string>> = {
  phone: "M5 1.75h6a1 1 0 0 1 1 1v10.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V2.75a1 1 0 0 1 1-1zM7 12.25h2",
  laptop: "M3 3.25h10v7H3zM1.5 12.75h13",
  wire: "M6.25 1.75v2.5M9.75 1.75v2.5M4.75 4.25h6.5v2.5a3.25 3.25 0 0 1-6.5 0zM8 10v4.25",
  wifi: "M2.25 6.25a8.25 8.25 0 0 1 11.5 0M4.5 8.75a5 5 0 0 1 7 0M6.75 11.25a1.75 1.75 0 0 1 2.5 0",
  pause: "M5.75 3.75v8.5M10.25 3.75v8.5",
  play: "M5.25 3.5v9l7-4.5z",
  gauge: "M2.75 11.25a5.25 5.25 0 1 1 10.5 0M8 11.25l2.5-3.25",
  chevron: "M4.25 6.25 8 10l3.75-3.75",
  close: "M4.25 4.25l7.5 7.5M11.75 4.25l-7.5 7.5",
  open: "M9.25 2.75h4v4M13.25 2.75 7.75 8.25M11.75 9.5v3.75h-9v-9h3.75",
  unplug:
    "M2.25 2.25l11.5 11.5M6.25 1.75v2.5M4.75 4.25h3M11 6.75a3.25 3.25 0 0 1-.9 2.25M8 10.5v3.75",
  brush: "M2.75 4v8M13.25 4v8M5.25 5.5h5.5v5h-5.5z",
  left: "M9.75 3.75 5.5 8l4.25 4.25",
  right: "M6.25 3.75 10.5 8l-4.25 4.25",
  "skip-left": "M11.25 3.75 7 8l4.25 4.25M4.75 3.75v8.5",
  "skip-right": "M4.75 3.75 9 8l-4.25 4.25M11.25 3.75v8.5",
  live: "M4 3.75 8.25 8 4 12.25M8.75 3.75 13 8l-4.25 4.25",
  copy: "M5.75 5.75h7v7h-7zM3.25 10.25v-7h7"
};

/**
 * Props of `MissionIcon`.
 */
export type MissionIconProps = {
  readonly name: MissionIconName;
  /** 16 by default; 12 and 14 for small controls, 22 for the source tile. */
  readonly size?: 12 | 14 | 16 | 22;
};

/**
 * One icon: 1.6 stroke, 1.5 at the source tile's 22 px.
 *
 * @param props - The icon's name and size.
 * @returns The SVG.
 * @example
 * ```tsx
 * <MissionIcon name="phone" size={22} />
 * ```
 */
export function MissionIcon(props: MissionIconProps): VNode {
  const size = props.size ?? 16;
  return (
    <svg
      data-icon={props.name}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width={size === 22 ? 1.5 : 1.6}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[props.name]} />
    </svg>
  );
}

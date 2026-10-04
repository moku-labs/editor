/**
 * @file Shared view module — the 16 px stroke icons of the workspace shell and the views (no icon
 * font, no CDN). Decorative: every icon is `aria-hidden`; the control around it carries the label.
 */
import type { VNode } from "preact";

/**
 * The icon names.
 */
export type IconName =
  | "flow"
  | "game"
  | "render"
  | "state"
  | "files"
  | "console"
  | "pause"
  | "play"
  | "step"
  | "search"
  | "theme"
  | "close"
  | "logo"
  | "registry"
  | "commands"
  | "open"
  | "hide"
  | "copy"
  | "follow"
  | "reset"
  | "zoom-in"
  | "zoom-out"
  | "fit-all"
  | "fit-selection"
  | "history"
  | "code"
  | "styles"
  | "target"
  | "flame"
  | "more";

/**
 * Props of `Icon`.
 */
export type IconProps = { readonly name: IconName; readonly size?: number };

/**
 * Path data of every icon on a 16×16 grid.
 */
const PATHS: Readonly<Record<IconName, string>> = {
  flow: "M3 3h4v4H3zM9 9h4v4H9zM5 7v4h4",
  game: "M5 1.5h6a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1zM7 12.5h2",
  render: "M2.5 13.5h11M4.5 11V8M8 11V4M11.5 11V6.5",
  state:
    "M5.5 2.5C4 2.5 4 4 4 5s-1 2.5-1.5 3C3 8.5 4 9.5 4 11s0 2.5 1.5 2.5M10.5 2.5C12 2.5 12 4 12 5s1 2.5 1.5 3C13 8.5 12 9.5 12 11s0 2.5-1.5 2.5",
  files: "M3 2.5h6l4 4v7H3zM9 2.5v4h4",
  console: "M2.5 3.5h11v9h-11zM5 6.5 7 8l-2 1.5M8.5 10H11",
  pause: "M5.5 3.5v9M10.5 3.5v9",
  play: "M5 3.5v9l7-4.5z",
  step: "M4 3.5v9l6-4.5zM12 3.5v9",
  search: "M7 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM10 10l3.5 3.5",
  theme: "M13 9.5A5.5 5.5 0 1 1 6.5 3a4.5 4.5 0 0 0 6.5 6.5z",
  close: "M4 4l8 8M12 4l-8 8",
  logo: "M3 12.5v-9l5 5 5-5v9",
  registry: "M3 3h4v4H3zM9 3h4v4H9zM3 9h4v4H3zM9 9h4v4H9z",
  commands:
    "M6 4.5a1.5 1.5 0 1 0-1.5 1.5H11.5A1.5 1.5 0 1 0 10 4.5v7a1.5 1.5 0 1 0 1.5-1.5h-7A1.5 1.5 0 1 0 6 11.5z",
  open: "M9 3h4v4M13 3 7.5 8.5M11.5 9.5v3.5h-8.5v-8.5h3.5",
  hide: "M2.5 8s2-3.5 5.5-3.5S13.5 8 13.5 8 11.5 11.5 8 11.5 2.5 8 2.5 8zM3 13 13 3",
  copy: "M5.5 5.5h7v7h-7zM3.5 10.5v-7h7",
  follow: "M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM8 1.5v2.5M8 12v2.5M1.5 8H4M12 8h2.5",
  reset: "M3.5 8a4.5 4.5 0 1 0 1.5-3.4M3 2.5v2.5h2.5",
  "zoom-in": "M3.5 8h9M8 3.5v9",
  "zoom-out": "M3.5 8h9",
  "fit-all": "M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10",
  "fit-selection": "M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10M6.5 6.5h3v3h-3z",
  code: "M6 4.5 2.5 8 6 11.5M10 4.5 13.5 8 10 11.5",
  styles: "M3 13l1-3.5L10.5 3 13 5.5 6.5 12zM9 4.5l2.5 2.5",
  history: "M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 5v3.2l2 1.3",
  target:
    "M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM8 1v2M8 13v2M1 8h2M13 8h2",
  flame:
    "M8 1.5c.4 2.3 3.5 3.9 3.5 7.5a3.5 3.5 0 0 1-7 0c0-1.6.7-2.7 1.6-3.6.1 1.3.7 2.1 1.6 2.4C7.2 6 7.1 3.6 8 1.5z",
  more: "M3 7.25a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zM8 7.25a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zM13 7.25a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5z"
};

/**
 * One icon.
 *
 * @param props - The icon name and size.
 * @returns The SVG.
 * @example
 * ```tsx
 * <Icon name="pause" />
 * ```
 */
export function Icon(props: IconProps): VNode {
  const size = props.size ?? 16;
  return (
    <svg
      data-icon={props.name}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[props.name]} />
    </svg>
  );
}

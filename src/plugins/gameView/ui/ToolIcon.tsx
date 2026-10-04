/**
 * @file gameView plugin — the 16 px stroke icons of the device toolbar's Shot and Series buttons
 * (round 2b R17), drawn like the workspace's own icons. Below a 1000 px workspace the buttons
 * show only these (toolbar.css); the button's title and aria-label carry the name. Decorative:
 * every icon is `aria-hidden`.
 */
import type { VNode } from "preact";

/**
 * The icon names: the camera of Shot, the stacked frames of Series.
 */
export type ToolIconName = "camera" | "series";

/**
 * Path data of each icon on a 16×16 grid.
 */
const PATHS: Readonly<Record<ToolIconName, string>> = {
  camera:
    "M2.5 5.5h2.5l1.2-2h3.6l1.2 2h2.5v7.5h-11zM8 7a2.25 2.25 0 1 0 0 4.5A2.25 2.25 0 0 0 8 7z",
  series: "M5.5 2.5h8v7h-8zM3.5 4.5v7h8M1.5 6.5v7h8"
};

/**
 * One toolbar icon.
 *
 * @param props - The icon name.
 * @param props.name - Which icon.
 * @returns The SVG.
 * @example
 * ```tsx
 * <ToolIcon name="camera" />
 * ```
 */
export function ToolIcon(props: { readonly name: ToolIconName }): VNode {
  return (
    <svg
      data-part="tool-icon"
      data-icon={props.name}
      width={16}
      height={16}
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

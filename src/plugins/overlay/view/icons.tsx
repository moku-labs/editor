/**
 * @file overlay plugin — the inline vector icons (redrawn as small Preact SVG components): grip,
 * collapse toward each edge, hide, back, previous, next, chevron and the spike glyph. Decorative:
 * every key that holds one has its own accessible name.
 */
import type { VNode } from "preact";
import type { Dock } from "../types";

/**
 * The six-dot grip, 10 × 16.
 *
 * @returns The icon.
 */
export function GripIcon(): VNode {
  return (
    <svg viewBox="0 0 10 16" fill="currentColor" aria-hidden="true">
      <circle cx="2.5" cy="3" r="1.5" />
      <circle cx="7.5" cy="3" r="1.5" />
      <circle cx="2.5" cy="8" r="1.5" />
      <circle cx="7.5" cy="8" r="1.5" />
      <circle cx="2.5" cy="13" r="1.5" />
      <circle cx="7.5" cy="13" r="1.5" />
    </svg>
  );
}

/**
 * Collapse: an arrow toward the docked edge and the edge itself.
 *
 * @param props - The dock.
 * @param props.dock - The edge the window docks to.
 * @returns The icon.
 */
export function CollapseIcon(props: { readonly dock: Dock }): VNode {
  const path =
    props.dock === "left"
      ? "M16 10H6.5M10 6.5 6.5 10 10 13.5M3.5 3.5v13"
      : "M4 10h9.5M10 6.5l3.5 3.5-3.5 3.5M16.5 3.5v13";
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

/**
 * Hide: an eye struck through.
 *
 * @returns The icon.
 */
export function HideIcon(): VNode {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <path d="M2.5 10s2.8-5.5 7.5-5.5 7.5 5.5 7.5 5.5-2.8 5.5-7.5 5.5S2.5 10 2.5 10z" />
      <circle cx="10" cy="10" r="2.4" />
      <path d="M4 16.5 16.5 4" />
    </svg>
  );
}

/**
 * Back: a return arrow.
 *
 * @returns The icon.
 */
export function BackIcon(): VNode {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      stroke-width="1.9"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M7.5 4.5 3.5 8.5l4 4" />
      <path d="M3.5 8.5h8.5a4.5 4.5 0 0 1 0 9H9" />
    </svg>
  );
}

/**
 * Previous: a chevron to the left.
 *
 * @returns The icon.
 */
export function PreviousIcon(): VNode {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M12.5 4.5 7 10l5.5 5.5" />
    </svg>
  );
}

/**
 * Next: a chevron to the right.
 *
 * @returns The icon.
 */
export function NextIcon(): VNode {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M7.5 4.5 13 10l-5.5 5.5" />
    </svg>
  );
}

/**
 * The disclosure chevron (turned 180° by the sheet when open).
 *
 * @returns The icon.
 */
export function ChevronIcon(): VNode {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M5.5 8 10 12.5 14.5 8" />
    </svg>
  );
}

/**
 * The spike glyph of the spikes legend, 9 × 9.
 *
 * @returns The icon.
 */
export function SpikeGlyph(): VNode {
  return (
    <svg
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      aria-hidden="true"
    >
      <path d="M0 9h3l2-8 2 8h3" />
    </svg>
  );
}

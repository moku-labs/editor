/**
 * @file renderView device strip — the strip's DOM colours that come from the graph's palettes
 * (spec 09 Delta 2026-10-15): a cause key, a stack swatch or the budget bug is drawn in the colour
 * the graph paints the same thing in, as a CSS `light-dark()` of the light and the dark palette. The
 * editor's theme switch sets `color-scheme`, so these follow it with no re-render, like the
 * editor's tokens. Pure.
 */
import type { PerfCause } from "../../perf/protocol";
import type { GraphPalette } from "./contract";
import { causeHue, GRAPH_PALETTES } from "./contract";

/**
 * A cause's hue in both editor themes: the light theme's darker hue, the dark theme's own.
 *
 * @param cause - The cause.
 * @returns The CSS colour.
 * @example
 * ```ts
 * themedHue("js"); // "light-dark(#a16207, #F4E04D)"
 * ```
 */
export function themedHue(cause: PerfCause): string {
  return `light-dark(${causeHue("light", cause)}, ${causeHue("dark", cause)})`;
}

/**
 * A painter colour in both editor themes.
 *
 * @param key - The palette entry: "js", "gpu", "idle", "magenta", …
 * @returns The CSS colour.
 * @example
 * ```ts
 * themedColour("js"); // "light-dark(#7c7ce4, #a5a5f0)"
 * ```
 */
export function themedColour(key: keyof GraphPalette): string {
  return `light-dark(${GRAPH_PALETTES.light[key]}, ${GRAPH_PALETTES.dark[key]})`;
}

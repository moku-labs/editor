/**
 * @file perf/graph — the tools page's looks of the frame graph (spec 09 Delta 2026-10-15): the
 * editor's light and dark themes beside the overlay's glass cockpit. Only the tools page imports
 * this file (renderView's `device/contract`, never the barrel), so none of it enters the agent
 * bundle; the painter itself knows only the cockpit look and paints any `GraphLook` it is given.
 * Data and two pure lookups.
 */
import type { PerfCause } from "../protocol";
import { CAUSE_RANK } from "../protocol";
import type { GraphPalette } from "./palette";
import { CAUSE_STYLE, GRAPH_COLOURS, GRAPH_FONTS } from "./palette";
import type { GraphLook } from "./types";

/**
 * The look a graph is painted in: the phone overlay's glass cockpit, or the tools page's editor
 * theme, light or dark.
 *
 * @example
 * ```ts
 * const theme: GraphTheme = "light";
 * ```
 */
export type GraphTheme = "cockpit" | "light" | "dark";

/**
 * The tools page's light editor theme: the well, grid, tape and labels in the editor's light tokens
 * (`workspace/styles/tokens.css`: canvas, line, edge, panel, ink, text-2, muted, the status
 * colours), the frame stack in the editor's phase hues, the budget a darker magenta that holds 3:1
 * on the light well.
 *
 * @example
 * ```ts
 * GRAPH_LIGHT.well; // "#f3f3f5": --color-light-canvas
 * ```
 */
export const GRAPH_LIGHT: GraphPalette = {
  well: "#f3f3f5",
  grid: "#e1e1e6",
  baseline: "#b5b5c0",
  tape: "#ffffff",
  tapeInk: "#5f5f69",
  ink: "#1c1c21",
  ink2: "#5f5f69",
  ink3: "#6d6d79",
  magenta: "#c026d3",
  amber: "#845513",
  red: "#af3229",
  cyan: "#257889",
  js: "#7c7ce4",
  gpu: "#3b3ba8",
  idle: "#c9c9d6",
  idleOutline: "#b5b5c0",
  flagGround: "#ffffff",
  flagSelectedHollow: "#e1e1e6",
  readout: "#ffffff"
};

/**
 * The tools page's dark editor theme: the editor's dark tokens for the well, grid, tape and labels,
 * the frame stack in the editor's phase hues.
 *
 * @example
 * ```ts
 * GRAPH_DARK.well; // "#131316": --color-dark-canvas
 * ```
 */
export const GRAPH_DARK: GraphPalette = {
  well: "#131316",
  grid: "#28282f",
  baseline: "#4c4c57",
  tape: "#1c1c21",
  tapeInk: "#a3a3ae",
  ink: "#ececf0",
  ink2: "#a3a3ae",
  ink3: "#8e8e99",
  magenta: "#ff4fd8",
  amber: "#e3a541",
  red: "#f27f76",
  cyan: "#4db3c6",
  js: "#a5a5f0",
  gpu: "#5b5bd6",
  idle: "#34343c",
  idleOutline: "#4c4c57",
  flagGround: "#1c1c21",
  flagSelectedHollow: "#34343c",
  readout: "#16161a"
};

/**
 * The painter's colours by theme; the cockpit's are `GRAPH_COLOURS`, unchanged.
 *
 * @example
 * ```ts
 * GRAPH_PALETTES.dark.grid; // "#28282f"
 * ```
 */
export const GRAPH_PALETTES: Readonly<Record<GraphTheme, GraphPalette>> = {
  cockpit: GRAPH_COLOURS,
  light: GRAPH_LIGHT,
  dark: GRAPH_DARK
};

/**
 * The cause hues of the light theme: each cockpit hue darkened until it holds at least 3:1 on the
 * light well (bars and flags); the dark theme keeps the cockpit hues (all above 7:1 on its well).
 */
const LIGHT_HUES: Readonly<Record<PerfCause, string>> = {
  gpu: "#c2410c",
  upload: "#7c3aed",
  compile: "#047857",
  longFrame: "#be185d",
  js: "#a16207",
  "gc?": "#475569",
  gap: "#64748b"
};

/**
 * The hue a cause is painted in under a theme: the cockpit's own (`CAUSE_STYLE`) for the cockpit
 * and the dark theme, a darker one on the light well.
 *
 * @param theme - The theme.
 * @param cause - The cause.
 * @returns The colour.
 * @example
 * ```ts
 * causeHue("light", "js"); // "#a16207"
 * causeHue("dark", "js"); // "#F4E04D"
 * ```
 */
export function causeHue(theme: GraphTheme, cause: PerfCause): string {
  return theme === "light" ? LIGHT_HUES[cause] : CAUSE_STYLE[cause].hue;
}

/**
 * The tools page's font families: the editor's Geist (labels) and Geist Mono (numbers), the faces
 * the tools page loads (no Barlow on the tools page).
 */
const TOOLS_SANS = '"Geist", ui-sans-serif, system-ui, sans-serif';
const TOOLS_MONO = '"Geist Mono", ui-monospace, Menlo, monospace';

/**
 * The painter's fonts on the tools page (the light and dark themes), phone and wide sizes: Geist for
 * the flags and the axis, Geist Mono for the tape, the readout and the rate labels.
 *
 * @example
 * ```ts
 * TOOLS_FONTS.wide.axis; // '500 11px "Geist", ui-sans-serif, system-ui, sans-serif'
 * ```
 */
export const TOOLS_FONTS = {
  phone: {
    flag: `600 10px ${TOOLS_SANS}`,
    tape: `500 10px ${TOOLS_MONO}`,
    readout: `600 12px ${TOOLS_MONO}`,
    axis: `500 10px ${TOOLS_SANS}`,
    rate: `500 10px ${TOOLS_MONO}`
  },
  wide: {
    flag: `600 11px ${TOOLS_SANS}`,
    tape: `500 11px ${TOOLS_MONO}`,
    readout: `600 14px ${TOOLS_MONO}`,
    axis: `500 11px ${TOOLS_SANS}`,
    rate: `500 10.5px ${TOOLS_MONO}`
  }
} as const;

/**
 * The hue of each primary cause code under a theme (CAUSE_RANK order, index = code − 1).
 *
 * @param theme - The theme.
 * @returns The hues.
 * @example
 * ```ts
 * huesOf("light")[0]; // "#c2410c": gpu, the first of CAUSE_RANK
 * ```
 */
function huesOf(theme: GraphTheme): readonly string[] {
  return CAUSE_RANK.map(cause => causeHue(theme, cause));
}

/**
 * The look of each theme, made once on first use.
 */
const LOOKS = new Map<GraphTheme, GraphLook>();

/**
 * The painter's look of a theme: the cockpit's colours, hues and Barlow fonts, or the editor's light
 * or dark colours with the light hues where needed and the Geist fonts. The same object every call.
 *
 * @param theme - The theme.
 * @returns The look to pass as `GraphView.look`.
 * @example
 * ```ts
 * graphLook("dark").colours.well; // "#131316"
 * ```
 */
export function graphLook(theme: GraphTheme): GraphLook {
  const known = LOOKS.get(theme);
  if (known !== undefined) return known;
  const look: GraphLook = {
    key: theme,
    colours: GRAPH_PALETTES[theme],
    hues: huesOf(theme),
    fonts: theme === "cockpit" ? GRAPH_FONTS : TOOLS_FONTS
  };
  LOOKS.set(theme, look);
  return look;
}

/**
 * @file renderView timeline — the canvas colours (spec 09 § M11, § M15 Themes): the workspace tokens
 * resolved once per theme into one palette object every painter reuses, and the cause → colour table
 * of the tools page (`MISSION_CAUSE`; perf/graph's `CAUSE_STYLE` stays the overlay's). A token is
 * resolved through a probe element's computed `color`, so `light-dark()` and `var()` come back as
 * the colour the theme shows; a token the page does not define falls back to a visible default.
 */
import type { PerfCause } from "../source/contract";
import { CAUSE_RANK } from "../source/contract";

/**
 * The colours the painters use, resolved from the workspace tokens (semantic names only).
 *
 * @example
 * ```ts
 * const palette: MissionPalette = readPalette(root);
 * palette.phase3; // "rgb(124, 124, 228)": the JS part of a bar
 * ```
 */
export type MissionPalette = {
  /** --text-ink: the cursor, chip text. */
  readonly ink: string;
  /** --text-2: labels, the budget line. */
  readonly text2: string;
  /** --text-muted: the rest budget, quiet labels. */
  readonly muted: string;
  /** --line-1. */
  readonly line1: string;
  /** --line-2: grid and rules. */
  readonly line2: string;
  /** --surface-canvas: the plot's ground and the dimming. */
  readonly canvas: string;
  /** --surface-panel: chip grounds. */
  readonly panel: string;
  /** --accent: the selection, the viewport. */
  readonly accent: string;
  /** --accent-ink: the selection start mark. */
  readonly accentInk: string;
  /** --status-live: a rate rise, the health line. */
  readonly live: string;
  /** --status-warn: a rate drop, JS over budget. */
  readonly warn: string;
  /** --status-error: recording, long frames. */
  readonly error: string;
  /** --phase-1: GPU time. */
  readonly phase1: string;
  /** --phase-2: uploads. */
  readonly phase2: string;
  /** --phase-3: JS time. */
  readonly phase3: string;
  /** --teal: GCs. */
  readonly teal: string;
  /** --edge: resting frames. */
  readonly edge: string;
  /** --pick-pink: GPU sustained. */
  readonly pickPink: string;
  /** --pick-blue: shader compiles. */
  readonly pickBlue: string;
  /** --src: the source tint of the spark lines (accent for a device, muted for the local preview). */
  readonly src: string;
};

/** A key of the palette. */
export type PaletteKey = keyof MissionPalette;

/**
 * The CSS each palette entry is resolved from: the workspace's semantic token, with the raw token as
 * a fallback where the semantic one is new (`--pick-pink`, `--pick-blue`, `--src`).
 */
const TOKENS: Readonly<Record<PaletteKey, string>> = {
  ink: "var(--text-ink)",
  text2: "var(--text-2)",
  muted: "var(--text-muted)",
  line1: "var(--line-1)",
  line2: "var(--line-2)",
  canvas: "var(--surface-canvas)",
  panel: "var(--surface-panel)",
  accent: "var(--accent)",
  accentInk: "var(--accent-ink)",
  live: "var(--status-live)",
  warn: "var(--status-warn)",
  error: "var(--status-error)",
  phase1: "var(--phase-1)",
  phase2: "var(--phase-2)",
  phase3: "var(--phase-3)",
  teal: "var(--teal)",
  edge: "var(--edge)",
  pickPink: "var(--pick-pink, var(--color-pick-pink))",
  pickBlue: "var(--pick-blue, var(--color-pick-blue))",
  src: "var(--src, var(--accent))"
};

/** The colour of a token the page does not define: visible on both themes, never empty. */
const FALLBACK = "rgb(128, 128, 128)";

/**
 * The palette key of each spike cause on the tools page (spec 09 § M8 Legend): JS warn, GPU
 * pick-pink, upload phase-2, compile pick-blue, long frame error. `gc?` and `gap` are never spikes.
 */
export const MISSION_CAUSE: Readonly<Partial<Record<PerfCause, PaletteKey>>> = {
  js: "warn",
  gpu: "pickPink",
  upload: "phase2",
  compile: "pickBlue",
  longFrame: "error"
};

/** The palette key of each primary cause code (CAUSE_RANK order + 1; index 0 unused). */
const CAUSE_KEYS: readonly PaletteKey[] = [
  "muted",
  ...CAUSE_RANK.map(cause => MISSION_CAUSE[cause] ?? "muted")
];

/**
 * The colour of a primary cause code.
 *
 * @param palette - The palette.
 * @param code - 1..7 (CAUSE_RANK order); 0 for none.
 * @returns The colour.
 * @example
 * ```ts
 * causeColour(palette, 1); // palette.pickPink: GPU sustained
 * ```
 */
export function causeColour(palette: MissionPalette, code: number): string {
  return palette[CAUSE_KEYS[code] ?? "muted"];
}

/**
 * Resolves the palette from the computed colours of a probe inside the Render workspace's scope
 * root: once per theme, never per paint.
 *
 * @param root - The Render workspace's scope root.
 * @returns The palette.
 * @example
 * ```ts
 * readPalette(root).teal; // "rgb(20, 150, 140)" in the light theme
 * ```
 */
export function readPalette(root: Element): MissionPalette {
  const probe = root.ownerDocument.createElement("span");
  probe.hidden = true;
  root.append(probe);
  const view = root.ownerDocument.defaultView;
  const read = (key: PaletteKey): string => {
    probe.style.color = TOKENS[key];
    const colour = view?.getComputedStyle(probe).color ?? "";
    return colour === "" ? FALLBACK : colour;
  };
  const palette: MissionPalette = {
    ink: read("ink"),
    text2: read("text2"),
    muted: read("muted"),
    line1: read("line1"),
    line2: read("line2"),
    canvas: read("canvas"),
    panel: read("panel"),
    accent: read("accent"),
    accentInk: read("accentInk"),
    live: read("live"),
    warn: read("warn"),
    error: read("error"),
    phase1: read("phase1"),
    phase2: read("phase2"),
    phase3: read("phase3"),
    teal: read("teal"),
    edge: read("edge"),
    pickPink: read("pickPink"),
    pickBlue: read("pickBlue"),
    src: read("src")
  };
  probe.remove();
  return palette;
}

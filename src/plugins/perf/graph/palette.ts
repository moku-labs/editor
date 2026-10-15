/**
 * @file perf/graph — the one place the cause letters, words and hues live, and the painter's colours
 * and fonts. The overlay's and the tools strip's DOM legends read the same table (they set `--c`
 * from `hue`). Data only.
 */
import type { PerfCause } from "../protocol";

/**
 * Legend, words and hue of one cause.
 *
 * @example
 * ```ts
 * const upload: CauseStyle = { legend: "UP", word: "Upload", key: "upload ≥ 1 MB", hue: "#B58CFF", hollow: false };
 * ```
 */
export type CauseStyle = {
  /** The annunciator legend: "UP". */
  readonly legend: string;
  /** The record's lead: "Upload". */
  readonly word: string;
  /** The legend row: "upload ≥ 1 MB". */
  readonly key: string;
  /** The cause colour. */
  readonly hue: string;
  /** True only for "gc?": drawn hollow and dashed, with "likely". */
  readonly hollow: boolean;
};

/**
 * Legend, words and hue of each cause, by CAUSE_RANK (design §2 "Spike causes").
 *
 * @example
 * ```ts
 * CAUSE_STYLE["gc?"].legend; // "GC?"
 * ```
 */
export const CAUSE_STYLE: Readonly<Record<PerfCause, CauseStyle>> = {
  gpu: {
    legend: "GPU",
    word: "GPU over budget",
    key: "gpu over budget",
    hue: "#FF8A3D",
    hollow: false
  },
  upload: { legend: "UP", word: "Upload", key: "upload ≥ 1 MB", hue: "#B58CFF", hollow: false },
  compile: {
    legend: "SH",
    word: "Shader compile",
    key: "shader compile",
    hue: "#35DFA6",
    hollow: false
  },
  longFrame: {
    legend: "LF",
    word: "Long frame",
    key: "long frame, a LoAF overlapped",
    hue: "#FF6F91",
    hollow: false
  },
  js: {
    legend: "JS",
    word: "Work over budget",
    key: "work over budget",
    hue: "#F4E04D",
    hollow: false
  },
  "gc?": {
    legend: "GC?",
    word: "Likely GC",
    key: "likely GC, Chrome-only hint",
    hue: "#E4E9F0",
    hollow: true
  },
  gap: {
    legend: "GAP",
    word: "Pause without work",
    key: "pause without work: GC, OS or compositor",
    hue: "#E4E9F0",
    hollow: false
  }
};

/**
 * The painter's colours (the prototype's tokens, design §6 G).
 *
 * @example
 * ```ts
 * GRAPH_COLOURS.magenta; // "#FF4FD8": the budget lines
 * ```
 */
export const GRAPH_COLOURS = {
  well: "#0B1629",
  grid: "#172846",
  baseline: "#3A5686",
  tape: "#081121",
  tapeInk: "#C9D6EA",
  ink: "#E9F0FA",
  ink2: "#9DB0CC",
  ink3: "#7A8FB2",
  magenta: "#FF4FD8",
  amber: "#FFB320",
  red: "#FF4545",
  cyan: "#3FDCF5",
  js: "#A8F0FF",
  gpu: "#2F78C4",
  idle: "#24406B",
  idleOutline: "#4A6696",
  flagGround: "#0A1426",
  flagSelectedHollow: "#2A4270",
  readout: "#000000"
} as const;

/**
 * The font families: the overlay's subset Barlow faces under their private name first, then plain
 * Barlow Condensed (the tools page loads it through fonts.css), then the fallbacks.
 */
const FAMILY = '"Moku Overlay Barlow Condensed", "Barlow Condensed", "Arial Narrow", sans-serif';

/**
 * The painter's fonts, phone and wide (the prototype's 700 drawn at 600, its 400 at 500: the bundled
 * faces are Barlow Condensed 500 and 600).
 *
 * @example
 * ```ts
 * GRAPH_FONTS.phone.flag; // '600 11px "Moku Overlay Barlow Condensed", "Barlow Condensed", "Arial Narrow", sans-serif'
 * ```
 */
export const GRAPH_FONTS = {
  phone: {
    flag: `600 11px ${FAMILY}`,
    tape: `600 11px ${FAMILY}`,
    readout: `600 13.5px ${FAMILY}`,
    axis: `500 11px ${FAMILY}`,
    rate: `600 10px ${FAMILY}`
  },
  wide: {
    flag: `600 12px ${FAMILY}`,
    tape: `600 12.5px ${FAMILY}`,
    readout: `600 17px ${FAMILY}`,
    axis: `500 11.5px ${FAMILY}`,
    rate: `600 11px ${FAMILY}`
  }
} as const;

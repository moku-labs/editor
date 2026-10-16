import type { PaintContext } from "../timeline/layout";
import type { MissionPalette } from "../timeline/palette";

// ─────────────────────────────────────────────────────────────────────────────
// A recording fake 2D context for the painter tests of timeline/: every call is
// kept with the styles in force (fill, stroke, width, alpha, dash, font), and
// measureText answers 6 px per character.
// ─────────────────────────────────────────────────────────────────────────────

/** One recorded call with the styles set when it ran. */
export type Call = {
  readonly op: string;
  readonly args: readonly number[];
  readonly text: string | undefined;
  readonly fillStyle: string;
  readonly strokeStyle: string;
  readonly lineWidth: number;
  readonly alpha: number;
  readonly dash: readonly number[];
};

/** The fake and what it recorded. */
export type Recorder = {
  readonly g: PaintContext;
  readonly calls: Call[];
  /** The texts drawn, in order. */
  texts(): string[];
  /** The calls of one operation. */
  of(op: string): Call[];
  /** How often measureText was called. */
  measures(): number;
  /** Forgets every call. */
  clear(): void;
};

/** A palette whose colours name themselves, so a test can read which part painted. */
export const PALETTE: MissionPalette = {
  ink: "ink",
  text2: "text2",
  muted: "muted",
  line1: "line1",
  line2: "line2",
  canvas: "canvas",
  panel: "panel",
  accent: "accent",
  accentInk: "accentInk",
  live: "live",
  warn: "warn",
  error: "error",
  phase1: "phase1",
  phase2: "phase2",
  phase3: "phase3",
  teal: "teal",
  edge: "edge",
  pickPink: "pickPink",
  pickBlue: "pickBlue",
  src: "src"
};

/**
 * A fake 2D context that records every call.
 *
 * @returns The recorder.
 */
export function recorder(): Recorder {
  const calls: Call[] = [];
  let dash: readonly number[] = [];
  let measures = 0;
  const record = (op: string, args: readonly number[], text?: string): void => {
    calls.push({
      op,
      args,
      text,
      fillStyle: String(g.fillStyle),
      strokeStyle: String(g.strokeStyle),
      lineWidth: g.lineWidth,
      alpha: g.globalAlpha,
      dash
    });
  };
  const g: PaintContext = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    globalAlpha: 1,
    fillRect: (...args) => record("fillRect", args),
    strokeRect: (...args) => record("strokeRect", args),
    beginPath: () => record("beginPath", []),
    closePath: () => record("closePath", []),
    moveTo: (...args) => record("moveTo", args),
    lineTo: (...args) => record("lineTo", args),
    arcTo: (...args) => record("arcTo", args),
    fill: () => record("fill", []),
    stroke: () => record("stroke", []),
    save: () => record("save", []),
    restore: () => record("restore", []),
    rect: (...args) => record("rect", args),
    clip: () => record("clip", []),
    setLineDash: segments => {
      dash = [...segments];
    },
    fillText: (text, x, y) => record("fillText", [x, y], text),
    measureText: text => {
      measures += 1;
      return { width: text.length * 6 };
    }
  };
  return {
    g,
    calls,
    texts: () => calls.filter(call => call.op === "fillText").map(call => call.text ?? ""),
    of: op => calls.filter(call => call.op === op),
    measures: () => measures,
    clear: () => {
      calls.length = 0;
    }
  };
}

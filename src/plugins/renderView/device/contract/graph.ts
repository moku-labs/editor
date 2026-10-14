/**
 * @file renderView device strip — STAND-IN for spec 03 `perf/graph/`: the cause palette
 * (`CAUSE_STYLE`), the painter state and the pure canvas-2D painter of the frame graph on the
 * structural `GraphContext2D`, with its hit tests (`spikeAt`, `rowAt`). Written to 03's layout
 * rules (§ "What it paints"): the tools strip passes `wide: true`. Unit 03 is not built yet; when
 * it lands, `contract/index.ts` re-exports these names from `perf/graph` (whose painter also
 * draws the phone's stack legend and keeps 03's no-allocation rule) and this file is deleted.
 * DOM-free: no DOM type is named here.
 */
import type { PerfCause } from "../../../perf/protocol";
import { causeName, rateFps } from "../../../perf/protocol";
import type { PerfWindowView } from "./window";

/**
 * The members of a canvas 2D context the painter calls. A browser's CanvasRenderingContext2D is
 * assignable to it; tests pass a recording fake.
 *
 * @example
 * ```ts
 * const g: GraphContext2D = canvas.getContext("2d")!;
 * ```
 */
export type GraphContext2D = {
  fillStyle: string | object;
  strokeStyle: string | object;
  lineWidth: number;
  font: string;
  textAlign: string;
  textBaseline: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  fill(): void;
  stroke(): void;
  setLineDash(segments: number[]): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { readonly width: number };
};

/**
 * How to paint one graph: the CSS px of the canvas box, the wide (tools strip) layout and the
 * selected row (−1: the newest).
 *
 * @example
 * ```ts
 * const view: GraphView = { width: 1000, height: 200, wide: true, selected: -1 };
 * ```
 */
export type GraphView = {
  readonly width: number;
  readonly height: number;
  readonly wide: boolean;
  readonly selected: number;
};

/**
 * What a painter keeps between paints, made once per canvas: the flag hit boxes and the layout of
 * the last paint (for `spikeAt` / `rowAt`), and the legend widths measured once per font.
 */
export type GraphState = {
  readonly flagRow: Int32Array;
  readonly flagX0: Float32Array;
  readonly flagX1: Float32Array;
  flagCount: number;
  px0: number;
  px1: number;
  py0: number;
  py1: number;
  flagBand: number;
  startMs: number;
  spanMs: number;
  /** Width of each cause legend in the flag font, by cause; measured while `measured` is false. */
  readonly legendWidth: Map<PerfCause, number>;
  measured: boolean;
};

/**
 * Legend, words and hue of one cause.
 */
export type CauseStyle = {
  /** The annunciator legend: "UP". */
  readonly legend: string;
  /** The record's lead: "Upload". */
  readonly word: string;
  /** The legend row: "upload ≥ 1 MB". */
  readonly key: string;
  readonly hue: string;
  /** True only for "gc?": drawn dashed with "likely". */
  readonly hollow: boolean;
};

/**
 * Legend, words and hue of each cause (spec 03 `graph/palette.ts`, design §2 "Spike causes").
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
 * The painter's colours (spec 03 `GRAPH_COLOURS`).
 */
const COLOUR = {
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
  flagGround: "#0A1426",
  flagSelectedHollow: "#2A4270",
  readout: "#000000"
} as const;

/**
 * Layout of the phone card's graph and of the tools strip's (wide): tape width, flag band, axis
 * band, the bar width of a spike, and the fonts.
 */
const LAYOUTS = {
  phone: {
    tape: 36,
    flagBand: 18,
    axis: 19,
    bar: 3,
    flagPad: 6,
    readout: 17,
    readoutGap: 3,
    flagFont: '600 11px "Barlow Condensed", "Arial Narrow", sans-serif',
    tapeFont: '600 11px "Barlow Condensed", "Arial Narrow", sans-serif',
    readoutFont: '600 13.5px "Barlow Condensed", "Arial Narrow", sans-serif',
    axisFont: '500 11px "Barlow Condensed", "Arial Narrow", sans-serif',
    rateFont: '600 10px "Barlow Condensed", "Arial Narrow", sans-serif'
  },
  wide: {
    tape: 52,
    flagBand: 24,
    axis: 18,
    bar: 5,
    flagPad: 12,
    readout: 22,
    readoutGap: 6,
    flagFont: '600 12px "Barlow Condensed", "Arial Narrow", sans-serif',
    tapeFont: '600 12.5px "Barlow Condensed", "Arial Narrow", sans-serif',
    readoutFont: '600 17px "Barlow Condensed", "Arial Narrow", sans-serif',
    axisFont: '500 11.5px "Barlow Condensed", "Arial Narrow", sans-serif',
    rateFont: '600 11px "Barlow Condensed", "Arial Narrow", sans-serif'
  }
} as const;

/**
 * One layout of LAYOUTS.
 */
type Layout = (typeof LAYOUTS)[keyof typeof LAYOUTS];

/**
 * The top of the y scale, ms.
 */
const SCALE_MS = 45;

/**
 * Grid lines, ms.
 */
const GRID_MS = [10, 20, 30, 40] as const;

/**
 * One paint's geometry: the plot box and the two axis mappings.
 */
type Plot = {
  readonly g: GraphContext2D;
  readonly window: PerfWindowView;
  readonly view: GraphView;
  readonly layout: Layout;
  readonly state: GraphState;
  readonly px0: number;
  readonly px1: number;
  readonly py0: number;
  readonly py1: number;
};

/**
 * Makes the painter state of one canvas.
 *
 * @param capacity - The window's rows: a window never holds more spikes than rows.
 * @returns The state.
 * @example
 * ```ts
 * createGraphState(1024).flagCount; // 0
 * ```
 */
export function createGraphState(capacity: number): GraphState {
  return {
    flagRow: new Int32Array(capacity),
    flagX0: new Float32Array(capacity),
    flagX1: new Float32Array(capacity),
    flagCount: 0,
    px0: 0,
    px1: 0,
    py0: 0,
    py1: 0,
    flagBand: 0,
    startMs: 0,
    spanMs: 1,
    legendWidth: new Map(),
    measured: false
  };
}

/**
 * Forgets the measured legend widths: call after the fonts loaded, so legends are measured in
 * Barlow Condensed and not the fallback.
 *
 * @param state - The painter state.
 */
export function resetGraphText(state: GraphState): void {
  state.measured = false;
  state.legendWidth.clear();
}

/**
 * The y of a frame time in the plot.
 *
 * @param plot - The paint's geometry.
 * @param ms - A frame time, ms.
 * @returns The y, CSS px.
 */
function yOf(plot: Plot, ms: number): number {
  return plot.py1 - (Math.min(Math.max(ms, 0), SCALE_MS) / SCALE_MS) * (plot.py1 - plot.py0);
}

/**
 * The x of a page-clock time in the plot.
 *
 * @param state - The painter state holding the layout of this paint.
 * @param t - Page-clock ms.
 * @returns The x, CSS px.
 */
function xOf(state: GraphState, t: number): number {
  return state.px0 + ((t - state.startMs) / state.spanMs) * (state.px1 - state.px0);
}

/**
 * The left and right x of a row's bar: from its start to the next row's (the newest to `px1`).
 *
 * @param state - The painter state.
 * @param window - The window.
 * @param row - A row.
 * @returns `[x0, x1]`.
 */
function spanOf(state: GraphState, window: PerfWindowView, row: number): [number, number] {
  const x0 = xOf(state, window.t[row] ?? 0);
  const x1 = row + 1 < window.count ? xOf(state, window.t[row + 1] ?? 0) : state.px1;
  return [x0, Math.max(x1, x0 + 1)];
}

/**
 * Fills a vertical band from `top` to `bottom`.
 *
 * @param plot - The paint's geometry.
 * @param colour - The fill.
 * @param x - Left, CSS px.
 * @param width - Width, CSS px.
 * @param top - Top y.
 * @param bottom - Bottom y.
 */
function band(
  plot: Plot,
  colour: string,
  x: number,
  width: number,
  top: number,
  bottom: number
): void {
  if (bottom <= top) return;
  plot.g.fillStyle = colour;
  plot.g.fillRect(x, top, width, bottom - top);
}

/**
 * Steps 1–4: the well, the grid, the stacked bars of the plain frames, the holes and carets of
 * the skipped ones, and the baseline.
 *
 * @param plot - The paint's geometry.
 */
function paintRows(plot: Plot): void {
  const { g, window, state, view } = plot;
  g.fillStyle = COLOUR.well;
  g.fillRect(0, 0, view.width, view.height);
  for (const ms of GRID_MS)
    band(plot, COLOUR.grid, plot.px0, plot.px1 - plot.px0, yOf(plot, ms), yOf(plot, ms) + 1);

  for (let row = 0; row < window.count; row += 1) {
    if ((window.cause[row] ?? 0) !== 0) continue;
    const [x0, x1] = spanOf(state, window, row);
    const width = x1 - x0 + 0.35;
    const js = window.jsMs[row] ?? 0;
    const gpu = window.gpuMs[row] ?? Number.NaN;
    if (window.drawn[row] === 0) {
      band(
        plot,
        COLOUR.well,
        (x0 + x1) / 2 - 1.5,
        3,
        yOf(plot, window.budgetMs[row] ?? 0) - 1,
        plot.py1
      );
      caret(g, (x0 + x1) / 2, plot.py1 + 2, 7, 5, COLOUR.amber);
      continue;
    }
    const top = yOf(plot, window.ms[row] ?? 0);
    const work = window.gpuTimer && Number.isFinite(gpu) ? js + gpu : js;
    band(plot, COLOUR.idle, x0, width, top, yOf(plot, work));
    if (work !== js) band(plot, COLOUR.gpu, x0, width, yOf(plot, work), yOf(plot, js));
    band(plot, COLOUR.js, x0, width, yOf(plot, js), plot.py1);
  }
  band(plot, COLOUR.baseline, plot.px0, plot.px1 - plot.px0, plot.py1, plot.py1 + 1);
}

/**
 * A filled triangle pointing up, its apex at `(x, y)`.
 *
 * @param g - The context.
 * @param x - Apex x.
 * @param y - Apex y.
 * @param width - Base width.
 * @param height - Height.
 * @param colour - Fill.
 */
function caret(
  g: GraphContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  colour: string
): void {
  g.fillStyle = colour;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + width / 2, y + height);
  g.lineTo(x - width / 2, y + height);
  g.closePath();
  g.fill();
}

/**
 * Step 5: the budget line per frame (magenta, 1.5 px) and its half (1 px dashed), stepping where a
 * frame's own `budgetMs` changes.
 *
 * @param plot - The paint's geometry.
 * @param share - 1 for the budget line, 0.5 for its half.
 */
function paintBudget(plot: Plot, share: number): void {
  const { g, window, state } = plot;
  if (window.count === 0) return;
  g.strokeStyle = COLOUR.magenta;
  g.lineWidth = share === 1 ? 1.5 : 1;
  g.setLineDash(share === 1 ? [] : [4, 3]);
  g.beginPath();
  for (let row = 0; row < window.count; row += 1) {
    const [x0, x1] = spanOf(state, window, row);
    const y = yOf(plot, (window.budgetMs[row] ?? 0) * share);
    if (row === 0) g.moveTo(x0, y);
    else g.lineTo(x0, y);
    g.lineTo(x1, y);
  }
  g.stroke();
  g.setLineDash([]);
}

/**
 * Step 5b: a dashed magenta vertical at every rate switch, with the new rate's fps.
 *
 * @param plot - The paint's geometry.
 */
function paintRateSwitches(plot: Plot): void {
  const { g, window, state, layout } = plot;
  g.font = layout.rateFont;
  g.textBaseline = "alphabetic";
  for (let row = 1; row < window.count; row += 1) {
    const rate = window.rateMs[row] ?? 0;
    if (Math.abs(rate - (window.rateMs[row - 1] ?? 0)) <= 0.01) continue;
    const x = xOf(state, window.t[row] ?? 0);
    g.strokeStyle = COLOUR.magenta;
    g.lineWidth = 1;
    g.setLineDash([2, 2]);
    g.beginPath();
    g.moveTo(x, plot.py0);
    g.lineTo(x, plot.py1);
    g.stroke();
    g.setLineDash([]);
    const text = String(rateFps(rate));
    const width = g.measureText(text).width;
    g.fillStyle = COLOUR.magenta;
    g.textAlign = "left";
    g.fillText(text, x + 2 + width > plot.px1 ? x - 2 - width : x + 2, plot.py0 + 9);
  }
}

/**
 * The row the cursor, the readout and the caption follow: the selected one, else the newest.
 *
 * @param plot - The paint's geometry.
 * @returns The row; −1 for an empty window.
 */
function focusRow(plot: Plot): number {
  const { selected } = plot.view;
  return selected >= 0 && selected < plot.window.count ? selected : plot.window.count - 1;
}

/**
 * The measured width of a cause's flag legend, measured once per font.
 *
 * @param plot - The paint's geometry.
 * @param cause - The cause.
 * @returns The text width, CSS px.
 */
function legendWidth(plot: Plot, cause: PerfCause): number {
  const { state, g } = plot;
  const known = state.legendWidth.get(cause);
  if (known !== undefined && state.measured) return known;
  const width = g.measureText(flagText(cause)).width;
  state.legendWidth.set(cause, width);
  return width;
}

/**
 * The text of a cause's flag: its legend, "GC? likely" for the hollow one.
 *
 * @param cause - The cause.
 * @returns The text.
 * @example
 * ```ts
 * flagText("gc?"); // "GC? likely"
 * ```
 */
function flagText(cause: PerfCause): string {
  const style = CAUSE_STYLE[cause];
  return style.hollow ? `${style.legend} likely` : style.legend;
}

/**
 * Step 7, one spike: its bar, the over-scale caret, its flag with the leader, and its hit box.
 *
 * @param plot - The paint's geometry.
 * @param row - The spike row.
 * @param selected - Whether the row is the selected one.
 */
function paintSpike(plot: Plot, row: number, selected: boolean): void {
  const { g, window, state, layout } = plot;
  const cause = causeName(window.cause[row] ?? 0) ?? "gap";
  const style = CAUSE_STYLE[cause];
  const [x0, x1] = spanOf(state, window, row);
  const centre = (x0 + x1) / 2;
  const ms = window.ms[row] ?? 0;
  const top = yOf(plot, ms);

  // The bar: hollow for GC?, else filled with a tick at the JS height when the GPU is timed.
  if (style.hollow) {
    band(plot, COLOUR.well, centre - layout.bar / 2, layout.bar, top, plot.py1);
    g.strokeStyle = style.hue;
    g.lineWidth = 1;
    g.strokeRect(centre - layout.bar / 2, top, layout.bar, plot.py1 - top);
  } else {
    band(plot, style.hue, centre - layout.bar / 2, layout.bar, top, plot.py1);
    if (window.gpuTimer)
      band(
        plot,
        COLOUR.well,
        centre - layout.bar / 2,
        layout.bar,
        yOf(plot, window.jsMs[row] ?? 0),
        yOf(plot, window.jsMs[row] ?? 0) + 1
      );
  }
  if (ms > SCALE_MS) caret(g, centre, plot.py0, 10, 7, COLOUR.red);

  // The flag: the legend boxed in the cause colour, filled when selected, clamped into the plot.
  g.font = layout.flagFont;
  const boxWidth = legendWidth(plot, cause) + layout.flagPad;
  const boxHeight = layout.flagBand - 4;
  const left = Math.min(Math.max(centre - boxWidth / 2, plot.px0), plot.px1 - boxWidth);
  const ground = selected ? style.hue : COLOUR.flagGround;
  g.fillStyle = style.hollow && selected ? COLOUR.flagSelectedHollow : ground;
  g.fillRect(left, 1, boxWidth, boxHeight);
  g.strokeStyle = style.hue;
  g.lineWidth = style.hollow && selected ? 2 : 1.5;
  g.setLineDash(style.hollow ? [3, 2] : []);
  g.strokeRect(left, 1, boxWidth, boxHeight);
  g.setLineDash([2, 2]);
  g.beginPath();
  g.moveTo(centre, 1 + boxHeight);
  g.lineTo(centre, top);
  g.stroke();
  g.setLineDash([]);
  g.fillStyle = selected && !style.hollow ? COLOUR.flagGround : style.hue;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(flagText(cause), left + boxWidth / 2, 1 + boxHeight / 2);

  // Its hit box for spikeAt.
  const index = state.flagCount;
  state.flagRow[index] = row;
  state.flagX0[index] = left;
  state.flagX1[index] = left + boxWidth;
  state.flagCount += 1;
}

/**
 * Steps 6–7: the cursor at the focus row, then every spike, oldest first.
 *
 * @param plot - The paint's geometry.
 */
function paintSpikes(plot: Plot): void {
  const { window, state, view } = plot;
  const focus = focusRow(plot);
  if (focus >= 0) {
    const [x0, x1] = spanOf(state, window, focus);
    band(plot, COLOUR.ink, (x0 + x1) / 2, 1, plot.py0, plot.py1);
  }
  state.flagCount = 0;
  for (let index = 0; index < window.spikeCount; index += 1) {
    const row = window.spikes[index] ?? 0;
    paintSpike(plot, row, row === view.selected);
  }
  state.measured = true;
}

/**
 * A tape bug: a pentagon pointing at the plot, solid or outlined.
 *
 * @param plot - The paint's geometry.
 * @param y - Its middle.
 * @param solid - Filled (the budget) or outlined (its half).
 */
function bug(plot: Plot, y: number, solid: boolean): void {
  const { g, px1 } = plot;
  g.beginPath();
  g.moveTo(px1 + 1, y - 5);
  g.lineTo(px1 + 11, y - 5);
  g.lineTo(px1 + 11, y + 5);
  g.lineTo(px1 + 1, y + 5);
  g.lineTo(px1 + 6, y);
  g.closePath();
  if (solid) {
    g.fillStyle = COLOUR.magenta;
    g.fill();
    return;
  }
  g.strokeStyle = COLOUR.magenta;
  g.lineWidth = 1.5;
  g.stroke();
}

/**
 * Step 8: the tape — ground, spine, ticks every 5 ms, the labels (the newest budget and its half
 * in magenta win over a neighbour closer than 9 px) and the two bugs.
 *
 * @param plot - The paint's geometry.
 * @param budget - The newest row's budget, ms.
 */
function paintTape(plot: Plot, budget: number): void {
  const { g, view, layout, px1 } = plot;
  band(plot, COLOUR.tape, px1, view.width - px1, 0, view.height);
  band(plot, COLOUR.tapeInk, px1, 1, plot.py0, plot.py1);
  for (let ms = 0; ms <= SCALE_MS; ms += 5) {
    band(plot, COLOUR.tapeInk, px1, ms % 10 === 0 ? 7 : 4, yOf(plot, ms), yOf(plot, ms) + 1);
  }

  const marks: { ms: number; text: string; colour: string }[] = [
    { ms: budget, text: budget.toFixed(1), colour: COLOUR.magenta },
    { ms: budget / 2, text: (budget / 2).toFixed(1), colour: COLOUR.magenta },
    { ms: 0, text: "0", colour: COLOUR.tapeInk },
    { ms: 30, text: "30", colour: COLOUR.tapeInk },
    { ms: 40, text: "40", colour: COLOUR.tapeInk }
  ];
  if (view.wide) marks.push({ ms: 25, text: "25", colour: COLOUR.tapeInk });
  g.font = layout.tapeFont;
  g.textAlign = "right";
  g.textBaseline = "middle";
  const drawn: number[] = [];
  for (const mark of marks) {
    const y = yOf(plot, mark.ms);
    if (drawn.some(other => Math.abs(other - y) < 9)) continue;
    drawn.push(y);
    g.fillStyle = mark.colour;
    g.fillText(mark.text, view.width - 3, y);
  }
  bug(plot, yOf(plot, budget), true);
  bug(plot, yOf(plot, budget / 2), false);
}

/**
 * Step 9: the readout box on the tape at the focus row's frame time: SKIP for a skipped frame,
 * else the ms in red above twice its budget, amber above it, cyan otherwise.
 *
 * @param plot - The paint's geometry.
 * @param row - The focus row.
 */
function paintReadout(plot: Plot, row: number): void {
  const { g, window, view, layout } = plot;
  const ms = window.ms[row] ?? 0;
  const budget = window.budgetMs[row] ?? 0;
  const skipped = window.drawn[row] === 0;
  const half = layout.readout / 2;
  const y = Math.min(Math.max(yOf(plot, ms), plot.py0 + half), plot.py1 - half);
  const left = plot.px1 + layout.readoutGap;

  g.fillStyle = COLOUR.readout;
  g.beginPath();
  g.moveTo(left - 7, y);
  g.lineTo(left, y - half);
  g.lineTo(view.width - 1, y - half);
  g.lineTo(view.width - 1, y + half);
  g.lineTo(left, y + half);
  g.closePath();
  g.fill();
  g.strokeStyle = COLOUR.ink;
  g.lineWidth = 1;
  g.stroke();

  let colour: string = COLOUR.cyan;
  if (skipped || ms > budget) colour = COLOUR.amber;
  if (!skipped && ms > 2 * budget) colour = COLOUR.red;
  g.font = layout.readoutFont;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = colour;
  g.fillText(skipped ? "SKIP" : ms.toFixed(1), (left + view.width - 1) / 2, y);
}

/**
 * Steps 10–11: the caption (`frame 4812, spike 5/6`) and the time axis (one label a second on the
 * wide graph, `−6 s` and `now` on the phone).
 *
 * @param plot - The paint's geometry.
 * @param row - The focus row.
 */
function paintText(plot: Plot, row: number): void {
  const { g, window, view, layout, state } = plot;
  g.font = layout.flagFont;
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
  g.fillStyle = COLOUR.ink2;
  let ordinal = 0;
  for (let index = 0; index < window.spikeCount; index += 1) {
    if (window.spikes[index] === row) ordinal = index + 1;
  }
  const spike = ordinal === 0 ? "" : `, spike ${ordinal}/${window.spikeCount}`;
  g.fillText(
    `frame ${window.frame[row] ?? 0}${spike}`,
    plot.px0 + 4,
    plot.py0 + (view.wide ? 9 : 7)
  );

  g.font = layout.axisFont;
  g.fillStyle = COLOUR.ink3;
  const seconds = Math.max(1, Math.round(state.spanMs / 1000));
  const step = view.wide ? 1 : seconds;
  for (let second = seconds; second > 0; second -= step) {
    const x = plot.px1 - ((plot.px1 - plot.px0) * second) / seconds;
    g.textAlign = second === seconds ? "left" : "center";
    g.fillText(`−${second} s`, second === seconds ? x + 2 : x, view.height - 2);
  }
  g.textAlign = "right";
  g.fillText("now", plot.px1 - 2, view.height - 2);
}

/**
 * Paints the whole graph in one pass and records the flag boxes and the layout in `state`. The
 * caller owns the canvas: it sizes the backing store and sets the dpr transform first; the
 * painter works in CSS px.
 *
 * @param g - The 2D context.
 * @param window - The window.
 * @param view - Size, layout and the selected row.
 * @param state - The painter state of this canvas.
 */
export function paintGraph(
  g: GraphContext2D,
  window: PerfWindowView,
  view: GraphView,
  state: GraphState
): void {
  const layout = view.wide ? LAYOUTS.wide : LAYOUTS.phone;
  const plot: Plot = {
    g,
    window,
    view,
    layout,
    state,
    px0: 1,
    px1: view.width - layout.tape,
    py0: layout.flagBand + 2,
    py1: view.height - layout.axis
  };
  state.px0 = plot.px0;
  state.px1 = plot.px1;
  state.py0 = plot.py0;
  state.py1 = plot.py1;
  state.flagBand = layout.flagBand;
  state.startMs = window.startMs;
  state.spanMs = Math.max(1, window.endMs - window.startMs);

  paintRows(plot);
  paintBudget(plot, 1);
  paintBudget(plot, 0.5);
  paintRateSwitches(plot);
  paintSpikes(plot);
  const row = focusRow(plot);
  const budget = row >= 0 ? (window.budgetMs[row] ?? 16.7) : 16.7;
  paintTape(plot, window.count > 0 ? (window.budgetMs[window.count - 1] ?? budget) : budget);
  if (row < 0) return;
  paintReadout(plot, row);
  paintText(plot, row);
}

/**
 * The spike under a tap at CSS px `(x, y)`: inside the flag band on a flag box ± 4 px, its row;
 * else the spike bar whose centre is nearest within 9 px.
 *
 * @param state - The painter state of the last paint.
 * @param window - The window it painted.
 * @param x - CSS px from the canvas's left.
 * @param y - CSS px from its top.
 * @returns The row; −1 for none.
 */
export function spikeAt(state: GraphState, window: PerfWindowView, x: number, y: number): number {
  if (y <= state.flagBand + 6) {
    for (let index = 0; index < state.flagCount; index += 1) {
      const isOnFlag = x >= (state.flagX0[index] ?? 0) - 4 && x <= (state.flagX1[index] ?? 0) + 4;
      if (isOnFlag) return state.flagRow[index] ?? -1;
    }
  }
  let best = -1;
  let distance = 9;
  for (let index = 0; index < window.spikeCount; index += 1) {
    const row = window.spikes[index] ?? 0;
    const [x0, x1] = spanOf(state, window, row);
    const away = Math.abs((x0 + x1) / 2 - x);
    if (away <= distance) {
      best = row;
      distance = away;
    }
  }
  return best;
}

/**
 * The row under `x` by time, clamped to the window.
 *
 * @param state - The painter state of the last paint.
 * @param window - The window it painted.
 * @param x - CSS px from the canvas's left.
 * @returns The row; −1 for an empty window.
 */
export function rowAt(state: GraphState, window: PerfWindowView, x: number): number {
  if (window.count === 0) return -1;
  const t = state.startMs + ((x - state.px0) / Math.max(1, state.px1 - state.px0)) * state.spanMs;
  let low = 0;
  let high = window.count - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((window.t[middle] ?? 0) <= t) low = middle;
    else high = middle - 1;
  }
  return low;
}

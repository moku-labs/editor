/**
 * @file perf/graph — `paintGraph`: the frame graph in one pass on a structural 2D context (design
 * §6 G and D2, the prototype's numbers). No allocation per paint: indexed loops over the typed
 * arrays, module constants for the dash patterns, fonts and fixed words, and label strings built
 * only when their cached key in the state changed.
 */
import type { PerfWindowView } from "../protocol";
import {
  CAUSE_RANK,
  EMPTY_BUDGET_MS,
  GAP_BIT,
  isGpuNoise,
  REST,
  rateFps,
  spikeOrdinal
} from "../protocol";
import { cell, rowCentre, rowLeft, rowRight, xOf } from "./geometry";
import { axisLabel, captionKeyOf, captionOf, flagText, oneDecimal } from "./labels";
import type { CauseStyle, GraphPalette } from "./palette";
import { CAUSE_STYLE, GRAPH_COLOURS, GRAPH_FONTS } from "./palette";
import { resetGraphText } from "./state";
import type { GraphContext2D, GraphFonts, GraphLook, GraphState, GraphView } from "./types";

/**
 * The layout of one graph size: tape width, flag band, axis band, spike bar width, flag padding,
 * readout box, caption offset and the rate label's room (the fonts come with the look).
 */
type Layout = {
  readonly tape: number;
  readonly flagBand: number;
  readonly axis: number;
  readonly bar: number;
  readonly flagPad: number;
  readonly readout: number;
  readonly readoutGap: number;
  readonly captionDy: number;
  readonly rateRoom: number;
};

/** The phone card's graph (273×108). */
const PHONE: Layout = {
  tape: 36,
  flagBand: 18,
  axis: 19,
  bar: 3,
  flagPad: 6,
  readout: 17,
  readoutGap: 3,
  captionDy: 7,
  rateRoom: 18
};

/** The tools strip's graph (about 1000×200). */
const WIDE: Layout = {
  tape: 52,
  flagBand: 24,
  axis: 18,
  bar: 5,
  flagPad: 12,
  readout: 22,
  readoutGap: 6,
  captionDy: 9,
  rateRoom: 20
};

/** The top of the y scale, ms. */
const SCALE_MS = 45;

/** The most axis labels of one paint: a hostile span must not loop for long. */
const MAX_AXIS_SECONDS = 60;

/** A plot lower than this shows only `0`, the budget and `40` on the tape. */
const SHORT_PLOT = 60;

/** Two tape labels closer than this, px: the lower-priority one is left out. */
const TAPE_GAP = 9;

/** The rate labels a painter state keeps; past this the cache starts over. */
const MAX_RATE_LABELS = 16;

/** The highest rate a switch is labelled with, fps; a rate outside 1…1000 gets the mark, no label. */
const MAX_LABELLED_FPS = 1000;

/** A rate switch counts when two rows' `rateMs` differ by more than this, ms. */
const RATE_EPSILON = 0.01;

/** Solid lines. */
const DASH_NONE: number[] = [];

/** The half-budget line. */
const DASH_HALF: number[] = [4, 3];

/** Rate-switch marks and flag leaders. */
const DASH_FINE: number[] = [2, 2];

/** The hollow (GC?) flag's border. */
const DASH_HOLLOW: number[] = [3, 2];

/** The readout of a frame that was not drawn. */
const SKIP_TEXT = "SKIP";

/** The readout's word for a resting row or a break (spec 03 delta 2026-10-15). */
const IDLE_TEXT = "IDLE";

/** The readout cache keys of the fixed words. */
const SKIP_KEY = -1;
const IDLE_KEY = -2;

/** The faint tick of an awake row's notable gap: its height under the baseline, CSS px. */
const GAP_TICK_H = 3;

/** A break's double bar: the bars' distance, how far above and below the baseline they reach. */
const BREAK_BAR_GAP = 3;
const BREAK_BAR_UP = 3;
const BREAK_BAR_DOWN = 4;

/** The axis label of the newest frame. */
const NOW_TEXT = "now";

/** The stack legend's words and the room each item takes (swatch, gap, word), phone only. */
const LEGEND_JS = "JS";
const LEGEND_GPU = "GPU";
const LEGEND_IDLE = "idle";
const LEGEND_ROOM_JS = 24;
const LEGEND_ROOM_GPU = 31;
const LEGEND_ROOM_IDLE = 27;

/** The top of a flag box, CSS px. */
const FLAG_TOP = 1;

/** A flag box is the flag band minus this high, px. */
const FLAG_INSET = 4;

/** The border of a flag box, px; the selected hollow (GC?) flag's is wider. */
const FLAG_BORDER = 1.5;
const FLAG_BORDER_SELECTED_HOLLOW = 2;

/** One CSS px: leaders, switch marks, outlines and the readout box's border. */
const HAIRLINE = 1;

/** A rate label sits this far beside its switch line and this far below the plot's top, px. */
const RATE_LABEL_GAP = 2;
const RATE_LABEL_DROP = 9;

/** Tape ticks every 5 ms, long (7 px) at multiples of 10 ms, else short (4 px). */
const TICK_STEP_MS = 5;
const MAJOR_TICK_MS = 10;
const MAJOR_TICK = 7;
const MINOR_TICK = 4;

/** Tape labels end this far from the canvas's right edge, px. */
const TAPE_LABEL_INSET = 3;

/** A fixed tape label: its text, its ms, and whether it shows only on a tall plot or the wide graph. */
type TapeMark = {
  readonly text: string;
  readonly ms: number;
  readonly tallOnly: boolean;
  readonly wideOnly: boolean;
};

/** The tape's fixed labels in drawing order, after the budget and its half. */
const TAPE_MARKS: readonly TapeMark[] = [
  { text: "0", ms: 0, tallOnly: false, wideOnly: false },
  { text: "25", ms: 25, tallOnly: true, wideOnly: true },
  { text: "30", ms: 30, tallOnly: true, wideOnly: false },
  { text: "40", ms: 40, tallOnly: false, wideOnly: false }
];

/** A tape bug: from 1 px right of the spine to 11 px, 5 px above and below its line, tip at 6 px. */
const BUG_NEAR = 1;
const BUG_FAR = 11;
const BUG_TIP = 6;
const BUG_HALF = 5;
const BUG_OUTLINE = 1.5;

/** The readout box's pointer reaches this far left of the box, px. */
const READOUT_POINTER = 7;

/** The readout shows tenths of a millisecond. */
const TENTHS = 10;

/** The caption starts this far right of the plot's left edge, px. */
const CAPTION_INSET = 4;

/** Axis labels sit this far inside the plot's edges, their baseline this far above the bottom, px. */
const AXIS_INSET = 2;
const BASELINE_INSET = 2;

/** One second, ms: the wide axis labels every second. */
const SECOND_MS = 1000;

/** A stack legend swatch: 8 px square, its word 3 px to its right, its outline 0.5 px inside. */
const SWATCH = 8;
const SWATCH_GAP = 3;
const SWATCH_OUTLINE_INSET = 0.5;

/** The plot's left edge, CSS px, and its gap under the flag band. */
const PLOT_LEFT = 1;
const PLOT_TOP_GAP = 2;

/** The shortest time axis a paint divides by, ms. */
const MIN_SPAN_MS = 1;

/** Grid lines every 10 ms up to 40 ms. */
const GRID_STEP_MS = 10;
const GRID_TOP_MS = 40;

/** A not-drawn frame: a 3 px hole reaching 1 px over its budget, and a 7×5 caret 2 px under the baseline. */
const SKIP_HOLE_W = 3;
const SKIP_HOLE_OVER = 1;
const SKIP_CARET_GAP = 2;
const SKIP_CARET_W = 7;
const SKIP_CARET_H = 5;

/** A stack bar overlaps the next by this much, px, so no seam shows. */
const STACK_BLEED = 0.35;

/** The budget line's width, px (its half line is a hairline). */
const BUDGET_LINE = 1.5;

/** The share of a row's budget each budget line marks: the budget, and its half. */
const FULL_BUDGET = 1;
const HALF_BUDGET = 0.5;

/** The caret over a spike past the scale: 10 px wide, 7 px high. */
const OVERFLOW_CARET_W = 10;
const OVERFLOW_CARET_H = 7;

/** The cause style of each primary cause code (index = code − 1). */
const STYLE_OF_CODE = CAUSE_RANK.map(cause => CAUSE_STYLE[cause]);

/** The flag text of each primary cause code: the legend, "GC? likely" for the hollow one. */
const FLAG_TEXT_OF_CODE = STYLE_OF_CODE.map(style => flagText(style.legend, style.hollow));

/** The painter's default look: the phone overlay's glass cockpit. */
const COCKPIT_LOOK: GraphLook = {
  key: "cockpit",
  colours: GRAPH_COLOURS,
  hues: STYLE_OF_CODE.map(style => style.hue),
  fonts: GRAPH_FONTS
};

/**
 * The look of the paint in progress: its colours, cause hues and fonts, the first row inside the
 * span (0 unless a moving now hides older rows) and the end of the rows drawn (the window's count
 * unless a now before the newest row holds the newer ones back). Set by `paintGraph` before it
 * draws; one object for every paint, so nothing is allocated.
 */
const look: {
  colours: GraphPalette;
  hues: readonly string[];
  fonts: GraphFonts;
  firstRow: number;
  endRow: number;
} = {
  colours: GRAPH_COLOURS,
  hues: COCKPIT_LOOK.hues,
  fonts: GRAPH_FONTS.wide,
  firstRow: 0,
  endRow: 0
};

/** The y of each tape label drawn so far in one paint (module scratch, never reallocated). */
const TAPE_Y = new Float64Array(8);

/**
 * The y of a frame time in the plot of the current paint.
 *
 * @param state - The painter state holding the layout.
 * @param ms - A frame time, ms.
 * @returns The y, CSS px.
 * @example
 * ```ts
 * yOf({ py0: 20, py1: 89 }, 45); // 20: the top of the scale
 * ```
 */
function yOf(state: Pick<GraphState, "py0" | "py1">, ms: number): number {
  const clamped = Number.isFinite(ms) ? Math.min(Math.max(ms, 0), SCALE_MS) : 0;
  return state.py1 - (clamped / SCALE_MS) * (state.py1 - state.py0);
}

/**
 * Fills a vertical band from `top` to `bottom`; nothing when it is empty.
 *
 * @param g - The context.
 * @param colour - The fill.
 * @param x - Left, CSS px.
 * @param width - Width, CSS px.
 * @param top - Top y.
 * @param bottom - Bottom y.
 */
function band(
  g: GraphContext2D,
  colour: string,
  x: number,
  width: number,
  top: number,
  bottom: number
): void {
  if (bottom <= top) return;
  g.fillStyle = colour;
  g.fillRect(x, top, width, bottom - top);
}

/**
 * A filled triangle: apex at `(x, apexY)`, base `width` wide at `baseY`.
 *
 * @param g - The context.
 * @param x - Apex x.
 * @param apexY - Apex y.
 * @param baseY - Base y.
 * @param width - Base width.
 * @param colour - Fill.
 */
function caret(
  g: GraphContext2D,
  x: number,
  apexY: number,
  baseY: number,
  width: number,
  colour: string
): void {
  g.fillStyle = colour;
  g.beginPath();
  g.moveTo(x, apexY);
  g.lineTo(x + width / 2, baseY);
  g.lineTo(x - width / 2, baseY);
  g.closePath();
  g.fill();
}

/**
 * Measures the flag legends once per font (`state.measured` false).
 *
 * @param g - The context.
 * @param state - The painter state.
 */
function measureLegends(g: GraphContext2D, state: GraphState): void {
  g.font = look.fonts.flag;
  // An indexed loop, as everywhere in the painter: no iterator per measure.
  // eslint-disable-next-line unicorn/no-for-loop -- see above
  for (let index = 0; index < FLAG_TEXT_OF_CODE.length; index += 1) {
    state.legendWidth[index] = g.measureText(FLAG_TEXT_OF_CODE[index] ?? "").width;
  }
  state.measured = true;
}

/**
 * Step 1: the well over the whole canvas and the grid lines at 10, 20, 30 and 40 ms.
 *
 * @param g - The context.
 * @param view - The view.
 * @param state - The painter state.
 */
function paintWell(g: GraphContext2D, view: GraphView, state: GraphState): void {
  g.fillStyle = look.colours.well;
  g.fillRect(0, 0, view.width, view.height);
  for (let ms = GRID_STEP_MS; ms <= GRID_TOP_MS; ms += GRID_STEP_MS) {
    const y = yOf(state, ms);
    band(g, look.colours.grid, state.px0, state.px1 - state.px0, y, y + HAIRLINE);
  }
}

/**
 * A row's rest (`REST`); awake in a window without the column (an agent before the delta).
 *
 * @param window - The window.
 * @param row - The row.
 * @returns The rest state.
 */
function restAt(window: PerfWindowView, row: number): number {
  return window.rest === undefined ? REST.awake : cell(window.rest, row);
}

/**
 * Whether a row rests or is a break: no work to show, no alarm.
 *
 * @param rest - The row's rest.
 * @returns True for a resting row or a break.
 * @example
 * ```ts
 * isQuiet(REST.break); // true
 * ```
 */
function isQuiet(rest: number): boolean {
  return rest === REST.idle || rest === REST.break;
}

/**
 * A row's work, ms: JS plus GPU when the GPU is timed and measured, else JS. A frame's height and
 * colour come from its work, never from the gap before it.
 *
 * @param window - The window.
 * @param row - The row.
 * @returns The work, ms.
 */
function workOf(window: PerfWindowView, row: number): number {
  const js = cell(window.jsMs, row);
  const gpu = cell(window.gpuMs, row);
  return hasTimedGpu(window, row, gpu) ? js + gpu : js;
}

/**
 * Whether a row's GPU time counts in its stack: the page times its GPU, the row has a time, and the
 * time is no lone outlier (`isGpuNoise`: spec 03 delta item 8, drawn as a faint tick instead).
 *
 * @param window - The window.
 * @param row - The row.
 * @param gpu - The row's GPU time, ms.
 * @returns True when the GPU part is stacked.
 */
function hasTimedGpu(window: PerfWindowView, row: number, gpu: number): boolean {
  return window.gpuTimer && Number.isFinite(gpu) && !isGpuNoise(window, row);
}

/**
 * Step 3, one row that was not drawn: a well-coloured hole up to its budget and an amber caret
 * under the baseline.
 *
 * @param g - The context.
 * @param window - The window.
 * @param state - The painter state.
 * @param row - The row.
 */
function paintSkipped(
  g: GraphContext2D,
  window: PerfWindowView,
  state: GraphState,
  row: number
): void {
  const centre = rowCentre(state, window, row);
  const holeTop = yOf(state, cell(window.budgetMs, row)) - SKIP_HOLE_OVER;
  band(g, look.colours.well, centre - SKIP_HOLE_W / 2, SKIP_HOLE_W, holeTop, state.py1);
  const caretTop = state.py1 + SKIP_CARET_GAP;
  caret(g, centre, caretTop, caretTop + SKIP_CARET_H, SKIP_CARET_W, look.colours.amber);
}

/**
 * Step 2, one drawn row that is not a spike: idle over GPU over JS, stacked by lightness; without a
 * GPU timer or a GPU time, idle over JS. The idle part reaches the frame time but never past
 * `ceilingMs` (its budget; a resting row's, one frame of its rate): a wait for vsync or for the
 * next wake is not drawn as over-budget time. Work over the ceiling is drawn in full.
 *
 * @param g - The context.
 * @param window - The window.
 * @param state - The painter state.
 * @param row - The row.
 * @param ceilingMs - The highest frame time the idle part reaches, ms.
 */
function paintStack(
  g: GraphContext2D,
  window: PerfWindowView,
  state: GraphState,
  row: number,
  ceilingMs: number
): void {
  const left = rowLeft(state, window, row);
  const width = rowRight(state, window, row) - left + STACK_BLEED;
  const js = cell(window.jsMs, row);
  const gpu = cell(window.gpuMs, row);
  const stacked = hasTimedGpu(window, row, gpu);
  const work = stacked ? js + gpu : js;
  const yWork = yOf(state, work);
  const yJs = yOf(state, js);
  const top = Math.max(work, Math.min(cell(window.ms, row), ceilingMs));
  band(g, look.colours.idle, left, width, yOf(state, top), yWork);
  if (stacked) band(g, look.colours.gpu, left, width, yWork, yJs);
  band(g, look.colours.js, left, width, yJs, state.py1);
}

/**
 * Step 4b, a faint tick under the baseline (no flag, not a spike): an awake row's notable gap with
 * no work behind it (idle outline), or a lone GPU outlier (spec 03 delta item 8, GPU colour).
 *
 * @param g - The context.
 * @param window - The window.
 * @param state - The painter state.
 * @param row - The row.
 * @param colour - The tick's colour.
 */
function paintGapTick(
  g: GraphContext2D,
  window: PerfWindowView,
  state: GraphState,
  row: number,
  colour: string
): void {
  const x = rowCentre(state, window, row);
  band(g, colour, x, HAIRLINE, state.py1 + 1, state.py1 + 1 + GAP_TICK_H);
}

/**
 * Step 4b, a break (the browser made no frame): the baseline cut across the row and a double bar
 * at its middle.
 *
 * @param g - The context.
 * @param window - The window.
 * @param state - The painter state.
 * @param row - The row.
 */
function paintBreak(
  g: GraphContext2D,
  window: PerfWindowView,
  state: GraphState,
  row: number
): void {
  const left = rowLeft(state, window, row);
  const right = rowRight(state, window, row);
  band(g, look.colours.well, left, right - left, state.py1, state.py1 + HAIRLINE);
  const x = Math.round((left + right) / 2) - 1;
  const top = state.py1 - BREAK_BAR_UP;
  const bottom = state.py1 + BREAK_BAR_DOWN;
  band(g, look.colours.ink3, x, HAIRLINE, top, bottom);
  band(g, look.colours.ink3, x + BREAK_BAR_GAP, HAIRLINE, top, bottom);
}

/**
 * Step 2–3, one row by how it paced: a resting row as one quiet frame of its rate, an awake row
 * that was not drawn as a hole with a caret, a plain row as its stack (its notable gap as a faint
 * tick); a break is drawn after the baseline, a spike by the flags.
 *
 * @param g - The context.
 * @param window - The window.
 * @param state - The painter state.
 * @param row - The row.
 * @param rest - Its rest.
 */
function paintRow(
  g: GraphContext2D,
  window: PerfWindowView,
  state: GraphState,
  row: number,
  rest: number
): void {
  if (rest === REST.idle) {
    paintStack(g, window, state, row, cell(window.rateMs, row));
    return;
  }
  if (window.drawn[row] !== 1) {
    paintSkipped(g, window, state, row);
    return;
  }
  if (cell(window.cause, row) !== 0) return;
  paintStack(g, window, state, row, cell(window.budgetMs, row));
  if (rest === REST.awake && (cell(window.causes, row) & GAP_BIT) !== 0) {
    paintGapTick(g, window, state, row, look.colours.idleOutline);
  }
  if (isGpuNoise(window, row)) paintGapTick(g, window, state, row, look.colours.gpu);
}

/**
 * Steps 2–4: the rows (stacks, quiet resting frames, holes and carets, gap ticks), the baseline,
 * then the breaks across it.
 *
 * @param g - The context.
 * @param window - The window.
 * @param state - The painter state.
 */
function paintRows(g: GraphContext2D, window: PerfWindowView, state: GraphState): void {
  let breaks = 0;
  for (let row = look.firstRow; row < look.endRow; row += 1) {
    const rest = restAt(window, row);
    if (rest === REST.break) breaks += 1;
    else paintRow(g, window, state, row, rest);
  }
  band(g, look.colours.baseline, state.px0, state.px1 - state.px0, state.py1, state.py1 + 1);
  if (breaks === 0) return;
  for (let row = look.firstRow; row < look.endRow; row += 1) {
    if (restAt(window, row) === REST.break) paintBreak(g, window, state, row);
  }
}

/**
 * Step 5: the budget line per frame (magenta, 1.5 px) or its half (1 px dashed), stepping where a
 * row's own `budgetMs` changes; one path.
 *
 * @param g - The context.
 * @param window - The window.
 * @param state - The painter state.
 * @param share - 1 for the budget line, 0.5 for its half.
 */
function paintBudget(
  g: GraphContext2D,
  window: PerfWindowView,
  state: GraphState,
  share: number
): void {
  if (window.count === 0) return;
  g.strokeStyle = look.colours.magenta;
  const full = share === FULL_BUDGET;
  g.lineWidth = full ? BUDGET_LINE : HAIRLINE;
  g.setLineDash(full ? DASH_NONE : DASH_HALF);
  g.beginPath();
  for (let row = look.firstRow; row < look.endRow; row += 1) {
    const y = yOf(state, cell(window.budgetMs, row) * share);
    const left = rowLeft(state, window, row);
    if (row === look.firstRow) g.moveTo(left, y);
    else g.lineTo(left, y);
    g.lineTo(rowRight(state, window, row), y);
  }
  g.stroke();
  g.setLineDash(DASH_NONE);
}

/**
 * The label of a rate, built once per fps value; the cache starts over past 16 labels.
 *
 * @param state - The painter state.
 * @param fps - Frames per second.
 * @returns The label.
 */
function rateText(state: GraphState, fps: number): string {
  const known = state.rateText.get(fps);
  if (known !== undefined) return known;
  if (state.rateText.size >= MAX_RATE_LABELS) state.rateText.clear();
  const text = String(fps);
  state.rateText.set(fps, text);
  return text;
}

/**
 * Whether a rate switch gets a label: a rate of 1 to 1000 fps (a broken rate gets the mark only).
 *
 * @param fps - The new rate, fps.
 * @returns Whether to label it.
 * @example
 * ```ts
 * isLabelledRate(2000); // false
 * ```
 */
function isLabelledRate(fps: number): boolean {
  return fps >= 1 && fps <= MAX_LABELLED_FPS;
}

/**
 * Step 5b, one switch: a dashed magenta vertical at `x` across the plot.
 *
 * @param g - The context.
 * @param state - The painter state.
 * @param x - The switch's x.
 */
function paintRateMark(g: GraphContext2D, state: GraphState, x: number): void {
  g.strokeStyle = look.colours.magenta;
  g.lineWidth = HAIRLINE;
  g.setLineDash(DASH_FINE);
  g.beginPath();
  g.moveTo(x, state.py0);
  g.lineTo(x, state.py1);
  g.stroke();
  g.setLineDash(DASH_NONE);
}

/**
 * Step 5b: at every rate switch a dashed magenta vertical and the new rate's fps (1 to 1000 fps),
 * drawn left of the line when it would cross the tape.
 *
 * @param g - The context.
 * @param window - The window.
 * @param state - The painter state.
 * @param layout - The layout.
 */
function paintRateSwitches(
  g: GraphContext2D,
  window: PerfWindowView,
  state: GraphState,
  layout: Layout
): void {
  for (let row = Math.max(1, look.firstRow); row < look.endRow; row += 1) {
    const rate = cell(window.rateMs, row);
    if (Math.abs(rate - cell(window.rateMs, row - 1)) <= RATE_EPSILON) continue;
    const x = xOf(state, cell(window.t, row));
    paintRateMark(g, state, x);

    // The label: right of the line, or left of it when it would cross the tape.
    const flips = x + RATE_LABEL_GAP + layout.rateRoom > state.px1;
    g.font = look.fonts.rate;
    g.fillStyle = look.colours.magenta;
    g.textAlign = flips ? "right" : "left";
    g.textBaseline = "alphabetic";
    const fps = rateFps(rate);
    if (isLabelledRate(fps)) {
      const labelX = flips ? x - RATE_LABEL_GAP : x + RATE_LABEL_GAP;
      g.fillText(rateText(state, fps), labelX, state.py0 + RATE_LABEL_DROP);
    }
  }
}

/**
 * The row the cursor, the readout and the caption follow: the selected one, else the newest.
 *
 * @param window - The window.
 * @param view - The view.
 * @returns The row; −1 for an empty window.
 */
function focusRow(window: PerfWindowView, view: GraphView): number {
  return view.selected >= 0 && view.selected < window.count ? view.selected : window.count - 1;
}

/**
 * Step 7, the bar of one spike, as tall as its work: hollow for GC?, else filled with a tick at the
 * JS height when the GPU is timed; a red caret at the top of the plot for work over the scale.
 *
 * @param g - The context.
 * @param window - The window.
 * @param state - The painter state.
 * @param layout - The layout.
 * @param row - The spike row.
 * @param code - Its primary cause code.
 */
function paintSpikeBar(
  g: GraphContext2D,
  window: PerfWindowView,
  state: GraphState,
  layout: Layout,
  row: number,
  code: number
): void {
  const style = STYLE_OF_CODE[code - 1] ?? CAUSE_STYLE.gap;
  const hue = look.hues[code - 1] ?? style.hue;
  const left = rowCentre(state, window, row) - layout.bar / 2;
  const work = workOf(window, row);
  const top = yOf(state, work);
  if (style.hollow) {
    band(g, look.colours.well, left, layout.bar, top, state.py1);
    g.strokeStyle = hue;
    g.lineWidth = HAIRLINE;
    g.setLineDash(DASH_NONE);
    g.strokeRect(left, top, layout.bar, state.py1 - top);
  } else {
    band(g, hue, left, layout.bar, top, state.py1);
    const yJs = yOf(state, cell(window.jsMs, row));
    if (window.gpuTimer) band(g, look.colours.well, left, layout.bar, yJs, yJs + HAIRLINE);
  }
  if (work > SCALE_MS) {
    const centre = left + layout.bar / 2;
    caret(g, centre, state.py0, state.py0 + OVERFLOW_CARET_H, OVERFLOW_CARET_W, look.colours.red);
  }
}

/**
 * Step 7, a flag's box: filled in the cause colour when selected (the hollow GC? flag in its own
 * ground), bordered in the cause colour, dashed when hollow.
 *
 * @param g - The context.
 * @param style - The cause's style.
 * @param hue - The cause's hue in the paint's look.
 * @param left - The box's left, CSS px.
 * @param width - Its width.
 * @param height - Its height.
 * @param selected - Whether its row is the selected one.
 */
function paintFlagBox(
  g: GraphContext2D,
  style: CauseStyle,
  hue: string,
  left: number,
  width: number,
  height: number,
  selected: boolean
): void {
  const selectedGround = style.hollow ? look.colours.flagSelectedHollow : hue;
  g.fillStyle = selected ? selectedGround : look.colours.flagGround;
  g.fillRect(left, FLAG_TOP, width, height);
  g.strokeStyle = hue;
  g.lineWidth = style.hollow && selected ? FLAG_BORDER_SELECTED_HOLLOW : FLAG_BORDER;
  g.setLineDash(style.hollow ? DASH_HOLLOW : DASH_NONE);
  g.strokeRect(left, FLAG_TOP, width, height);
}

/**
 * Step 7, a flag's leader: a dashed hairline in the cause colour from the box down to the bar's top.
 *
 * @param g - The context.
 * @param hue - The cause's hue in the paint's look.
 * @param x - The bar's centre.
 * @param from - The box's bottom.
 * @param to - The bar's top.
 */
function paintFlagLeader(
  g: GraphContext2D,
  hue: string,
  x: number,
  from: number,
  to: number
): void {
  g.strokeStyle = hue;
  g.lineWidth = HAIRLINE;
  g.setLineDash(DASH_FINE);
  g.beginPath();
  g.moveTo(x, from);
  g.lineTo(x, to);
  g.stroke();
  g.setLineDash(DASH_NONE);
}

/**
 * Step 7, a flag's hit box for `spikeAt`; a state with no room left keeps no more.
 *
 * @param state - The painter state.
 * @param row - The spike row.
 * @param left - The box's left.
 * @param right - Its right.
 */
function keepFlagBox(state: GraphState, row: number, left: number, right: number): void {
  if (state.flagCount >= state.flagRow.length) return;
  state.flagRow[state.flagCount] = row;
  state.flagX0[state.flagCount] = left;
  state.flagX1[state.flagCount] = right;
  state.flagCount += 1;
}

/**
 * Step 7, the flag of one spike: its legend boxed in the cause colour (filled when selected, dashed
 * when hollow), clamped into the plot, a dashed leader down to the bar, and its hit box.
 *
 * @param g - The context.
 * @param window - The window.
 * @param state - The painter state.
 * @param layout - The layout.
 * @param row - The spike row.
 * @param code - Its primary cause code.
 * @param selected - Whether it is the selected row.
 */
function paintFlag(
  g: GraphContext2D,
  window: PerfWindowView,
  state: GraphState,
  layout: Layout,
  row: number,
  code: number,
  selected: boolean
): void {
  const style = STYLE_OF_CODE[code - 1] ?? CAUSE_STYLE.gap;
  const hue = look.hues[code - 1] ?? style.hue;
  const centre = rowCentre(state, window, row);
  const width = cell(state.legendWidth, code - 1) + layout.flagPad;
  const height = layout.flagBand - FLAG_INSET;
  const left = Math.min(Math.max(centre - width / 2, state.px0), state.px1 - width);
  paintFlagBox(g, style, hue, left, width, height, selected);
  paintFlagLeader(g, hue, centre, FLAG_TOP + height, yOf(state, workOf(window, row)));

  // The legend, on the cause colour's ground when selected, else in the cause colour.
  g.font = look.fonts.flag;
  g.fillStyle = selected && !style.hollow ? look.colours.flagGround : hue;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(FLAG_TEXT_OF_CODE[code - 1] ?? "", left + width / 2, FLAG_TOP + height / 2);
  keepFlagBox(state, row, left, left + width);
}

/**
 * Steps 6–7: the cursor at the focus row, then every spike, oldest first; a row held back by the
 * moving now gets neither. A cause code the editor does not know is skipped.
 *
 * @param g - The context.
 * @param window - The window.
 * @param view - The view.
 * @param state - The painter state.
 * @param layout - The layout.
 */
function paintSpikes(
  g: GraphContext2D,
  window: PerfWindowView,
  view: GraphView,
  state: GraphState,
  layout: Layout
): void {
  const focus = focusRow(window, view);
  if (focus >= 0 && focus < look.endRow) {
    band(g, look.colours.ink, rowCentre(state, window, focus), 1, state.py0, state.py1);
  }
  state.flagCount = 0;
  for (let index = 0; index < window.spikeCount; index += 1) {
    const row = cell(window.spikes, index);
    const code = cell(window.cause, row);
    const shown = row >= look.firstRow && row < look.endRow;
    if (code < 1 || code > STYLE_OF_CODE.length || !shown) continue;
    paintSpikeBar(g, window, state, layout, row, code);
    paintFlag(g, window, state, layout, row, code, row === view.selected);
  }
}

/**
 * A tape bug: a pentagon pointing at the plot, solid or outlined.
 *
 * @param g - The context.
 * @param state - The painter state.
 * @param y - Its middle.
 * @param solid - Filled (the budget) or outlined (its half).
 */
function bug(g: GraphContext2D, state: GraphState, y: number, solid: boolean): void {
  const { px1 } = state;
  g.beginPath();
  g.moveTo(px1 + BUG_NEAR, y - BUG_HALF);
  g.lineTo(px1 + BUG_FAR, y - BUG_HALF);
  g.lineTo(px1 + BUG_FAR, y + BUG_HALF);
  g.lineTo(px1 + BUG_NEAR, y + BUG_HALF);
  g.lineTo(px1 + BUG_TIP, y);
  g.closePath();
  if (solid) {
    g.fillStyle = look.colours.magenta;
    g.fill();
    return;
  }
  g.strokeStyle = look.colours.magenta;
  g.lineWidth = BUG_OUTLINE;
  g.setLineDash(DASH_NONE);
  g.stroke();
}

/**
 * Draws one tape label unless it comes closer than 9 px to a label already drawn.
 *
 * @param g - The context.
 * @param view - The view.
 * @param text - The label.
 * @param colour - Its colour.
 * @param y - Its y.
 * @param drawn - Labels drawn so far (their ys in `TAPE_Y`).
 * @returns Labels drawn after this one.
 */
function tapeLabel(
  g: GraphContext2D,
  view: GraphView,
  text: string,
  colour: string,
  y: number,
  drawn: number
): number {
  for (let index = 0; index < drawn; index += 1) {
    if (Math.abs(cell(TAPE_Y, index) - y) < TAPE_GAP) return drawn;
  }
  g.fillStyle = colour;
  g.fillText(text, view.width - TAPE_LABEL_INSET, y);
  TAPE_Y[drawn] = y;
  return drawn + 1;
}

/**
 * Step 8, the tape's body: its ground, the spine and a tick every 5 ms (long at multiples of 10).
 *
 * @param g - The context.
 * @param view - The view.
 * @param state - The painter state.
 */
function paintTapeTicks(g: GraphContext2D, view: GraphView, state: GraphState): void {
  const { px1 } = state;
  band(g, look.colours.tape, px1, view.width - px1, 0, view.height);
  band(g, look.colours.tapeInk, px1, HAIRLINE, state.py0, state.py1);
  for (let ms = 0; ms <= SCALE_MS; ms += TICK_STEP_MS) {
    const y = yOf(state, ms);
    const length = ms % MAJOR_TICK_MS === 0 ? MAJOR_TICK : MINOR_TICK;
    band(g, look.colours.tapeInk, px1, length, y, y + HAIRLINE);
  }
}

/**
 * The budget the tape labels: the newest row's, or the empty window's.
 *
 * @param window - The window.
 * @returns The budget, ms.
 */
function tapeBudgetOf(window: PerfWindowView): number {
  if (window.count === 0) return EMPTY_BUDGET_MS;
  return window.budgetMs[window.count - 1] ?? EMPTY_BUDGET_MS;
}

/**
 * Whether a fixed tape label is left out: a tall-plot label on a short plot, a wide-only label on
 * the phone.
 *
 * @param mark - The label.
 * @param showHalf - The plot is tall enough for the half budget and the middle labels.
 * @param wide - The graph is the tools strip's.
 * @returns Whether to leave it out.
 * @example
 * ```ts
 * isMarkHidden({ text: "25", ms: 25, tallOnly: true, wideOnly: true }, true, false); // true: phone
 * ```
 */
function isMarkHidden(mark: TapeMark, showHalf: boolean, wide: boolean): boolean {
  return (mark.tallOnly && !showHalf) || (mark.wideOnly && !wide);
}

/**
 * Step 8, the tape's labels: the newest budget first (so it wins over a neighbour closer than
 * 9 px), its half and the fixed labels; a short plot shows `0`, the budget and `40` only. The budget
 * texts are rebuilt only when the budget changed.
 *
 * @param g - The context.
 * @param view - The view.
 * @param state - The painter state.
 * @param budget - The newest budget, ms.
 */
function paintTapeLabels(
  g: GraphContext2D,
  view: GraphView,
  state: GraphState,
  budget: number
): void {
  if (budget !== state.tapeBudgetMs) {
    state.tapeBudgetMs = budget;
    state.tapeBudgetText = oneDecimal(budget);
    state.tapeHalfText = oneDecimal(budget / 2);
  }

  const showHalf = state.py1 - state.py0 >= SHORT_PLOT;
  const magenta = look.colours.magenta;
  g.font = look.fonts.tape;
  g.textAlign = "right";
  g.textBaseline = "middle";
  let drawn = tapeLabel(g, view, state.tapeBudgetText, magenta, yOf(state, budget), 0);
  if (showHalf) {
    drawn = tapeLabel(g, view, state.tapeHalfText, magenta, yOf(state, budget / 2), drawn);
  }

  // The fixed labels, an indexed loop over a module table: nothing allocated.
  // eslint-disable-next-line unicorn/no-for-loop -- see above
  for (let index = 0; index < TAPE_MARKS.length; index += 1) {
    const mark = TAPE_MARKS[index];
    if (mark === undefined || isMarkHidden(mark, showHalf, view.wide)) continue;
    drawn = tapeLabel(g, view, mark.text, look.colours.tapeInk, yOf(state, mark.ms), drawn);
  }
}

/**
 * Step 8, the tape's bugs: solid at the newest budget, outlined at its half.
 *
 * @param g - The context.
 * @param state - The painter state.
 * @param budget - The newest budget, ms.
 */
function paintTapeBugs(g: GraphContext2D, state: GraphState, budget: number): void {
  bug(g, state, yOf(state, budget), true);
  bug(g, state, yOf(state, budget / 2), false);
}

/**
 * Step 8: the tape — ground, spine, ticks every 5 ms, the labels and the two bugs.
 *
 * @param g - The context.
 * @param window - The window.
 * @param view - The view.
 * @param state - The painter state.
 */
function paintTape(
  g: GraphContext2D,
  window: PerfWindowView,
  view: GraphView,
  state: GraphState
): void {
  paintTapeTicks(g, view, state);
  paintTapeMarks(g, window, view, state);
}

/**
 * Step 8 without the tape's body: the labels and the bugs of the newest budget (the body is in a
 * static base layer).
 *
 * @param g - The context.
 * @param window - The window.
 * @param view - The view.
 * @param state - The painter state.
 */
function paintTapeMarks(
  g: GraphContext2D,
  window: PerfWindowView,
  view: GraphView,
  state: GraphState
): void {
  const budget = tapeBudgetOf(window);
  paintTapeLabels(g, view, state, budget);
  paintTapeBugs(g, state, budget);
}

/**
 * The readout colour of a row: quiet for a resting row or a break, amber for a frame not drawn, then
 * by its work against its own budget: red above twice it, amber above it, cyan otherwise.
 *
 * @param key - The readout's key: `IDLE_KEY`, `SKIP_KEY` or the frame time.
 * @param work - Its work, ms.
 * @param budget - Its own budget.
 * @returns The colour.
 * @example
 * ```ts
 * readoutColour(41.3, 34, 16.7); // "#FF4545": work over twice the budget
 * ```
 */
function readoutColour(key: number, work: number, budget: number): string {
  if (key === IDLE_KEY) return look.colours.ink2;
  if (key === SKIP_KEY) return look.colours.amber;
  if (work > 2 * budget) return look.colours.red;
  return work > budget ? look.colours.amber : look.colours.cyan;
}

/**
 * The readout's key of a row: `IDLE_KEY` for a resting row or a break, `SKIP_KEY` for an awake frame
 * not drawn, else its frame time in tenths.
 *
 * @param window - The window.
 * @param row - The row.
 * @returns The key.
 */
function readoutKey(window: PerfWindowView, row: number): number {
  if (isQuiet(restAt(window, row))) return IDLE_KEY;
  if (window.drawn[row] !== 1) return SKIP_KEY;
  return Math.round(cell(window.ms, row) * TENTHS) / TENTHS;
}

/**
 * The readout's text of a key.
 *
 * @param key - The key.
 * @returns IDLE, SKIP or the frame time with one decimal.
 */
function readoutTextOf(key: number): string {
  if (key === IDLE_KEY) return IDLE_TEXT;
  return key === SKIP_KEY ? SKIP_TEXT : oneDecimal(key);
}

/**
 * Step 9, the readout's box: black with a pointer to the left at `y`, a hairline outline.
 *
 * @param g - The context.
 * @param left - The box's left, CSS px (the pointer reaches 7 px further).
 * @param right - Its right.
 * @param y - Its middle.
 * @param half - Half its height.
 */
function readoutBox(g: GraphContext2D, left: number, right: number, y: number, half: number): void {
  g.fillStyle = look.colours.readout;
  g.beginPath();
  g.moveTo(left - READOUT_POINTER, y);
  g.lineTo(left, y - half);
  g.lineTo(right, y - half);
  g.lineTo(right, y + half);
  g.lineTo(left, y + half);
  g.closePath();
  g.fill();
  g.strokeStyle = look.colours.ink;
  g.lineWidth = HAIRLINE;
  g.setLineDash(DASH_NONE);
  g.stroke();
}

/**
 * Step 9: the readout box riding the tape at the focus row's frame time: `IDLE` for a resting row
 * or a break, `SKIP` for an awake frame not drawn, else the ms with one decimal, coloured by its
 * work. The text is rebuilt only when the value changed.
 *
 * @param g - The context.
 * @param window - The window.
 * @param view - The view.
 * @param state - The painter state.
 * @param layout - The layout.
 * @param row - The focus row.
 */
function paintReadout(
  g: GraphContext2D,
  window: PerfWindowView,
  view: GraphView,
  state: GraphState,
  layout: Layout,
  row: number
): void {
  // The text: IDLE, SKIP, or the frame time in tenths, rebuilt only when it changed.
  const ms = cell(window.ms, row);
  const key = readoutKey(window, row);
  if (key !== state.readoutMs) {
    state.readoutMs = key;
    state.readoutText = readoutTextOf(key);
  }

  // The box: on the tape at the frame time, kept inside the plot.
  const half = layout.readout / 2;
  const y = Math.min(Math.max(yOf(state, ms), state.py0 + half), state.py1 - half);
  const left = state.px1 + layout.readoutGap;
  const right = view.width - 1;
  readoutBox(g, left, right, y, half);

  // The value, coloured by the row's work against its own budget.
  g.font = look.fonts.readout;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = readoutColour(key, workOf(window, row), cell(window.budgetMs, row));
  g.fillText(state.readoutText, (left + right) / 2, y);
}

/**
 * Step 10: the caption `frame 4812`, plus `, spike 5/6` on a selected spike; rebuilt only when its
 * key changed.
 *
 * @param g - The context.
 * @param window - The window.
 * @param view - The view (its lead moves the caption right).
 * @param state - The painter state.
 * @param layout - The layout.
 * @param row - The focus row.
 */
function paintCaption(
  g: GraphContext2D,
  window: PerfWindowView,
  view: GraphView,
  state: GraphState,
  layout: Layout,
  row: number
): void {
  const frame = cell(window.frame, row);
  // Only a selected spike names its place (spec 03 delta item 11): with nothing selected the
  // counter reads "–/n", so the newest row's caption is its frame alone.
  const ordinal = row === view.selected ? spikeOrdinal(window, row) : 0;
  const count = window.spikeCount;
  const captionChanged =
    frame !== state.captionFrame ||
    ordinal !== state.captionOrdinal ||
    count !== state.captionCount;
  if (captionChanged) {
    state.captionFrame = frame;
    state.captionOrdinal = ordinal;
    state.captionCount = count;
    state.captionKey = captionKeyOf(frame, ordinal, count);
    state.captionText = captionOf(frame, ordinal, count);
  }
  g.font = look.fonts.tape;
  g.fillStyle = look.colours.ink2;
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
  const left = state.px0 + (view.leadPx ?? 0);
  g.fillText(state.captionText, left + CAPTION_INSET, state.py0 + layout.captionDy);
}

/**
 * Step 11: the time axis — the oldest second at the left (`oldest`), on the wide graph one label a
 * second (at most 60); `now` is `paintNow`. The oldest second marks a place (the plot's left edge),
 * so a sliding plot layer leaves it to the fixed layer (Delta 2026-10-18: on the A26 it jumped at
 * every paint). Labels are rebuilt only when the window length changed.
 *
 * @param g - The context.
 * @param view - The view.
 * @param state - The painter state.
 * @param oldest - Draw the oldest second at the left edge.
 */
function paintAxis(g: GraphContext2D, view: GraphView, state: GraphState, oldest: boolean): void {
  // The labels, one a second, rebuilt only for a new window length (the lead's time left out).
  const lead = view.leadPx ?? 0;
  const pxPerMs = (state.px1 - state.px0) / state.spanMs;
  const visibleMs = state.spanMs - lead / pxPerMs;
  const seconds = Math.min(Math.max(1, Math.round(visibleMs / SECOND_MS)), MAX_AXIS_SECONDS);
  if (seconds * SECOND_MS !== state.axisWindowMs) {
    state.axisWindowMs = seconds * SECOND_MS;
    state.axisText.length = 0;
    for (let second = seconds; second > 0; second -= 1) state.axisText.push(axisLabel(second));
  }

  // The oldest second at the left edge.
  const y = view.height - BASELINE_INSET;
  const { px0, px1 } = state;
  g.font = look.fonts.axis;
  g.fillStyle = look.colours.ink3;
  g.textBaseline = "alphabetic";
  g.textAlign = "left";
  if (oldest) g.fillText(state.axisText[0] ?? "", px0 + lead + AXIS_INSET, y);

  // The wide graph: every other second, centred on its time.
  if (view.wide) {
    g.textAlign = "center";
    for (let second = seconds - 1; second > 0; second -= 1) {
      g.fillText(state.axisText[seconds - second] ?? "", px1 - second * SECOND_MS * pxPerMs, y);
    }
  }
}

/**
 * Step 11, the axis's `now` at the plot's right edge: it marks a place, not a time, so a fixed layer
 * draws it.
 *
 * @param g - The context.
 * @param view - The view.
 * @param state - The painter state.
 */
function paintNow(g: GraphContext2D, view: GraphView, state: GraphState): void {
  g.font = look.fonts.axis;
  g.fillStyle = look.colours.ink3;
  g.textBaseline = "alphabetic";
  g.textAlign = "right";
  g.fillText(NOW_TEXT, state.px1 - AXIS_INSET, view.height - BASELINE_INSET);
}

/**
 * One item of the stack legend: an 8×8 swatch and its word.
 *
 * @param g - The context.
 * @param x - Left of the swatch.
 * @param y - The text baseline.
 * @param colour - The swatch colour.
 * @param word - The word.
 * @param outlined - Whether the swatch gets the idle outline.
 */
function legendItem(
  g: GraphContext2D,
  x: number,
  y: number,
  colour: string,
  word: string,
  outlined: boolean
): void {
  g.fillStyle = colour;
  g.fillRect(x, y - SWATCH, SWATCH, SWATCH);
  if (outlined) {
    const inner = SWATCH - 2 * SWATCH_OUTLINE_INSET;
    g.strokeStyle = look.colours.idleOutline;
    g.lineWidth = HAIRLINE;
    g.setLineDash(DASH_NONE);
    g.strokeRect(x + SWATCH_OUTLINE_INSET, y - SWATCH + SWATCH_OUTLINE_INSET, inner, inner);
  }
  g.fillStyle = look.colours.ink2;
  g.fillText(word, x + SWATCH + SWATCH_GAP, y);
}

/**
 * Step 12, phone only: the stack legend centred under the plot — JS, GPU (with a GPU timer) and idle.
 *
 * @param g - The context.
 * @param window - The window.
 * @param view - The view.
 * @param state - The painter state.
 */
function paintStackLegend(
  g: GraphContext2D,
  window: PerfWindowView,
  view: GraphView,
  state: GraphState
): void {
  const gpu = window.gpuTimer;
  const room = LEGEND_ROOM_JS + LEGEND_ROOM_IDLE + (gpu ? LEGEND_ROOM_GPU : 0);
  const y = view.height - BASELINE_INSET;
  let x = (state.px0 + (view.leadPx ?? 0) + state.px1) / 2 - room / 2;
  g.font = look.fonts.axis;
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
  legendItem(g, x, y, look.colours.js, LEGEND_JS, false);
  x += LEGEND_ROOM_JS;
  if (gpu) {
    legendItem(g, x, y, look.colours.gpu, LEGEND_GPU, false);
    x += LEGEND_ROOM_GPU;
  }
  legendItem(g, x, y, look.colours.idle, LEGEND_IDLE, true);
}

/**
 * The time a window's plot spans, ms (at least 1).
 *
 * @param window - The window.
 * @returns The span.
 */
function spanOf(window: PerfWindowView): number {
  return Math.max(MIN_SPAN_MS, window.endMs - window.startMs);
}

/**
 * The plot's width on a canvas of a visible width: the canvas less the plot's left edge and the
 * tape.
 *
 * @param width - The visible width, CSS px.
 * @param layout - The layout.
 * @returns At least 1 px.
 */
function plotWidth(width: number, layout: Layout): number {
  return Math.max(1, width - layout.tape - PLOT_LEFT);
}

/**
 * The CSS px a time covers on the time axis of a paint of this window at this visible width (no
 * lead): the slide distance of one tick. Pure, no allocation.
 *
 * @param window - The window to paint.
 * @param width - The visible width of the canvas, CSS px.
 * @param wide - The tools strip's layout.
 * @param ms - The time.
 * @returns CSS px.
 * @example
 * ```ts
 * msToPx(window, 273, false, 250); // 9.8 for a 6 s window on the phone card
 * ```
 */
export function msToPx(window: PerfWindowView, width: number, wide: boolean, ms: number): number {
  return (ms * plotWidth(width, wide ? WIDE : PHONE)) / spanOf(window);
}

/**
 * Lays out a paint in `state`: the plot box and the time axis, kept for spikeAt / rowAt. A lead
 * keeps the time scale of the visible width and reaches further back by the time it covers; a
 * moving now spans `view.spanMs` when given.
 *
 * @param window - The window.
 * @param view - The view.
 * @param state - The painter state.
 * @param layout - The layout.
 */
function layOut(window: PerfWindowView, view: GraphView, state: GraphState, layout: Layout): void {
  const lead = view.leadPx ?? 0;
  const now = view.nowMs;
  const span =
    now === undefined || view.spanMs === undefined
      ? spanOf(window)
      : Math.max(MIN_SPAN_MS, view.spanMs);
  const leadMs = lead === 0 ? 0 : (lead * span) / plotWidth(view.width - lead, layout);
  state.px0 = PLOT_LEFT;
  state.px1 = view.width - layout.tape;
  state.py0 = layout.flagBand + PLOT_TOP_GAP;
  state.py1 = view.height - layout.axis;
  state.flagBand = layout.flagBand;
  state.startMs = now === undefined ? window.startMs - leadMs : now - span - leadMs;
  state.spanMs = span + leadMs;
  // Under a moving now the newest row ends at its own end; the rest of the plot is still empty.
  state.edgeX = now === undefined ? state.px1 : Math.min(state.px1, xOf(state, window.endMs));
}

/**
 * The rows the moving now has reached: the count of rows that start before it (the newer ones are
 * held back until it reaches them).
 *
 * @param window - The window.
 * @param nowMs - The plot's right edge, page-clock ms.
 * @returns The end of the rows to draw (exclusive); 0 for an empty window.
 */
function rowsBefore(window: PerfWindowView, nowMs: number): number {
  let low = 0;
  let high = window.count;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (cell(window.t, middle) < nowMs) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * The first row inside the plot's span: the newest row starting at or before its left edge (rows
 * older than it are off the plot under a moving now).
 *
 * @param window - The window.
 * @param state - The painter state holding the paint's time origin.
 * @returns The row; 0 for an empty window.
 */
function firstVisibleRow(window: PerfWindowView, state: GraphState): number {
  let low = 0;
  let high = window.count - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (cell(window.t, middle) <= state.startMs) low = middle;
    else high = middle - 1;
  }
  return low;
}

/**
 * Sets the look of this paint: its colours, cause hues and the fonts of its size; another look
 * resets the state's text cache (the legends are measured again in its fonts).
 *
 * @param state - The painter state.
 * @param lk - The look of this paint.
 * @param wide - The tools strip's size.
 */
function useLook(state: GraphState, lk: GraphLook, wide: boolean): void {
  if (state.lookKey !== lk.key) {
    resetGraphText(state);
    state.lookKey = lk.key;
  }
  look.colours = lk.colours;
  look.hues = lk.hues;
  look.fonts = wide ? lk.fonts.wide : lk.fonts.phone;
}

/**
 * The fixed layer: what marks a place rather than a time — the tape with its readout, the caption,
 * `now` and the stack legend — over a transparent ground.
 *
 * @param g - The context.
 * @param window - The window.
 * @param view - The view.
 * @param state - The painter state.
 * @param layout - The layout.
 * @param focus - The focus row (−1 for none).
 */
function paintFixed(
  g: GraphContext2D,
  window: PerfWindowView,
  view: GraphView,
  state: GraphState,
  layout: Layout,
  focus: number
): void {
  paintTape(g, window, view, state);
  if (focus >= 0) {
    paintReadout(g, window, view, state, layout, focus);
    paintCaption(g, window, view, state, layout, focus);
  }
  paintAxis(g, view, state, true);
  paintNow(g, view, state);
  if (!view.wide) paintStackLegend(g, window, view, state);
}

/**
 * Paints the frame graph in one pass and records the flag boxes and the layout in `state`: the
 * whole graph, or one layer of it (`view.layer`): the plot of a canvas that slides (what is tied to
 * time: the rows, the budget lines, the flags and the axis's seconds), or what stays of a canvas
 * laid over it that does not (the tape and its readout, the caption, `now` and the stack legend, on
 * a transparent ground); or, for the tools page's interpolated drawing, its static `base` (the well,
 * the grid, the tape's body) and the `over` layer painted each frame on a blit of it. `view.look`
 * picks the cockpit's or the editor's light or dark colours, cause hues and fonts; `view.nowMs`
 * moves the time axis's right edge (only the rows inside the span are drawn; rows it has not reached
 * are held back) and `view.spanMs` sets the time the plot spans under it.
 * The caller owns the canvas: it sizes the backing store and sets the dpr transform first (and
 * clears a fixed layer's canvas); the painter works in CSS px. Allocates nothing per paint; label
 * strings are built only when their cached key changed and the legends are measured only while
 * `state.measured` is false.
 *
 * @param g - The 2D context.
 * @param window - The window (perf's, inside `readWindow`, or the tools page's own).
 * @param view - Size, layout, the selected row and the layer.
 * @param state - The painter state of this canvas.
 */
export function paintGraph(
  g: GraphContext2D,
  window: PerfWindowView,
  view: GraphView,
  state: GraphState
): void {
  const layout = view.wide ? WIDE : PHONE;
  const layer = view.layer ?? "all";
  const focus = focusRow(window, view);
  useLook(state, view.look ?? COCKPIT_LOOK, view.wide);
  layOut(window, view, state, layout);
  look.firstRow = view.nowMs === undefined ? 0 : firstVisibleRow(window, state);
  look.endRow = view.nowMs === undefined ? window.count : rowsBefore(window, view.nowMs);
  if (layer === "base") {
    paintWell(g, view, state);
    paintTapeTicks(g, view, state);
    return;
  }
  if (layer === "fixed") {
    paintFixed(g, window, view, state, layout, focus);
    return;
  }

  // Paint layers, back to front (spec 03 "What it paints", steps 1–12); the plot layer leaves out
  // the fixed layer's steps, the over layer the base layer's.
  const all = layer === "all";
  const over = layer === "over";
  if (!state.measured) measureLegends(g, state);
  if (!over) paintWell(g, view, state);
  paintRows(g, window, state);
  paintBudget(g, window, state, FULL_BUDGET);
  paintBudget(g, window, state, HALF_BUDGET);
  paintRateSwitches(g, window, state, layout);
  paintSpikes(g, window, view, state, layout);
  if (all) paintTape(g, window, view, state);
  if (over) paintTapeMarks(g, window, view, state);
  if ((all || over) && focus >= 0) {
    paintReadout(g, window, view, state, layout, focus);
    paintCaption(g, window, view, state, layout, focus);
  }
  paintAxis(g, view, state, all || over);
  if (!all && !over) return;
  paintNow(g, view, state);
  if (!view.wide) paintStackLegend(g, window, view, state);
}

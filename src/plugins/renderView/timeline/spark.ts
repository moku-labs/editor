/**
 * @file renderView timeline — the sparklines of the cards on the shared axis (spec 09 § M9): the
 * card-owned columns (160 over the view's span) filled in one indexed pass from the history or a side
 * series, the marks of their columns (GC diamonds, hollow when inferred from a heap drop; shader
 * compile diamonds), and the painters — a sparkline (baseline, resting columns, an optional reference
 * line, the selection band, the area and line in the source tint, an optional trend, the marks at
 * `top + 4`, the cursor) and the Device load card's stacked CPU steps and GPU busy and clock steps
 * (one flat step per 1 s sample; a missing second is a gap, never a ramp). Allocation-free.
 */
import { frameFpsAt } from "../derive/header";
import { firstVisibleRow, rowFrom, rowOfFrame } from "../series/rows";
import type { GcColumn, LoadSeries, SeriesColumn } from "../series/types";
import type { PerfHistory } from "../source/contract";
import { REST } from "../source/contract";
import type { FrameRange } from "../view/types";
import { DASH, diamond, hline } from "./draw";
import type { PaintContext, TimelineLayout } from "./layout";
import { plotBottom, xOf } from "./layout";
import type { PaletteKey } from "./palette";
import type { PaintScene } from "./scene";

/** Columns of a sparkline (spec 09 § M12). */
export const SPARK_COLUMNS = 160;

/** A sample older than this before a column, ms, does not hold over it (a stopped feed). */
const HOLD_MS = 2000;

/** One second, ms: a 1 Hz sample's step. */
const STEP_MS = 1000;

/** A gap between two 1 Hz samples longer than this, ms, is a missing second. */
const GAP_MS = 1500;

/** The share of a missed frame's rate the FPS sparkline shows for its column. */
const MISSED_SHARE = 0.88;

/** Half the diagonal of a column's mark, px, and its centre below the plot's top ("top + 4"). */
const MARK_R = 3.5;
const MARK_Y = 4;

/** The view of the sparkline being painted (reused): its start and span, ms. */
const VIEW = { startMs: 0, span: 1 };

/** The alphas of a sparkline: resting columns, the reference line, the selection, the area, the cursor. */
const REST_ALPHA = 0.2;
const REFERENCE_ALPHA = 0.7;
const SELECTION_ALPHA = 0.14;
const AREA_ALPHA = 0.12;
const CURSOR_ALPHA = 0.55;

/** The width of a sparkline's line, px. */
const LINE_WIDTH = 1.5;

/** The width of the trend and of the app's CPU step line, px. */
const TREND_WIDTH = 1.25;

/** The alphas of the Device load card: the app's CPU area, the other processes' (surfaceflinger). */
const CPU_APP_ALPHA = 0.55;
const CPU_FLINGER_ALPHA = 0.6;

/**
 * The mark a sparkline column carries (spec 09 § M9): none, a GC the engine reported (a filled teal
 * diamond), a GC inferred from a heap drop (a hollow teal diamond, dashed), or a shader compile inside
 * a frame (a pick-blue diamond).
 *
 * @example
 * ```ts
 * columns.marks[column] === SPARK_MARK.inferredGc; // a wired phone's CDP heap drop
 * ```
 */
export const SPARK_MARK = { none: 0, gc: 1, inferredGc: 2, compile: 3 } as const;

/**
 * The columns of one card's sparkline, owned by the card and filled per paint: a value per column
 * (NaN: no data), whether the column only rested, and its mark (SPARK_MARK).
 *
 * @example
 * ```ts
 * const columns: SparkColumns = createSparkColumns();
 * columns.v.length; // 160
 * ```
 */
export type SparkColumns = {
  readonly v: Float32Array;
  readonly rested: Uint8Array;
  readonly marks: Uint8Array;
  /**
   * The start of column 0, source-clock ms: a whole number of columns from time 0, so a column
   * keeps its frames while the view scrolls (set by every fill).
   */
  startMs: number;
  /** One column's time, ms: the view's span over `SPARK_COLUMNS − 1` (set by every fill). */
  stepMs: number;
};

/**
 * A straight trend over a sparkline (the Memory card's baseline after GC): its value at a time and
 * its slope per ms, on the sparkline's own scale.
 *
 * @example
 * ```ts
 * const baseline: SparkTrend = { t: 79_350, value: 27.4, perMs: 1.8 / 60_000 }; // +1.8 MB/min
 * ```
 */
export type SparkTrend = { readonly t: number; readonly value: number; readonly perMs: number };

/**
 * How a sparkline is drawn: its scale, a reference line (NaN for none), the colour of its area and
 * line, and an optional trend (drawn while its slope is a number).
 *
 * @example
 * ```ts
 * const fps: SparkStyle = { min: 0, max: 138, reference: 120, colour: "src" };
 * ```
 */
export type SparkStyle = {
  readonly min: number;
  readonly max: number;
  readonly reference: number;
  readonly colour: PaletteKey;
  /** Dashed `[4, 3]` in warn from the view's start to its end; none when undefined. */
  readonly trend?: SparkTrend | undefined;
};

/**
 * Makes a card's columns.
 *
 * @returns The columns, every one empty.
 * @example
 * ```ts
 * createSparkColumns().v[0]; // NaN
 * ```
 */
export function createSparkColumns(): SparkColumns {
  return {
    v: new Float32Array(SPARK_COLUMNS).fill(Number.NaN),
    rested: new Uint8Array(SPARK_COLUMNS),
    marks: new Uint8Array(SPARK_COLUMNS),
    startMs: 0,
    stepMs: 1
  };
}

/**
 * Lays the columns on the data's time for a view: one column is the span over 159, and column 0
 * starts at the last whole column at or before the view's start. The 160 columns then cover the
 * view, and a scroll moves them with their frames instead of regrouping the frames at every paint
 * (a sparkline wobbling while it scrolls).
 *
 * @param columns - The card's columns.
 * @param startMs - The view's start.
 * @param span - The view's span.
 */
function layColumns(columns: SparkColumns, startMs: number, span: number): void {
  columns.stepMs = span / (SPARK_COLUMNS - 1);
  columns.startMs = Math.floor(startMs / columns.stepMs) * columns.stepMs;
}

/**
 * The column of a time.
 *
 * @param columns - The laid-out columns.
 * @param t - Source-clock ms.
 * @returns 0..159; outside the columns clamped.
 */
function columnOf(columns: SparkColumns, t: number): number {
  return Math.min(
    SPARK_COLUMNS - 1,
    Math.max(0, Math.floor((t - columns.startMs) / columns.stepMs))
  );
}

/**
 * The x of a column's middle in a view.
 *
 * @param layout - The geometry.
 * @param columns - The laid-out columns.
 * @param index - The column.
 * @param startMs - The view's start.
 * @param span - The view's span.
 * @returns CSS px (the first and last columns may lie partly outside the plot).
 */
function columnX(
  layout: TimelineLayout,
  columns: SparkColumns,
  index: number,
  startMs: number,
  span: number
): number {
  return xOf(layout, columns.startMs + (index + 0.5) * columns.stepMs, startMs, span);
}

/**
 * Fills the columns from a side series: each column holds the newest sample at or before its end,
 * when that sample is not older than 2 s before the column; NaN otherwise (a gap stays a gap). The
 * last paint's marks are cleared.
 *
 * @param columns - The card's columns.
 * @param column - The series.
 * @param startMs - The view's start.
 * @param span - The view's span.
 * @example
 * ```ts
 * fillFromSeries(columns, series.textures, 74_000, 6000); // the Textures card's MB
 * ```
 */
export function fillFromSeries(
  columns: SparkColumns,
  column: SeriesColumn,
  startMs: number,
  span: number
): void {
  columns.rested.fill(0);
  columns.marks.fill(SPARK_MARK.none);
  layColumns(columns, startMs, span);
  let sample = 0;
  for (let index = 0; index < SPARK_COLUMNS; index += 1) {
    const from = columns.startMs + index * columns.stepMs;
    const to = from + columns.stepMs;
    while (sample + 1 < column.count && (column.t[sample + 1] ?? 0) <= to) sample += 1;
    const t = column.t[sample] ?? Number.NaN;
    const held = sample < column.count && t <= to && t >= from - HOLD_MS;
    columns.v[index] = held ? (column.v[sample] ?? Number.NaN) : Number.NaN;
  }
}

/** What a frame column keeps: its worst frame, its effective fps, or its most draw calls. */
type FrameMeasure = "worst" | "fps" | "draws";

/**
 * The value one row adds to its column for a measure: for "fps" the rate it ran at (a resting row's
 * from its budget), × 0.88 when an awake row missed its budget.
 *
 * @param history - The history.
 * @param row - The row.
 * @param measure - What the card charts.
 * @returns The value; NaN when the row has none.
 */
function rowValue(history: PerfHistory, row: number, measure: FrameMeasure): number {
  if (measure === "worst") return history.ms[row] ?? Number.NaN;
  if (measure === "draws") return history.draws[row] ?? Number.NaN;
  const fps = frameFpsAt(history, row);
  const missed =
    (history.ms[row] ?? 0) > (history.budgetMs[row] ?? 0) && history.rest[row] === REST.awake;
  return missed ? fps * MISSED_SHARE : fps;
}

/**
 * Fills the columns from the history's rows in view, one indexed pass: per column the worst frame
 * ms (`"worst"`), the effective fps (`"fps"`: the rate, × 0.88 for a column whose worst frame missed
 * its budget, the rest rate for a column that rested), or the most draw calls (`"draws"`); a column
 * rested when all its rows did. The last paint's marks are cleared.
 *
 * @param columns - The card's columns.
 * @param history - The history.
 * @param measure - What the card charts.
 * @param view - The view's start and span.
 * @param view.startMs - Its start.
 * @param view.span - Its span.
 * @example
 * ```ts
 * fillFromFrames(columns, history, "worst", { startMs: 74_000, span: 6000 }); // the Frame time card
 * ```
 */
export function fillFromFrames(
  columns: SparkColumns,
  history: PerfHistory,
  measure: FrameMeasure,
  view: { readonly startMs: number; readonly span: number }
): void {
  // Reset the columns and lay them on the view's time.
  columns.v.fill(Number.NaN);
  columns.rested.fill(1);
  columns.marks.fill(SPARK_MARK.none);
  layColumns(columns, view.startMs, view.span);

  // Fold each row into its column, keeping the worst value.
  const end = rowFrom(history, view.startMs + view.span);
  for (let row = firstVisibleRow(history, columns.startMs); row < end; row += 1) {
    const index = columnOf(columns, history.t[row] ?? 0);
    const rest = history.rest[row];
    const resting = rest === REST.idle || rest === REST.break;
    if (!resting) columns.rested[index] = 0;
    const value = rowValue(history, row, measure);
    if (Number.isNaN(value)) continue;
    const held = columns.v[index] ?? Number.NaN;
    const worse = measure === "fps" ? value < held : value > held;
    if (Number.isNaN(held) || worse) columns.v[index] = value;
  }

  // A column without a value did not rest: it has no data.
  for (let index = 0; index < SPARK_COLUMNS; index += 1) {
    if (Number.isNaN(columns.v[index] ?? Number.NaN)) columns.rested[index] = 0;
  }
}

/**
 * Keeps one frame's summed pass GPU in its column when it is the column's largest.
 *
 * @param columns - The card's columns.
 * @param history - The history.
 * @param frame - The frame.
 * @param sum - Its summed pass GPU ms.
 */
function keepPassSum(
  columns: SparkColumns,
  history: PerfHistory,
  frame: number,
  sum: number
): void {
  const row = rowOfFrame(history, frame);
  if (row < 0 || sum <= 0) return;
  const index = columnOf(columns, history.t[row] ?? 0);
  const held = columns.v[index] ?? Number.NaN;
  if (Number.isNaN(held) || sum > held) columns.v[index] = sum;
}

/**
 * Fills the columns with the frames' summed pass GPU ms, the column's largest. The last paint's marks
 * are cleared.
 *
 * @param columns - The card's columns.
 * @param history - The history.
 * @param view - The view's start and span.
 * @param view.startMs - Its start.
 * @param view.span - Its span.
 * @example
 * ```ts
 * fillPassGpu(columns, history, { startMs: 74_000, span: 6000 }); // the GPU passes card
 * ```
 */
export function fillPassGpu(
  columns: SparkColumns,
  history: PerfHistory,
  view: { readonly startMs: number; readonly span: number }
): void {
  // Reset the columns and lay them on the view's time.
  columns.v.fill(Number.NaN);
  columns.rested.fill(0);
  columns.marks.fill(SPARK_MARK.none);
  layColumns(columns, view.startMs, view.span);

  // Sum each frame's passes and keep the column's largest sum (the last frame flushed after).
  const first = history.frame[firstVisibleRow(history, columns.startMs)] ?? 0;
  const last = history.frame[rowFrom(history, view.startMs + view.span) - 1] ?? -1;
  let frame = -1;
  let sum = 0;
  for (let pass = 0; pass < history.passCount; pass += 1) {
    const passFrame = history.passFrame[pass] ?? 0;
    if (passFrame < first || passFrame > last) continue;
    if (passFrame !== frame) {
      keepPassSum(columns, history, frame, sum);
      frame = passFrame;
      sum = 0;
    }
    const gpu = history.passGpuMs[pass] ?? Number.NaN;
    if (Number.isFinite(gpu)) sum += gpu;
  }
  keepPassSum(columns, history, frame, sum);
}

/**
 * Marks the columns of the GCs in view (the Memory card's GC diamonds, after its fill): the history's
 * `gc` events and the series' GCs (a wired phone's, hollow when inferred from a heap drop); a GC the
 * engine reported wins a column it shares with an inferred one.
 *
 * @param columns - The card's filled columns.
 * @param history - The history (its `gc` events).
 * @param gcs - The GC series.
 * @param view - The view's start and span.
 * @param view.startMs - Its start.
 * @param view.span - Its span.
 * @example
 * ```ts
 * fillFromSeries(columns, series.heap, startMs, span);
 * markGcs(columns, history, series.gcs, { startMs, span }); // the Memory card
 * ```
 */
export function markGcs(
  columns: SparkColumns,
  history: PerfHistory,
  gcs: GcColumn,
  view: { readonly startMs: number; readonly span: number }
): void {
  const end = view.startMs + view.span;
  for (let index = 0; index < history.eventCount; index += 1) {
    const event = history.events[index];
    if (event?.kind !== "gc" || event.t < view.startMs || event.t > end) continue;
    columns.marks[columnOf(columns, event.t)] = SPARK_MARK.gc;
  }
  for (let index = 0; index < gcs.count; index += 1) {
    const t = gcs.t[index] ?? 0;
    if (t < view.startMs || t > end) continue;
    const column = columnOf(columns, t);
    if (columns.marks[column] === SPARK_MARK.gc) continue;
    columns.marks[column] = gcs.inferred[index] === 1 ? SPARK_MARK.inferredGc : SPARK_MARK.gc;
  }
}

/**
 * Marks the columns of the shader compiles inside a frame in view (the GPU passes card's compile
 * diamonds, after its fill); a compile while loading (`boot`) cost no frame and is left out.
 *
 * @param columns - The card's filled columns.
 * @param history - The history (its `shader` events).
 * @param view - The view's start and span.
 * @param view.startMs - Its start.
 * @param view.span - Its span.
 * @example
 * ```ts
 * fillPassGpu(columns, history, view);
 * markCompiles(columns, history, view); // the GPU passes card
 * ```
 */
export function markCompiles(
  columns: SparkColumns,
  history: PerfHistory,
  view: { readonly startMs: number; readonly span: number }
): void {
  const end = view.startMs + view.span;
  for (let index = 0; index < history.eventCount; index += 1) {
    const event = history.events[index];
    if (event?.kind !== "shader" || event.boot || event.t < view.startMs || event.t > end) continue;
    columns.marks[columnOf(columns, event.t)] = SPARK_MARK.compile;
  }
}

/**
 * The y of a value on a sparkline's scale.
 *
 * @param layout - The geometry.
 * @param style - The scale.
 * @param value - The value.
 * @returns CSS px.
 */
function yOfValue(layout: TimelineLayout, style: SparkStyle, value: number): number {
  const share =
    (Math.min(Math.max(value, style.min), style.max) - style.min) / (style.max - style.min || 1);
  return plotBottom(layout) - share * layout.plot.h;
}

/**
 * Closes a run of columns down to the baseline (from its last column back to its first); nothing
 * when no run is open. Reads the view from `VIEW`.
 *
 * @param g - The context.
 * @param layout - The geometry.
 * @param columns - The laid-out columns.
 * @param first - The run's first column; −1 for none.
 * @param last - Its last column.
 */
function closeRun(
  g: PaintContext,
  layout: TimelineLayout,
  columns: SparkColumns,
  first: number,
  last: number
): void {
  if (first < 0) return;
  const bottom = plotBottom(layout);
  g.lineTo(columnX(layout, columns, last, VIEW.startMs, VIEW.span), bottom);
  g.lineTo(columnX(layout, columns, first, VIEW.startMs, VIEW.span), bottom);
  g.closePath();
}

/**
 * The path of the columns: a line through each column's middle, broken at a gap; with `close`, each
 * run closed down to the baseline and filled. Reads the view from `VIEW`.
 *
 * @param g - The context.
 * @param layout - The geometry.
 * @param columns - The columns.
 * @param style - The scale.
 * @param close - Fill the area under each run instead of stroking the line.
 */
function columnPath(
  g: PaintContext,
  layout: TimelineLayout,
  columns: SparkColumns,
  style: SparkStyle,
  close: boolean
): void {
  const { startMs, span } = VIEW;
  let runStart = -1;
  g.beginPath();
  for (let index = 0; index <= SPARK_COLUMNS; index += 1) {
    const value = index < SPARK_COLUMNS ? (columns.v[index] ?? Number.NaN) : Number.NaN;
    const x = columnX(layout, columns, index, startMs, span);
    // A gap ends the run: closed down to the baseline when filling.
    if (Number.isNaN(value)) {
      if (close) closeRun(g, layout, columns, runStart, index - 1);
      runStart = -1;
      continue;
    }
    if (runStart < 0) {
      runStart = index;
      g.moveTo(x, yOfValue(layout, style, value));
    } else g.lineTo(x, yOfValue(layout, style, value));
  }
  if (close) g.fill();
  else g.stroke();
}

/**
 * The trend: a straight line dashed `[4, 3]` in warn, 1.25 px, from its value at the view's start
 * to its value at the view's end (clamped to the scale).
 *
 * @param g - The context.
 * @param layout - The geometry.
 * @param style - The scale and the trend.
 * @param scene - The view and the palette.
 */
function paintTrend(
  g: PaintContext,
  layout: TimelineLayout,
  style: SparkStyle,
  scene: PaintScene
): void {
  const { trend } = style;
  if (trend === undefined || !Number.isFinite(trend.perMs)) return;
  const start = scene.endMs - scene.span;
  g.globalAlpha = 1;
  g.strokeStyle = scene.palette.warn;
  g.lineWidth = TREND_WIDTH;
  g.setLineDash(DASH.trend);
  g.beginPath();
  g.moveTo(0, yOfValue(layout, style, trend.value + trend.perMs * (start - trend.t)));
  g.lineTo(
    layout.plot.w,
    yOfValue(layout, style, trend.value + trend.perMs * (scene.endMs - trend.t))
  );
  g.stroke();
  g.setLineDash(DASH.none);
}

/**
 * The marks of the columns: a diamond at the column's middle, `top + 4` — teal for a GC (hollow and
 * dashed when inferred), pick-blue for a compile. Reads the view from `VIEW`.
 *
 * @param g - The context.
 * @param layout - The geometry.
 * @param columns - The columns.
 * @param scene - The palette.
 */
function paintMarks(
  g: PaintContext,
  layout: TimelineLayout,
  columns: SparkColumns,
  scene: PaintScene
): void {
  const { palette } = scene;
  const y = layout.plot.y + MARK_Y;
  g.globalAlpha = 1;
  g.lineWidth = 1;
  for (let index = 0; index < SPARK_COLUMNS; index += 1) {
    const mark = columns.marks[index] ?? SPARK_MARK.none;
    if (mark === SPARK_MARK.none) continue;
    const colour = mark === SPARK_MARK.compile ? palette.pickBlue : palette.teal;
    const hollow = mark === SPARK_MARK.inferredGc;
    g.fillStyle = colour;
    g.strokeStyle = colour;
    g.setLineDash(hollow ? DASH.leader : DASH.none);
    diamond(g, columnX(layout, columns, index, VIEW.startMs, VIEW.span), y, MARK_R, hollow);
  }
  g.setLineDash(DASH.none);
}

/** The x range of the selection (reused). */
const SELECTED = { left: 0, right: 0 };

/**
 * Writes the selection's x range on a sparkline into SELECTED.
 *
 * @param history - The history.
 * @param layout - The geometry.
 * @param selection - The selection.
 * @param scene - The view.
 * @returns False when none of it is held.
 */
function selectedSpan(
  history: PerfHistory,
  layout: TimelineLayout,
  selection: FrameRange,
  scene: PaintScene
): boolean {
  const first = rowOfFrame(history, selection.from);
  const last = rowOfFrame(history, selection.to);
  if (first < 0 || last < 0) return false;
  const start = scene.endMs - scene.span;
  SELECTED.left = xOf(layout, history.t[first] ?? 0, start, scene.span);
  SELECTED.right = xOf(layout, (history.t[last] ?? 0) + (history.ms[last] ?? 0), start, scene.span);
  return true;
}

/**
 * The sparkline's baseline, 1 px in line-2.
 *
 * @param g - The context.
 * @param layout - The geometry.
 * @param scene - The palette.
 */
function paintBaseline(g: PaintContext, layout: TimelineLayout, scene: PaintScene): void {
  g.globalAlpha = 1;
  g.setLineDash(DASH.none);
  g.strokeStyle = scene.palette.line2;
  g.lineWidth = 1;
  hline(g, plotBottom(layout) + 0.5, 0, layout.plot.w);
}

/**
 * The columns that only rested, in the edge colour at 20 %, each one column wide at its time. Reads the view from `VIEW`.
 *
 * @param g - The context.
 * @param layout - The geometry.
 * @param columns - The laid-out columns.
 * @param scene - The view and the palette.
 */
function paintRestedColumns(
  g: PaintContext,
  layout: TimelineLayout,
  columns: SparkColumns,
  scene: PaintScene
): void {
  const step = (columns.stepMs / scene.span) * layout.plot.w;
  g.globalAlpha = REST_ALPHA;
  g.fillStyle = scene.palette.edge;
  for (let index = 0; index < SPARK_COLUMNS; index += 1) {
    if (columns.rested[index] !== 1) continue;
    const left = columnX(layout, columns, index, VIEW.startMs, VIEW.span) - step / 2;
    g.fillRect(left, layout.plot.y, step, layout.plot.h);
  }
  g.globalAlpha = 1;
}

/**
 * The reference line, dashed `[3, 3]` in the muted ink at 70 %; none when the style has none.
 *
 * @param g - The context.
 * @param layout - The geometry.
 * @param style - The scale and the reference.
 * @param scene - The palette.
 */
function paintReference(
  g: PaintContext,
  layout: TimelineLayout,
  style: SparkStyle,
  scene: PaintScene
): void {
  if (Number.isNaN(style.reference)) return;
  g.globalAlpha = REFERENCE_ALPHA;
  g.strokeStyle = scene.palette.muted;
  g.setLineDash(DASH.reference);
  hline(g, yOfValue(layout, style, style.reference), 0, layout.plot.w);
  g.setLineDash(DASH.none);
  g.globalAlpha = 1;
}

/**
 * Whether a selection is set and some of it is held (its x range then in SELECTED).
 *
 * @param history - The history.
 * @param layout - The geometry.
 * @param selection - The selection; undefined for none.
 * @param scene - The view.
 * @returns True when the band is drawn.
 */
function hasSelectedSpan(
  history: PerfHistory,
  layout: TimelineLayout,
  selection: FrameRange | undefined,
  scene: PaintScene
): boolean {
  return selection !== undefined && selectedSpan(history, layout, selection, scene);
}

/**
 * The selection band over SELECTED's x range, the accent at 14 %, at least 1 px wide.
 *
 * @param g - The context.
 * @param layout - The geometry.
 * @param scene - The palette.
 */
function paintSelectionBand(g: PaintContext, layout: TimelineLayout, scene: PaintScene): void {
  g.globalAlpha = SELECTION_ALPHA;
  g.fillStyle = scene.palette.accent;
  g.fillRect(SELECTED.left, 0, Math.max(1, SELECTED.right - SELECTED.left), layout.height);
  g.globalAlpha = 1;
}

/**
 * The area under the columns (the tint at 12 %) and their line (1.5 px).
 *
 * @param g - The context.
 * @param layout - The geometry.
 * @param columns - The laid-out columns.
 * @param style - The scale and the colour.
 * @param scene - The palette.
 */
function paintAreaAndLine(
  g: PaintContext,
  layout: TimelineLayout,
  columns: SparkColumns,
  style: SparkStyle,
  scene: PaintScene
): void {
  const colour = scene.palette[style.colour];
  g.globalAlpha = AREA_ALPHA;
  g.fillStyle = colour;
  columnPath(g, layout, columns, style, true);
  g.globalAlpha = 1;
  g.strokeStyle = colour;
  g.lineWidth = LINE_WIDTH;
  columnPath(g, layout, columns, style, false);
}

/**
 * The shared cursor at a source time, the ink at 55 %, across the whole canvas.
 *
 * @param g - The context.
 * @param layout - The geometry.
 * @param hoverMs - The source time under the pointer.
 * @param scene - The view and the palette.
 */
function paintCursor(
  g: PaintContext,
  layout: TimelineLayout,
  hoverMs: number,
  scene: PaintScene
): void {
  const x = xOf(layout, hoverMs, scene.endMs - scene.span, scene.span);
  g.globalAlpha = CURSOR_ALPHA;
  g.strokeStyle = scene.palette.ink;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(x, 0);
  g.lineTo(x, layout.height);
  g.stroke();
  g.globalAlpha = 1;
}

/**
 * Paints a sparkline: the baseline, resting columns (the edge colour at 20 %), the reference line
 * (dashed `[3, 3]`, muted at 70 %), the selection band, the area (the tint at 12 %) and the line
 * (1.5 px), the trend (dashed `[4, 3]` in warn), the columns' marks (diamonds at `top + 4`) and the
 * shared cursor.
 *
 * @param g - The canvas context.
 * @param layout - The canvas's geometry (`sparkLayout`).
 * @param columns - The card's filled columns.
 * @param style - The scale, the reference and the colour.
 * @param scene - The view and the palette.
 * @param marks - The selection and the hovered time.
 * @param marks.history - The history (the selection's rows).
 * @param marks.selection - The selection; undefined for none.
 * @param marks.hoverMs - The source time under the pointer; undefined for none.
 */
export function paintSpark(
  g: PaintContext,
  layout: TimelineLayout,
  columns: SparkColumns,
  style: SparkStyle,
  scene: PaintScene,
  marks: {
    readonly history: PerfHistory;
    readonly selection: FrameRange | undefined;
    readonly hoverMs: number | undefined;
  }
): void {
  VIEW.startMs = scene.endMs - scene.span;
  VIEW.span = scene.span;
  paintBaseline(g, layout, scene);

  // The first and last columns reach past the plot: everything up to the cursor is clipped to it.
  g.save();
  g.beginPath();
  g.rect(0, 0, layout.plot.w, layout.height);
  g.clip();
  paintRestedColumns(g, layout, columns, scene);
  paintReference(g, layout, style, scene);
  if (hasSelectedSpan(marks.history, layout, marks.selection, scene))
    paintSelectionBand(g, layout, scene);
  paintAreaAndLine(g, layout, columns, style, scene);
  paintTrend(g, layout, style, scene);
  paintMarks(g, layout, columns, scene);
  g.restore();

  if (marks.hoverMs !== undefined) paintCursor(g, layout, marks.hoverMs, scene);
}

/** The scale of a step painter: the value at the bottom and at the top of the plot. */
type StepScale = { readonly min: number; readonly max: number };

/**
 * The y of a value on a step scale.
 *
 * @param layout - The geometry.
 * @param scale - The scale.
 * @param value - The value.
 * @returns CSS px.
 */
function stepY(layout: TimelineLayout, scale: StepScale, value: number): number {
  const share =
    (Math.min(Math.max(value, scale.min), scale.max) - scale.min) / (scale.max - scale.min || 1);
  return plotBottom(layout) - share * layout.plot.h;
}

/**
 * The end of sample `index`'s step: the next sample, or one second on for the newest; a missing
 * second (the next sample more than 1.5 s on) ends it after one second.
 *
 * @param column - The series.
 * @param index - The sample.
 * @returns Source-clock ms.
 */
function stepEnd(column: SeriesColumn, index: number): number {
  const t = column.t[index] ?? 0;
  const next = index + 1 < column.count ? (column.t[index + 1] ?? t) : Number.POSITIVE_INFINITY;
  return next - t > GAP_MS ? t + STEP_MS : next;
}

/**
 * The steps of the samples in view, summed with the ones below (`base`, the stacked share): a flat
 * segment per sample, a gap where a sample is NaN or a second is missing. Strokes the top line, or
 * with `fill` closes each step down to its base and fills it.
 *
 * @param g - The context.
 * @param layout - The geometry.
 * @param scene - The view.
 * @param layers - The series stacked in order; the last is the one drawn.
 * @param scale - The scale.
 * @param fill - Fill the step down to the layers under it.
 */
function paintSteps(
  g: PaintContext,
  layout: TimelineLayout,
  scene: PaintScene,
  layers: readonly SeriesColumn[],
  scale: StepScale,
  fill: boolean
): void {
  const top = layers.at(-1);
  if (top === undefined) return;
  const start = scene.endMs - scene.span;
  g.beginPath();
  for (let index = 0; index < top.count; index += 1) {
    const t = top.t[index] ?? 0;
    const end = stepEnd(top, index);
    const value = top.v[index] ?? Number.NaN;
    if (end < start || t > scene.endMs || Number.isNaN(value)) continue;
    const below = stackedBelow(layers, index);
    const left = Math.max(0, xOf(layout, t, start, scene.span));
    const right = Math.min(layout.plot.w, xOf(layout, end, start, scene.span));
    const y = stepY(layout, scale, below + value);
    g.moveTo(left, y);
    g.lineTo(right, y);
    if (!fill) continue;
    g.lineTo(right, stepY(layout, scale, below));
    g.lineTo(left, stepY(layout, scale, below));
    g.closePath();
  }
  if (fill) g.fill();
  else g.stroke();
}

/**
 * The sum of the layers under the top one at a sample (a missing reading adds nothing).
 *
 * @param layers - The series stacked in order.
 * @param index - The sample.
 * @returns The stacked value under the top layer.
 */
function stackedBelow(layers: readonly SeriesColumn[], index: number): number {
  let below = 0;
  for (let layer = 0; layer < layers.length - 1; layer += 1) {
    const value = layers[layer]?.v[index] ?? Number.NaN;
    if (!Number.isNaN(value)) below += value;
  }
  return below;
}

/** The CPU scale: % of all cores. */
const CPU_SCALE: StepScale = { min: 0, max: 100 };

/** The stacked layers of the CPU painter, reused: app, app + renderer, all three. */
const APP: SeriesColumn[] = [];
const APP_RENDERER: SeriesColumn[] = [];
const ALL: SeriesColumn[] = [];

/**
 * The Device load card's CPU half: stacked step areas of `pct` (% of all cores, 0–100): app in the
 * source tint at 55 %, the WebView renderer in phase-1 at 55 %, surfaceflinger in the edge colour at
 * 60 %; then a 1.25 px step line of the app in the tint.
 *
 * @param g - The canvas context.
 * @param layout - The canvas's geometry.
 * @param load - The load series.
 * @param scene - The view and the palette.
 */
export function paintCpuSteps(
  g: PaintContext,
  layout: TimelineLayout,
  load: LoadSeries,
  scene: PaintScene
): void {
  const { palette } = scene;
  APP[0] = load.cpuApp;
  APP_RENDERER[0] = load.cpuApp;
  APP_RENDERER[1] = load.cpuRenderer;
  ALL[0] = load.cpuApp;
  ALL[1] = load.cpuRenderer;
  ALL[2] = load.cpuFlinger;
  g.setLineDash(DASH.none);
  g.globalAlpha = CPU_APP_ALPHA;
  g.fillStyle = palette.src;
  paintSteps(g, layout, scene, APP, CPU_SCALE, true);
  g.fillStyle = palette.phase1;
  paintSteps(g, layout, scene, APP_RENDERER, CPU_SCALE, true);
  g.globalAlpha = CPU_FLINGER_ALPHA;
  g.fillStyle = palette.edge;
  paintSteps(g, layout, scene, ALL, CPU_SCALE, true);
  g.globalAlpha = 1;
  g.strokeStyle = palette.src;
  g.lineWidth = TREND_WIDTH;
  paintSteps(g, layout, scene, APP, CPU_SCALE, false);
}

/** The single layers of the GPU painter (reused). */
const BUSY_LAYER: SeriesColumn[] = [];
const MHZ_LAYER: SeriesColumn[] = [];

/** The GPU clock's scale (reused). */
const MHZ_SCALE = { min: 0, max: 1 };

/**
 * The Device load card's GPU half: the busy % as an area in the tint at 12 % with a 1.5 px step
 * line, and the clock as a 1.5 px warn step line on its own scale `minMhz…maxMhz`.
 *
 * @param g - The canvas context.
 * @param layout - The canvas's geometry.
 * @param load - The load series.
 * @param scene - The view and the palette.
 * @param range - The clock's range (telemetry's `minMhz`, `maxMhz`); null ends for the series' own.
 * @param range.minMhz - The lowest clock.
 * @param range.maxMhz - The highest clock.
 */
export function paintGpuSteps(
  g: PaintContext,
  layout: TimelineLayout,
  load: LoadSeries,
  scene: PaintScene,
  range: { readonly minMhz: number | null; readonly maxMhz: number | null }
): void {
  const { palette } = scene;
  BUSY_LAYER[0] = load.gpuBusy;
  MHZ_LAYER[0] = load.gpuMhz;
  g.setLineDash(DASH.none);
  g.globalAlpha = AREA_ALPHA;
  g.fillStyle = palette.src;
  paintSteps(g, layout, scene, BUSY_LAYER, CPU_SCALE, true);
  g.globalAlpha = 1;
  g.strokeStyle = palette.src;
  g.lineWidth = LINE_WIDTH;
  paintSteps(g, layout, scene, BUSY_LAYER, CPU_SCALE, false);
  MHZ_SCALE.min = range.minMhz ?? 0;
  MHZ_SCALE.max = range.maxMhz ?? Math.max(1, MHZ_SCALE.min * 2);
  g.strokeStyle = palette.warn;
  paintSteps(g, layout, scene, MHZ_LAYER, MHZ_SCALE, false);
}

/**
 * @file renderView timeline — the sparklines of the cards on the shared axis (spec 09 § M9): the
 * card-owned columns (160 over the view's span) filled in one indexed pass from the history or a side
 * series, and the painters — a sparkline (baseline, resting columns, an optional reference line, the
 * selection band, the area and line in the source tint, the cursor) and the Device load card's
 * stacked CPU steps and GPU busy and clock steps (one flat step per 1 s sample; a missing second is
 * a gap, never a ramp). Allocation-free.
 */
import { firstVisibleRow, rowFrom, rowOfFrame } from "../series/rows";
import type { LoadSeries, SeriesColumn } from "../series/types";
import type { PerfHistory } from "../source/contract";
import { REST, rateFps } from "../source/contract";
import type { FrameRange } from "../view/types";
import { DASH, hline } from "./draw";
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

/**
 * The columns of one card's sparkline, owned by the card and filled per paint: a value per column
 * (NaN: no data) and whether the column only rested.
 *
 * @example
 * ```ts
 * const columns: SparkColumns = createSparkColumns();
 * columns.v.length; // 160
 * ```
 */
export type SparkColumns = { readonly v: Float32Array; readonly rested: Uint8Array };

/**
 * How a sparkline is drawn: its scale, a reference line (NaN for none) and the colour of its area
 * and line.
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
    rested: new Uint8Array(SPARK_COLUMNS)
  };
}

/**
 * The column of a time in a view.
 *
 * @param t - Source-clock ms.
 * @param startMs - The view's start.
 * @param span - The view's span.
 * @returns 0..159; outside the view clamped.
 */
function columnOf(t: number, startMs: number, span: number): number {
  return Math.min(
    SPARK_COLUMNS - 1,
    Math.max(0, Math.floor(((t - startMs) / span) * SPARK_COLUMNS))
  );
}

/**
 * Fills the columns from a side series: each column holds the newest sample at or before its end,
 * when that sample is not older than 2 s before the column; NaN otherwise (a gap stays a gap).
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
  let sample = 0;
  for (let index = 0; index < SPARK_COLUMNS; index += 1) {
    const from = startMs + (index / SPARK_COLUMNS) * span;
    const to = from + span / SPARK_COLUMNS;
    while (sample + 1 < column.count && (column.t[sample + 1] ?? 0) <= to) sample += 1;
    const t = column.t[sample] ?? Number.NaN;
    const held = sample < column.count && t <= to && t >= from - HOLD_MS;
    columns.v[index] = held ? (column.v[sample] ?? Number.NaN) : Number.NaN;
  }
}

/** What a frame column keeps: its worst frame, its effective fps, or its most draw calls. */
type FrameMeasure = "worst" | "fps" | "draws";

/**
 * The value one row adds to its column for a measure.
 *
 * @param history - The history.
 * @param row - The row.
 * @param measure - What the card charts.
 * @returns The value; NaN when the row has none.
 */
function rowValue(history: PerfHistory, row: number, measure: FrameMeasure): number {
  if (measure === "worst") return history.ms[row] ?? Number.NaN;
  if (measure === "draws") return history.draws[row] ?? Number.NaN;
  const fps = rateFps(history.rateMs[row] ?? 0);
  const missed =
    (history.ms[row] ?? 0) > (history.budgetMs[row] ?? 0) && history.rest[row] === REST.awake;
  return missed ? fps * MISSED_SHARE : fps;
}

/**
 * Fills the columns from the history's rows in view, one indexed pass: per column the worst frame
 * ms (`"worst"`), the effective fps (`"fps"`: the rate, × 0.88 for a column whose worst frame missed
 * its budget, the rest rate for a column that rested), or the most draw calls (`"draws"`); a column
 * rested when all its rows did.
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
  columns.v.fill(Number.NaN);
  columns.rested.fill(1);
  const end = rowFrom(history, view.startMs + view.span);
  for (let row = firstVisibleRow(history, view.startMs); row < end; row += 1) {
    const index = columnOf(history.t[row] ?? 0, view.startMs, view.span);
    const rest = history.rest[row];
    const resting = rest === REST.idle || rest === REST.break;
    if (!resting) columns.rested[index] = 0;
    const value = rowValue(history, row, measure);
    if (Number.isNaN(value)) continue;
    const held = columns.v[index] ?? Number.NaN;
    const worse = measure === "fps" ? value < held : value > held;
    if (Number.isNaN(held) || worse) columns.v[index] = value;
  }
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
 * @param view - The view's start and span.
 * @param view.startMs - Its start.
 * @param view.span - Its span.
 */
function keepPassSum(
  columns: SparkColumns,
  history: PerfHistory,
  frame: number,
  sum: number,
  view: { readonly startMs: number; readonly span: number }
): void {
  const row = rowOfFrame(history, frame);
  if (row < 0 || sum <= 0) return;
  const index = columnOf(history.t[row] ?? 0, view.startMs, view.span);
  const held = columns.v[index] ?? Number.NaN;
  if (Number.isNaN(held) || sum > held) columns.v[index] = sum;
}

/**
 * Fills the columns with the frames' summed pass GPU ms, the column's largest.
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
  columns.v.fill(Number.NaN);
  columns.rested.fill(0);
  const first = history.frame[firstVisibleRow(history, view.startMs)] ?? 0;
  const last = history.frame[rowFrom(history, view.startMs + view.span) - 1] ?? -1;
  let frame = -1;
  let sum = 0;
  for (let pass = 0; pass < history.passCount; pass += 1) {
    const passFrame = history.passFrame[pass] ?? 0;
    if (passFrame < first || passFrame > last) continue;
    if (passFrame !== frame) {
      keepPassSum(columns, history, frame, sum, view);
      frame = passFrame;
      sum = 0;
    }
    const gpu = history.passGpuMs[pass] ?? Number.NaN;
    if (Number.isFinite(gpu)) sum += gpu;
  }
  keepPassSum(columns, history, frame, sum, view);
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
 * The path of the columns: a line through each column's middle, broken at a gap; with `close`, each
 * run closed down to the baseline and filled.
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
  const step = layout.plot.w / SPARK_COLUMNS;
  const bottom = plotBottom(layout);
  let runStart = -1;
  g.beginPath();
  for (let index = 0; index <= SPARK_COLUMNS; index += 1) {
    const value = index < SPARK_COLUMNS ? (columns.v[index] ?? Number.NaN) : Number.NaN;
    const x = (index + 0.5) * step;
    if (Number.isNaN(value)) {
      if (close && runStart >= 0) {
        g.lineTo((index - 0.5) * step, bottom);
        g.lineTo((runStart + 0.5) * step, bottom);
        g.closePath();
      }
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
 * Paints a sparkline: the baseline, resting columns (the edge colour at 20 %), the reference line
 * (dashed `[3, 3]`, muted at 70 %), the selection band, the area (the tint at 12 %) and the line
 * (1.5 px), and the shared cursor.
 *
 * @param g - The canvas context.
 * @param layout - The canvas's geometry (`sparkLayout`).
 * @param columns - The card's filled columns.
 * @param style - The scale, the reference and the colour.
 * @param scene - The view, the palette; `selection` and `hoverMs` from Mission control.
 * @param marks - The selection and the hovered time.
 * @param marks.history - The history (the selection's rows).
 * @param marks.selection - The selection; undefined for none.
 * @param marks.hoverMs - The source time under the pointer; undefined for none.
 * @example
 * ```ts
 * fillFromFrames(columns, history, "worst", { startMs, span });
 * paintSpark(g, layout, columns, { min: 0, max: 36, reference: 16.7, colour: "src" }, scene, mission);
 * ```
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
  const { palette } = scene;
  const bottom = plotBottom(layout);
  const step = layout.plot.w / SPARK_COLUMNS;
  g.globalAlpha = 1;
  g.setLineDash(DASH.none);
  g.strokeStyle = palette.line2;
  g.lineWidth = 1;
  hline(g, bottom + 0.5, 0, layout.plot.w);
  g.globalAlpha = 0.2;
  g.fillStyle = palette.edge;
  for (let index = 0; index < SPARK_COLUMNS; index += 1) {
    if (columns.rested[index] === 1) g.fillRect(index * step, layout.plot.y, step, layout.plot.h);
  }
  g.globalAlpha = 1;
  if (!Number.isNaN(style.reference)) {
    g.globalAlpha = 0.7;
    g.strokeStyle = palette.muted;
    g.setLineDash(DASH.reference);
    hline(g, yOfValue(layout, style, style.reference), 0, layout.plot.w);
    g.setLineDash(DASH.none);
    g.globalAlpha = 1;
  }
  if (
    marks.selection !== undefined &&
    selectedSpan(marks.history, layout, marks.selection, scene)
  ) {
    g.globalAlpha = 0.14;
    g.fillStyle = palette.accent;
    g.fillRect(SELECTED.left, 0, Math.max(1, SELECTED.right - SELECTED.left), layout.height);
    g.globalAlpha = 1;
  }
  const colour = palette[style.colour];
  g.globalAlpha = 0.12;
  g.fillStyle = colour;
  columnPath(g, layout, columns, style, true);
  g.globalAlpha = 1;
  g.strokeStyle = colour;
  g.lineWidth = 1.5;
  columnPath(g, layout, columns, style, false);
  if (marks.hoverMs === undefined) return;
  const x = xOf(layout, marks.hoverMs, scene.endMs - scene.span, scene.span);
  g.globalAlpha = 0.55;
  g.strokeStyle = palette.ink;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(x, 0);
  g.lineTo(x, layout.height);
  g.stroke();
  g.globalAlpha = 1;
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
 * @example
 * ```ts
 * paintCpuSteps(g, sparkLayout(440, 46, 2), mission.series.load, scene);
 * ```
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
  g.globalAlpha = 0.55;
  g.fillStyle = palette.src;
  paintSteps(g, layout, scene, APP, CPU_SCALE, true);
  g.fillStyle = palette.phase1;
  paintSteps(g, layout, scene, APP_RENDERER, CPU_SCALE, true);
  g.globalAlpha = 0.6;
  g.fillStyle = palette.edge;
  paintSteps(g, layout, scene, ALL, CPU_SCALE, true);
  g.globalAlpha = 1;
  g.strokeStyle = palette.src;
  g.lineWidth = 1.25;
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
 * @example
 * ```ts
 * paintGpuSteps(g, layout, mission.series.load, scene, { minMhz: 221, maxMhz: 949 });
 * ```
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
  g.globalAlpha = 0.12;
  g.fillStyle = palette.src;
  paintSteps(g, layout, scene, BUSY_LAYER, CPU_SCALE, true);
  g.globalAlpha = 1;
  g.strokeStyle = palette.src;
  g.lineWidth = 1.5;
  paintSteps(g, layout, scene, BUSY_LAYER, CPU_SCALE, false);
  MHZ_SCALE.min = range.minMhz ?? 0;
  MHZ_SCALE.max = range.maxMhz ?? Math.max(1, MHZ_SCALE.min * 2);
  g.strokeStyle = palette.warn;
  paintSteps(g, layout, scene, MHZ_LAYER, MHZ_SCALE, false);
}

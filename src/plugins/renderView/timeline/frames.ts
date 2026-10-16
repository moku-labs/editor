/**
 * @file renderView timeline — paints the frame timeline (spec 09 § M8 items 1–12) in one pass on
 * the display clock: the grid and the axis fixed to the right edge, resting runs and breaks, the bars
 * (one per frame, or 2 px columns of each column's worst frame when rows outnumber pixels), the
 * budget step line, then the marks (`marks.ts`), the selection, the source-switch marker and the
 * cursor. Rows newer than the view's end are not drawn yet (the playout delay); rows older than the
 * view are skipped by a binary search. Allocation-free: strings come from the label caches.
 */
import { firstVisibleRow, rowFrom } from "../series/rows";
import type { PerfHistory } from "../source/contract";
import { REST, rateFps, spikeCause } from "../source/contract";
import type { MissionState } from "../types";
import { at, DASH, hline, label, paintCursor, paintMarker, paintSelection, vline } from "./draw";
import { axisText, labelOf, msText } from "./labels";
import type { PaintContext, TimelineLayout } from "./layout";
import { plotBottom, xOf, yMaxOf, yOf } from "./layout";
import { paintFlags, paintGcLane, paintRates, paintRecording } from "./marks";
import { causeColour } from "./palette";
import type { PaintScene } from "./scene";

/** The grid's ms lines and their gutter labels (those ≤ yMax are drawn). */
const GRID_MS: readonly number[] = [0, 8.3, 16.7, 33.3];
const GRID_TEXT: readonly string[] = ["0 ms", "8.3", "16.7", "33.3"];

/** CSS px per row below which bars become 2 px columns of the worst frame. */
const PX_PER_ROW = 1.6;

/** The width of a column of the worst frame, px, and the bar drawn in it. */
const COLUMN_PX = 2;
const COLUMN_BAR = 1.6;

/** A budget above this, ms, is a rest budget: dashed and muted. */
const REST_BUDGET_MS = 20;

/**
 * The axis tick step of a span: 1 s at 6 s, 5 s at 30 s, 20 s at 2 min.
 *
 * @param span - The view's span, ms.
 * @returns ms between ticks.
 */
function tickStep(span: number): number {
  if (span <= 6000) return 1000;
  return span <= 30_000 ? 5000 : 20_000;
}

/** Frames a GC event names inside the view, collected once per paint (indexes up to `gcCount`). */
const GC_FRAMES = new Uint32Array(256);
let gcCount = 0;

/**
 * The rows a paint draws: from the first visible to the first that starts after the view's end.
 * One object, reused.
 */
const ROWS = { first: 0, end: 0, yMax: 36 };

/**
 * The budget of the newest awake row in the view (the scale's top follows it; the Frame time card's
 * sparkline takes the same scale and reference).
 *
 * @param history - The history.
 * @param first - The first row drawn.
 * @param end - The row after the last.
 * @returns ms; 16.7 without one.
 * @example
 * ```ts
 * yMaxOf(newestAwakeBudget(history, firstVisibleRow(history, start), rowFrom(history, end))); // 36 at 60 fps
 * ```
 */
export function newestAwakeBudget(history: PerfHistory, first: number, end: number): number {
  for (let row = end - 1; row >= first; row -= 1) {
    const rest = history.rest[row];
    if (rest === REST.awake || rest === REST.woke) return history.budgetMs[row] ?? 16.7;
  }
  return 16.7;
}

/**
 * Collects the frames GC events name inside the view (for the GC pause part of their bars).
 *
 * @param history - The history.
 * @param startMs - The view's start.
 * @param endMs - The view's end.
 */
function collectGcFrames(history: PerfHistory, startMs: number, endMs: number): void {
  gcCount = 0;
  for (let index = 0; index < history.eventCount && gcCount < GC_FRAMES.length; index += 1) {
    const event = history.events[index];
    if (event?.kind !== "gc" || event.frame === null || event.t < startMs || event.t > endMs)
      continue;
    GC_FRAMES[gcCount] = event.frame;
    gcCount += 1;
  }
}

/**
 * Whether a GC event names a frame.
 *
 * @param frame - The frame.
 * @returns Whether its bar has a GC pause.
 */
function isGcFrame(frame: number): boolean {
  for (let index = 0; index < gcCount; index += 1) if (GC_FRAMES[index] === frame) return true;
  return false;
}

/**
 * The grid at 0, 8.3, 16.7 and 33.3 ms (the ones ≤ yMax; 0 full, the others at 70 %) with their
 * labels in the gutter, the gutter rule and the GC lane's rule.
 *
 * @param g - The context.
 * @param layout - The geometry.
 * @param scene - The scene.
 * @param yMax - The scale's top.
 */
function paintGrid(g: PaintContext, layout: TimelineLayout, scene: PaintScene, yMax: number): void {
  const { palette } = scene;
  const { w } = layout.plot;
  g.strokeStyle = palette.line2;
  g.lineWidth = 1;
  g.setLineDash(DASH.none);
  // An indexed loop, as in every paint: no iterator per frame.
  // eslint-disable-next-line unicorn/no-for-loop -- allocation-free paint
  for (let index = 0; index < GRID_MS.length; index += 1) {
    const ms = GRID_MS[index] ?? 0;
    if (ms > yMax) continue;
    const y = Math.round(yOf(layout, ms, yMax)) + 0.5;
    g.globalAlpha = index === 0 ? 1 : 0.7;
    hline(g, y, 0, w);
    g.globalAlpha = 1;
    label(g, "mono500", palette.text2, GRID_TEXT[index] ?? "", at(w + 7, y, "left"));
  }
  vline(g, w + 0.5, 0, plotBottom(layout) + layout.lane);
  hline(g, plotBottom(layout) + layout.lane + 0.5, 0, w);
}

/**
 * The axis: ticks every step fixed to the right edge (so the data scrolls under them), "now" or
 * "view end" at the right, "−k s" centred (left-aligned near the left edge).
 *
 * @param g - The context.
 * @param layout - The geometry.
 * @param scene - The scene.
 */
function paintAxis(g: PaintContext, layout: TimelineLayout, scene: PaintScene): void {
  const { palette, span, labels } = scene;
  const { w } = layout.plot;
  const top = plotBottom(layout) + layout.lane;
  const y = layout.height - layout.axis / 2;
  const step = tickStep(span);
  g.fillStyle = palette.text2;
  label(g, "mono500", palette.text2, scene.live ? "now" : "view end", at(w, y, "right"));
  for (let ago = step; ago < span; ago += step) {
    const x = w - (ago / span) * w;
    g.fillStyle = palette.line2;
    g.fillRect(Math.round(x), top, 1, 4);
    const text = labelOf(labels.axis, ago / 1000, ago / 1000, axisText);
    label(
      g,
      "mono500",
      palette.text2,
      text,
      at(x < 30 ? Math.max(x, 2) : x, y, x < 30 ? "left" : "center")
    );
  }
}

/**
 * The label of a resting run: "Resting at {fps} fps, budget {budget} ms".
 *
 * @param key - fps × 10 000 + budget in tenths.
 * @returns The label.
 */
function restingText(key: number): string {
  const fps = Math.floor(key / 10_000);
  return `Resting at ${fps} fps, budget ${msText((key % 10_000) / 10)} ms`;
}

/**
 * The label of a break: "Break {s} s".
 *
 * @param tenths - Its length in tenths of a second.
 * @returns The label.
 */
function breakText(tenths: number): string {
  return `Break ${msText(tenths / 10)} s`;
}

/** The label key spaces of runs in the flag cache (flags use codes 1–7 × 10⁶). */
const RESTING_KEYS = 20_000_000;
const BREAK_KEYS = 40_000_000;

/**
 * One resting run or break: a band in the edge colour at 12 % from `TOP − 6` to the baseline, and
 * its label inside when the run is wider than 60 px, clipped to the run.
 *
 * @param g - The context.
 * @param layout - The geometry.
 * @param scene - The scene.
 * @param run - The run's rows and kind.
 * @param run.first - Its first row.
 * @param run.last - Its last row.
 * @param history - The history.
 * @param yMax - The scale's top.
 */
function paintRun(
  g: PaintContext,
  layout: TimelineLayout,
  scene: PaintScene,
  run: { readonly first: number; readonly last: number },
  history: PerfHistory,
  yMax: number
): void {
  const start = scene.endMs - scene.span;
  const left = xOf(layout, history.t[run.first] ?? 0, start, scene.span);
  const end = (history.t[run.last] ?? 0) + (history.ms[run.last] ?? 0);
  const right = Math.min(layout.plot.w, xOf(layout, end, start, scene.span));
  const top = layout.plot.y - 6;
  const bottom = plotBottom(layout);
  g.globalAlpha = 0.12;
  g.fillStyle = scene.palette.edge;
  g.fillRect(left, top, right - left, bottom - top);
  g.globalAlpha = 1;
  const width = right - Math.max(left, 0);
  if (width <= 60) return;
  const text =
    history.rest[run.first] === REST.break
      ? breakLabel(scene, end - (history.t[run.first] ?? 0))
      : runLabel(scene, history, run.first, width);
  g.save();
  g.beginPath();
  g.rect(Math.max(left, 0), top, width, bottom - top);
  g.clip();
  label(
    g,
    "sans500",
    scene.palette.text2,
    text,
    at(Math.max(left + 8, 6), yOf(layout, 33.3, yMax) + 12, "left")
  );
  g.restore();
}

/**
 * The words of a break of a length.
 *
 * @param scene - The scene.
 * @param ms - Its length.
 * @returns "Break {s} s".
 */
function breakLabel(scene: PaintScene, ms: number): string {
  const tenths = Math.round(ms / 100);
  return labelOf(scene.labels.flag, BREAK_KEYS + tenths, tenths, breakText);
}

/**
 * The words of a resting run: the long form when it is wider than 190 px.
 *
 * @param scene - The scene.
 * @param history - The history.
 * @param row - The run's first row.
 * @param width - Its width, px.
 * @returns The label.
 */
function runLabel(scene: PaintScene, history: PerfHistory, row: number, width: number): string {
  if (width <= 190) return "Resting";
  const fps = rateFps(history.rateMs[row] ?? 0);
  const key = fps * 10_000 + Math.round((history.budgetMs[row] ?? 0) * 10);
  return labelOf(scene.labels.flag, RESTING_KEYS + key, key, restingText);
}

/** The run a paint is walking (reused). */
const RUN = { first: 0, last: 0 };

/**
 * The resting runs (rest 1) and breaks (rest 3) of the rows drawn.
 *
 * @param g - The context.
 * @param layout - The geometry.
 * @param mission - Mission control's state.
 * @param scene - The scene.
 */
function paintRuns(
  g: PaintContext,
  layout: TimelineLayout,
  mission: MissionState,
  scene: PaintScene
): void {
  const { history } = mission;
  let row = ROWS.first;
  while (row < ROWS.end) {
    const rest = history.rest[row];
    if (rest !== REST.idle && rest !== REST.break) {
      row += 1;
      continue;
    }
    RUN.first = row;
    while (row + 1 < ROWS.end && history.rest[row + 1] === rest) row += 1;
    RUN.last = row;
    paintRun(g, layout, scene, RUN, history, ROWS.yMax);
    row += 1;
  }
}

/**
 * Fills a part of a bar between two values.
 *
 * @param g - The context.
 * @param layout - The geometry.
 * @param box - x and width.
 * @param box.x - Left.
 * @param box.w - Width.
 * @param from - The lower value, ms.
 * @param to - The upper value, ms.
 */
function barPart(
  g: PaintContext,
  layout: TimelineLayout,
  box: { readonly x: number; readonly w: number },
  from: number,
  to: number
): void {
  if (to <= from) return;
  const top = yOf(layout, to, ROWS.yMax);
  g.fillRect(box.x, top, box.w, yOf(layout, from, ROWS.yMax) - top);
}

/** The box of the bar a paint is drawing (reused). */
const BOX = { x: 0, w: 0 };

/**
 * One frame's bar: a resting row as one bar in the edge colour at 70 %; else JS (phase-3), a GC
 * pause (teal; phase-3 with memory off) and GPU (phase-1, left out when off or not measured)
 * stacked bottom-up, the part above its budget in its cause colour for a spike, and a 1 px warn
 * caret under the baseline for an awake frame the renderer did not draw.
 *
 * @param g - The context.
 * @param layout - The geometry.
 * @param history - The history.
 * @param row - The row.
 * @param scene - The scene.
 */
function paintBar(
  g: PaintContext,
  layout: TimelineLayout,
  history: PerfHistory,
  row: number,
  scene: PaintScene
): void {
  const { palette } = scene;
  const ms = history.ms[row] ?? 0;
  const rest = history.rest[row] ?? REST.awake;
  if (rest === REST.idle || rest === REST.break) {
    g.globalAlpha = 0.7;
    g.fillStyle = palette.edge;
    barPart(g, layout, BOX, 0, ms);
    g.globalAlpha = 1;
    return;
  }
  const js = history.jsMs[row] ?? 0;
  const gpuMs = history.gpuMs[row] ?? Number.NaN;
  const gpu = scene.gpu && Number.isFinite(gpuMs) ? gpuMs : 0;
  const pause = isGcFrame(history.frame[row] ?? 0) ? Math.max(0, ms - js - gpu) : 0;
  g.fillStyle = palette.phase3;
  barPart(g, layout, BOX, 0, js);
  g.fillStyle = scene.gc === "on" ? palette.teal : palette.phase3;
  barPart(g, layout, BOX, js, js + pause);
  g.fillStyle = palette.phase1;
  barPart(g, layout, BOX, js + pause, js + pause + gpu);
  const code = spikeCause(history.causes[row] ?? 0, rest);
  const budget = history.budgetMs[row] ?? 0;
  if (code > 0 && ms > budget) {
    g.fillStyle = causeColour(palette, code);
    barPart(g, layout, BOX, budget, ms);
  }
  if (history.drawn[row] === 0) {
    g.fillStyle = palette.warn;
    g.fillRect(BOX.x, plotBottom(layout) + 1, 1, 3);
  }
}

/**
 * Every row's bar at its own x and width (`X(t) + 0.3`, `max(1, ms / span × pw − 0.9)`).
 *
 * @param g - The context.
 * @param layout - The geometry.
 * @param history - The history.
 * @param scene - The scene.
 */
function paintRowBars(
  g: PaintContext,
  layout: TimelineLayout,
  history: PerfHistory,
  scene: PaintScene
): void {
  const start = scene.endMs - scene.span;
  const scale = layout.plot.w / scene.span;
  for (let row = ROWS.first; row < ROWS.end; row += 1) {
    BOX.x = xOf(layout, history.t[row] ?? 0, start, scene.span) + 0.3;
    BOX.w = Math.max(1, (history.ms[row] ?? 0) * scale - 0.9);
    paintBar(g, layout, history, row, scene);
  }
}

/**
 * 2 px columns, each holding its worst frame (so a spike is never averaged away).
 *
 * @param g - The context.
 * @param layout - The geometry.
 * @param history - The history.
 * @param scene - The scene.
 */
function paintColumnBars(
  g: PaintContext,
  layout: TimelineLayout,
  history: PerfHistory,
  scene: PaintScene
): void {
  const start = scene.endMs - scene.span;
  let column = -1;
  let worst = -1;
  BOX.w = COLUMN_BAR;
  for (let row = ROWS.first; row <= ROWS.end; row += 1) {
    const here =
      row < ROWS.end
        ? Math.floor(xOf(layout, history.t[row] ?? 0, start, scene.span) / COLUMN_PX)
        : -2;
    if (here !== column && worst >= 0) {
      BOX.x = column * COLUMN_PX;
      paintBar(g, layout, history, worst, scene);
      worst = -1;
    }
    if (row === ROWS.end) break;
    column = here;
    if (worst < 0 || (history.ms[row] ?? 0) > (history.ms[worst] ?? 0)) worst = row;
  }
}

/**
 * The budget line: a step that follows each row's budget, 1.25 px; a rest budget (> 20 ms) dashed
 * `[4, 3]` in the muted ink at 80 %, else solid in text-2 at 90 %; "budget" in the gutter at the
 * newest awake budget.
 *
 * @param g - The context.
 * @param layout - The geometry.
 * @param history - The history.
 * @param scene - The scene.
 */
function paintBudget(
  g: PaintContext,
  layout: TimelineLayout,
  history: PerfHistory,
  scene: PaintScene
): void {
  const { palette } = scene;
  const start = scene.endMs - scene.span;
  g.lineWidth = 1.25;
  let row = ROWS.first;
  let previousY = Number.NaN;
  while (row < ROWS.end) {
    const budget = history.budgetMs[row] ?? 0;
    const segmentStart = row;
    while (row + 1 < ROWS.end && history.budgetMs[row + 1] === budget) row += 1;
    const left = Math.max(0, xOf(layout, history.t[segmentStart] ?? 0, start, scene.span));
    const right = Math.min(
      layout.plot.w,
      xOf(layout, (history.t[row] ?? 0) + (history.ms[row] ?? 0), start, scene.span)
    );
    const y = yOf(layout, budget, ROWS.yMax);
    const resting = budget > REST_BUDGET_MS;
    g.setLineDash(resting ? DASH.budget : DASH.none);
    g.strokeStyle = resting ? palette.muted : palette.text2;
    g.globalAlpha = resting ? 0.8 : 0.9;
    g.beginPath();
    g.moveTo(left, Number.isNaN(previousY) ? y : previousY);
    g.lineTo(left, y);
    g.lineTo(right, y);
    g.stroke();
    previousY = y;
    row += 1;
  }
  g.globalAlpha = 1;
  g.setLineDash(DASH.none);
  if (ROWS.end <= ROWS.first) return;
  const newest = yOf(layout, newestAwakeBudget(history, ROWS.first, ROWS.end), ROWS.yMax);
  label(g, "sans500", palette.text2, "budget", at(layout.plot.w + 6, newest - 12, "left"));
}

/**
 * Paints the frame timeline (spec 09 § M8): ground, grid, axis, resting runs, bars, the budget, the
 * GC lane, spike flags (their boxes into `scene.hits`), recording, rate changes, the source-switch
 * marker, the selection and the cursor, in that order.
 *
 * @param g - The canvas context (transform set to the dpr).
 * @param layout - The canvas's geometry (`framesLayout`).
 * @param mission - Mission control's state (history, series, recorder, selection, hover).
 * @param scene - The view's end and span, the palette, the sections, the caches.
 * @example
 * ```ts
 * scene.endMs = viewEnd(mission.view, liveEnd(mission.clock, now, reduced)) ?? 0;
 * paintFrames(g, framesLayout(960, 262, 2), mission, scene);
 * ```
 */
export function paintFrames(
  g: PaintContext,
  layout: TimelineLayout,
  mission: MissionState,
  scene: PaintScene
): void {
  const { history } = mission;
  const start = scene.endMs - scene.span;
  ROWS.first = firstVisibleRow(history, start);
  ROWS.end = rowFrom(history, scene.endMs);
  ROWS.yMax = yMaxOf(newestAwakeBudget(history, ROWS.first, ROWS.end));
  scene.hits.count = 0;
  g.globalAlpha = 1;
  g.setLineDash(DASH.none);
  g.fillStyle = scene.palette.canvas;
  g.fillRect(0, 0, layout.width, layout.height);
  collectGcFrames(history, start, scene.endMs);
  paintGrid(g, layout, scene, ROWS.yMax);
  paintAxis(g, layout, scene);
  paintRuns(g, layout, mission, scene);
  const rows = ROWS.end - ROWS.first;
  if (rows > layout.plot.w / PX_PER_ROW) paintColumnBars(g, layout, history, scene);
  else paintRowBars(g, layout, history, scene);
  paintBudget(g, layout, history, scene);
  paintGcLane(g, layout, mission, scene);
  paintFlags(g, layout, history, scene, ROWS);
  paintRecording(g, layout, mission, scene);
  paintRates(g, layout, history, scene, ROWS.yMax);
  paintMarker(g, layout, scene, true);
  paintSelection(g, layout, history, mission.selection, scene);
  paintCursor(g, layout, mission.hoverMs, scene);
}

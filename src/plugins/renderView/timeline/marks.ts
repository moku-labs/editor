/**
 * @file renderView timeline — the marks of the frame timeline (spec 09 § M8 items 6–9): GC marks in
 * the GC lane (the engine's `gc` events and a wired phone's inferred GCs, hollow), spike flags by
 * group (chips at 6 s that never overlap, pins at 30 s and 2 min; their boxes into the scene's hit
 * arrays), the recording stripe and its marks, and adaptive rate changes (chips at ≤ 30 s, rows
 * stacked; triangles at 2 min). Allocation-free: strings come from the label caches.
 */
import { spikeCodeAt } from "../series/groups";
import type { PerfHistory, PerfTimelineEvent } from "../source/contract";
import { causeName } from "../source/contract";
import type { MissionState } from "../types";
import type { ChipStyle } from "./draw";
import { at, chip, chipWidth, DASH, diamond, label, roundBox, triangleDown, vline } from "./draw";
import { addFlagHit } from "./hit";
import { labelOf, msText, widthOf } from "./labels";
import type { PaintContext, TimelineLayout } from "./layout";
import { plotBottom, xOf, yOf } from "./layout";
import { causeColour } from "./palette";
import type { PaintScene } from "./scene";

/** The rows a timeline paint draws and its scale's top. */
export type PaintRows = { readonly first: number; readonly end: number; readonly yMax: number };

/** The span at and under which chips carry words. */
const SHORT_SPAN = 6000;
const MEDIUM_SPAN = 30_000;

/** The chip of a flag (spec 09 § M8 item 7): 20 high, radius 4, at y 5. */
const FLAG_TOP = 5;
const FLAG_HEIGHT = 20;

/** The rate chips' rows: 20 high, 24 apart. */
const RATE_ROW = 24;
const RATE_ROWS = 4;

/** The right edge of the newest chip in each rate row of the current paint. */
const RATE_RIGHT = new Float64Array(RATE_ROWS);

/** The box of the flag a paint is drawing (reused). */
const FLAG_BOX = { x: 0, y: FLAG_TOP, w: 0, h: FLAG_HEIGHT };

/** The chip box a paint is drawing (reused). */
const CHIP_BOX = { x: 0, y: 0, w: 0 };

/** The flag a paint is walking (reused). */
const GROUP = { first: 0, last: 0, code: 0, max: 0 };

/**
 * The text of a flag from its key: `code × 10⁶ + value`, value the count (GPU) or the worst ms in
 * tenths.
 *
 * @param key - The key.
 * @returns "JS 22.4 ms", "GPU ×3", "Shader 31 ms", "Upload 41.3 ms", "Long frame 90 ms".
 */
function flagText(key: number): string {
  const cause = causeName(Math.floor(key / 1_000_000));
  const value = key % 1_000_000;
  const ms = msText(value / 10);
  if (cause === "gpu") return `GPU ×${value}`;
  if (cause === "compile") return `Shader ${ms} ms`;
  if (cause === "upload") return `Upload ${ms} ms`;
  if (cause === "longFrame") return `Long frame ${ms} ms`;
  return `JS ${ms} ms`;
}

/**
 * The text of a GC label from its key (MB in tenths).
 *
 * @param tenths - MB freed, in tenths.
 * @returns "GC 4.2 MB".
 */
function gcText(tenths: number): string {
  return `GC ${msText(tenths / 10)} MB`;
}

/** The label key space of GC labels in the event cache (events use their seq, ≥ 0). */
const GC_KEYS = -1_000_000;

/**
 * One GC mark: a dashed `[2, 3]` teal line at 45 % from the plot's top to the baseline and a 4.5
 * px diamond in the lane (hollow with a dashed outline for an inferred GC).
 *
 * @param g - The context.
 * @param layout - The geometry.
 * @param scene - The scene.
 * @param x - Its x.
 * @param inferred - Inferred from a heap drop (CDP).
 */
function gcMark(
  g: PaintContext,
  layout: TimelineLayout,
  scene: PaintScene,
  x: number,
  inferred: boolean
): void {
  const { palette } = scene;
  const bottom = plotBottom(layout);
  g.strokeStyle = palette.teal;
  g.lineWidth = 1;
  g.setLineDash(DASH.gc);
  g.globalAlpha = 0.45;
  vline(g, x, layout.plot.y, bottom);
  g.globalAlpha = 1;
  g.fillStyle = palette.teal;
  g.setLineDash(inferred ? DASH.leader : DASH.none);
  diamond(g, x, bottom + layout.lane / 2, 4.5, inferred);
  g.setLineDash(DASH.none);
}

/**
 * The GC label "GC {mb} MB" right of a mark (6 s only, never over the previous one).
 *
 * @param g - The context.
 * @param layout - The geometry.
 * @param scene - The scene.
 * @param mark - The mark's x and the MB it freed.
 * @param mark.x - Its x.
 * @param mark.freedMb - MB freed.
 * @param lastRight - The previous label's right edge.
 * @returns The new right edge (unchanged when not drawn).
 */
function gcLabel(
  g: PaintContext,
  layout: TimelineLayout,
  scene: PaintScene,
  mark: { readonly x: number; readonly freedMb: number },
  lastRight: number
): number {
  if (scene.span > SHORT_SPAN || mark.x + 8 < lastRight + 4) return lastRight;
  const tenths = Math.round(mark.freedMb * 10);
  const text = labelOf(scene.labels.event, GC_KEYS - tenths, tenths, gcText);
  const y = plotBottom(layout) + layout.lane / 2;
  label(g, "mono500", scene.palette.text2, text, at(mark.x + 8, y, "left"));
  return mark.x + 8 + widthOf(scene.labels, g, "mono500", text);
}

/** The GC label a paint is placing (reused). */
const GC_MARK = { x: 0, freedMb: 0 };

/**
 * The GC lane: with memory on, the marks of the history's `gc` events and of the series' GCs
 * (inferred ones hollow); with memory off or not measured, the line that says so at x 8.
 *
 * @param g - The context.
 * @param layout - The geometry.
 * @param mission - Mission control's state.
 * @param scene - The scene.
 * @example
 * ```ts
 * paintGcLane(g, layout, mission, scene); // "GC 4.2 MB" beside each diamond at 6 s
 * ```
 */
export function paintGcLane(
  g: PaintContext,
  layout: TimelineLayout,
  mission: MissionState,
  scene: PaintScene
): void {
  const y = plotBottom(layout) + layout.lane / 2;
  const { palette } = scene;
  if (scene.gc !== "on") {
    const text =
      scene.gc === "off"
        ? "GC marks are off: Memory & GC is switched off"
        : "GC marks are not measured on this device";
    label(g, "sans500", palette.text2, text, at(8, y, "left"));
    return;
  }
  const { history, series } = mission;
  const start = scene.endMs - scene.span;
  let right = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < history.eventCount; index += 1) {
    const event = history.events[index];
    if (event?.kind !== "gc" || event.t < start || event.t > scene.endMs) continue;
    GC_MARK.x = xOf(layout, event.t, start, scene.span);
    GC_MARK.freedMb = event.freedMb;
    gcMark(g, layout, scene, GC_MARK.x, false);
    right = gcLabel(g, layout, scene, GC_MARK, right);
  }
  const { gcs } = series;
  for (let index = 0; index < gcs.count; index += 1) {
    const t = gcs.t[index] ?? 0;
    if (t < start || t > scene.endMs) continue;
    GC_MARK.x = xOf(layout, t, start, scene.span);
    GC_MARK.freedMb = gcs.v[index] ?? 0;
    gcMark(g, layout, scene, GC_MARK.x, gcs.inferred[index] === 1);
    right = gcLabel(g, layout, scene, GC_MARK, right);
  }
}

/**
 * The style of a flag chip in a cause colour.
 *
 * @param scene - The scene.
 * @param colour - The cause colour.
 * @returns The style (one object, reused).
 */
function flagStyle(scene: PaintScene, colour: string): ChipStyle {
  FLAG_STYLE.ground = scene.palette.panel;
  FLAG_STYLE.tint = colour;
  FLAG_STYLE.text = scene.palette.ink;
  return FLAG_STYLE;
}

/** The flag chips' style, its colours set per flag. */
const FLAG_STYLE: {
  ground: string;
  tint: string;
  tintAlpha: number;
  text: string;
  font: "mono600";
  radius: number;
  height: number;
} = {
  ground: "",
  tint: "",
  tintAlpha: 0.18,
  text: "",
  font: "mono600",
  radius: 4,
  height: FLAG_HEIGHT
};

/**
 * One flag: at 6 s a chip with its words and a dashed `[2, 2]` leader down to the group's worst
 * frame, placed right of the last chip (`≥ lastRight + 4`) and clamped into the plot; at 30 s and
 * 2 min a 6 × 12 pin at y 8 with its leader from y 20. Its box goes into the scene's hits.
 *
 * @param g - The context.
 * @param layout - The geometry.
 * @param history - The history.
 * @param scene - The scene.
 * @param rows - The rows drawn and the scale's top.
 * @param lastRight - The previous chip's right edge.
 * @returns The new right edge.
 */
function paintFlag(
  g: PaintContext,
  layout: TimelineLayout,
  history: PerfHistory,
  scene: PaintScene,
  rows: PaintRows,
  lastRight: number
): number {
  const start = scene.endMs - scene.span;
  const colour = causeColour(scene.palette, GROUP.code);
  const x = xOf(layout, history.t[GROUP.first] ?? 0, start, scene.span);
  const leaderBottom = yOf(layout, GROUP.max, rows.yMax) - 2;
  const from = history.frame[GROUP.first] ?? 0;
  const to = history.frame[GROUP.last] ?? 0;
  g.strokeStyle = colour;
  g.lineWidth = 1;
  g.setLineDash(DASH.leader);
  g.globalAlpha = 0.8;
  if (scene.span > SHORT_SPAN) {
    vline(g, x, 20, leaderBottom);
    g.globalAlpha = 1;
    g.setLineDash(DASH.none);
    g.fillStyle = colour;
    roundBox(g, x - 3, 8, 6, 12, 2);
    g.fill();
    FLAG_BOX.x = x - 3;
    FLAG_BOX.w = 6;
    addFlagHit(scene.hits, FLAG_BOX, from, to);
    return x + 3;
  }
  const value =
    causeName(GROUP.code) === "gpu" ? GROUP.last - GROUP.first + 1 : Math.round(GROUP.max * 10);
  const text = labelOf(
    scene.labels.flag,
    GROUP.code * 1_000_000 + value,
    GROUP.code * 1_000_000 + value,
    flagText
  );
  const width = chipWidth(g, scene, "mono600", text);
  const left = Math.min(Math.max(x, 0), layout.plot.w - width);
  vline(g, x, 26, leaderBottom);
  g.globalAlpha = 1;
  // Never over the chip before: placed after it, or left out when the plot has no room.
  const placed = Math.max(left, lastRight + 4);
  if (placed + width > layout.plot.w) return lastRight;
  CHIP_BOX.x = placed;
  CHIP_BOX.y = FLAG_TOP;
  CHIP_BOX.w = width;
  chip(g, flagStyle(scene, colour), text, CHIP_BOX);
  FLAG_BOX.x = placed;
  FLAG_BOX.w = width;
  addFlagHit(scene.hits, FLAG_BOX, from, to);
  return placed + width;
}

/**
 * The spike flags of the rows drawn, by group (consecutive frames of one cause = one group).
 *
 * @param g - The context.
 * @param layout - The geometry.
 * @param history - The history.
 * @param scene - The scene (its hits are written).
 * @param rows - The rows drawn and the scale's top.
 * @example
 * ```ts
 * paintFlags(g, layout, history, scene, { first: 0, end: history.count, yMax: 36 });
 * scene.hits.count; // 3: f4802, f4851–4853, f4890
 * ```
 */
export function paintFlags(
  g: PaintContext,
  layout: TimelineLayout,
  history: PerfHistory,
  scene: PaintScene,
  rows: PaintRows
): void {
  let right = Number.NEGATIVE_INFINITY;
  let row = rows.first;
  while (row < rows.end) {
    const code = spikeCodeAt(history, row);
    if (code === 0) {
      row += 1;
      continue;
    }
    GROUP.first = row;
    GROUP.code = code;
    GROUP.max = history.ms[row] ?? 0;
    while (
      row + 1 < rows.end &&
      spikeCodeAt(history, row + 1) === code &&
      (history.frame[row + 1] ?? 0) === (history.frame[row] ?? 0) + 1
    ) {
      row += 1;
      GROUP.max = Math.max(GROUP.max, history.ms[row] ?? 0);
    }
    GROUP.last = row;
    right = paintFlag(g, layout, history, scene, rows, right);
    row += 1;
  }
  g.globalAlpha = 1;
  g.setLineDash(DASH.none);
}

/** The pill of a recording mark: radius 10, 20 high. */
const MARK_STYLE: {
  ground: string;
  tint: string;
  tintAlpha: number;
  text: string;
  font: "sans600";
  radius: number;
  height: number;
} = { ground: "", tint: "", tintAlpha: 1, text: "", font: "sans600", radius: 10, height: 20 };

/**
 * The recording (`editor.recorder` recording): a 3 px stripe in the error colour at 70 % from the
 * log's start to the right edge, and each mark as a dashed `[3, 3]` line with its pill. The start is
 * the newest frame's time less `sinceMs` (both on the source clock: the recorder measures on the
 * phone).
 *
 * @param g - The context.
 * @param layout - The geometry.
 * @param mission - Mission control's state.
 * @param scene - The scene.
 * @example
 * ```ts
 * paintRecording(g, layout, mission, scene); // the red stripe while editor.recorder records
 * ```
 */
export function paintRecording(
  g: PaintContext,
  layout: TimelineLayout,
  mission: MissionState,
  scene: PaintScene
): void {
  const { recorder, history } = mission;
  if (recorder?.state !== "recording" || history.count === 0) return;
  const { palette } = scene;
  const start = scene.endMs - scene.span;
  const logStart = (history.t[history.count - 1] ?? 0) - recorder.sinceMs;
  const left = Math.max(0, xOf(layout, logStart, start, scene.span));
  g.globalAlpha = 0.7;
  g.fillStyle = palette.error;
  if (left < layout.plot.w) g.fillRect(left, 0, layout.plot.w - left, 3);
  g.globalAlpha = 1;
  MARK_STYLE.ground = palette.error;
  MARK_STYLE.tint = palette.error;
  MARK_STYLE.text = palette.panel;
  const bottom = plotBottom(layout);
  const { marks } = recorder;
  // eslint-disable-next-line unicorn/no-for-loop -- allocation-free paint: no iterator per frame
  for (let index = 0; index < marks.length; index += 1) {
    const mark = marks[index];
    if (mark === undefined) continue;
    const x = xOf(layout, logStart + mark.atMs, start, scene.span);
    if (x < 0 || x > layout.plot.w) continue;
    g.globalAlpha = 0.6;
    g.strokeStyle = palette.error;
    g.setLineDash(DASH.record);
    vline(g, x, 3, bottom);
    g.globalAlpha = 1;
    CHIP_BOX.x = x + 3;
    CHIP_BOX.y = bottom - 23;
    CHIP_BOX.w = chipWidth(g, scene, "sans600", mark.label);
    chip(g, MARK_STYLE, mark.label, CHIP_BOX);
  }
}

/** The words of each rate-change reason (spec 09 § M8 item 9). */
const RATE_WHY: Readonly<Record<string, string>> = {
  missed: "missed frames",
  headroom: "back on time",
  thermal: "thermal",
  display: "display"
};

/**
 * The chip text of a rate change.
 *
 * @param event - The rate event.
 * @returns "120 → 60, missed frames".
 */
function rateText(event: Extract<PerfTimelineEvent, { kind: "rate" }>): string {
  const why = event.to > event.from ? "back on time" : (RATE_WHY[event.reason] ?? event.reason);
  return `${event.from} → ${event.to}, ${why}`;
}

/** The rate chips' style, its colour set per change. */
const RATE_STYLE: {
  ground: string;
  tint: string;
  tintAlpha: number;
  text: string;
  font: "sans600";
  radius: number;
  height: number;
} = { ground: "", tint: "", tintAlpha: 0.16, text: "", font: "sans600", radius: 10, height: 20 };

/**
 * One rate chip: in the first row where it does not overlap, right of the line (left when there is
 * no room).
 *
 * @param g - The context.
 * @param layout - The geometry.
 * @param scene - The scene.
 * @param event - The rate event.
 * @param x - Its line's x.
 * @param yMax - The scale's top (the chips start at `Y(30)`).
 */
function rateChip(
  g: PaintContext,
  layout: TimelineLayout,
  scene: PaintScene,
  event: Extract<PerfTimelineEvent, { kind: "rate" }>,
  x: number,
  yMax: number
): void {
  const colour = event.to < event.from ? scene.palette.warn : scene.palette.live;
  const text = labelOf(scene.labels.event, event.seq, event, rateText);
  const width = chipWidth(g, scene, "sans600", text);
  const left = x + 4 + width > layout.plot.w ? x - 4 - width : x + 4;
  let row = 0;
  while (row < RATE_ROWS - 1 && (RATE_RIGHT[row] ?? 0) + 4 > left) row += 1;
  RATE_RIGHT[row] = left + width;
  RATE_STYLE.ground = scene.palette.panel;
  RATE_STYLE.tint = colour;
  RATE_STYLE.text = scene.palette.ink;
  CHIP_BOX.x = left;
  CHIP_BOX.y = yOf(layout, 30, yMax) + row * RATE_ROW;
  CHIP_BOX.w = width;
  chip(g, RATE_STYLE, text, CHIP_BOX);
}

/**
 * Adaptive rate changes (the history's `rate` events): a dashed `[5, 3]` 1.25 px line from `TOP − 2`
 * to the baseline, warn for a drop and live for a rise; at ≤ 30 s a chip "{from} → {to}, {why}" in
 * stacked rows, at 2 min an 8 px triangle at `TOP − 6`.
 *
 * @param g - The context.
 * @param layout - The geometry.
 * @param history - The history.
 * @param scene - The scene.
 * @param yMax - The scale's top.
 * @example
 * ```ts
 * paintRates(g, layout, history, scene, 36); // "120 → 60, missed frames" at f4855
 * ```
 */
export function paintRates(
  g: PaintContext,
  layout: TimelineLayout,
  history: PerfHistory,
  scene: PaintScene,
  yMax: number
): void {
  const start = scene.endMs - scene.span;
  const bottom = plotBottom(layout);
  RATE_RIGHT.fill(Number.NEGATIVE_INFINITY);
  for (let index = 0; index < history.eventCount; index += 1) {
    const event = history.events[index];
    if (event?.kind !== "rate" || event.t < start || event.t > scene.endMs) continue;
    const x = xOf(layout, event.t, start, scene.span);
    const colour = event.to < event.from ? scene.palette.warn : scene.palette.live;
    g.strokeStyle = colour;
    g.lineWidth = 1.25;
    g.setLineDash(DASH.rate);
    vline(g, x, layout.plot.y - 2, bottom);
    g.setLineDash(DASH.none);
    if (scene.span <= MEDIUM_SPAN) rateChip(g, layout, scene, event, x, yMax);
    else {
      g.fillStyle = colour;
      triangleDown(g, x, layout.plot.y - 6, 8, 6);
    }
  }
}

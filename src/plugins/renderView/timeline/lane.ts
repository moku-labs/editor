/**
 * @file renderView timeline — paints the Shaders & passes lane on the timeline's axis (spec 09 § M8):
 * per frame its passes stacked by view colour (the history's pass rows; resting frames at 55 %),
 * shader compiles inside a frame as a blue diamond and dashed line (boot compiles get none; at
 * ≤ 30 s a chip "compile {label} {ms} ms, by {view}"), then the selection, the source-switch line
 * and the cursor. Off: "Shaders & passes is off: turn it on in Monitoring". Allocation-free.
 */
import { firstVisibleRow, rowFrom } from "../series/rows";
import type { PerfHistory, PerfTimelineEvent } from "../source/contract";
import { REST } from "../source/contract";
import type { MissionState } from "../types";
import {
  at,
  chip,
  chipWidth,
  DASH,
  diamond,
  hline,
  label,
  paintCursor,
  paintMarker,
  paintSelection,
  vline
} from "./draw";
import { labelOf, msText } from "./labels";
import type { PaintContext, TimelineLayout } from "./layout";
import { plotBottom, xOf, yOf } from "./layout";
import type { PaintScene } from "./scene";
import { laneColourOf } from "./scene";

/** The lane's scale top, ms. */
const LANE_MAX_MS = 12;

/** The lane's grid lines and their labels. */
const GRID_MS: readonly number[] = [5, 10];
const GRID_TEXT: readonly string[] = ["5 ms", "10 ms"];

/** The span at and under which a compile has a chip. */
const CHIP_SPAN = 30_000;

/** The compile chips' style: mono 600 12, 18 high, radius 4. */
const COMPILE_STYLE: {
  ground: string;
  tint: string;
  tintAlpha: number;
  text: string;
  font: "mono600";
  radius: number;
  height: number;
} = { ground: "", tint: "", tintAlpha: 0.18, text: "", font: "mono600", radius: 4, height: 18 };

/** The chip box a paint is drawing (reused). */
const BOX = { x: 0, y: 2, w: 0 };

/**
 * The chip text of a compile.
 *
 * @param event - The shader event.
 * @returns "compile fog.blur 31 ms, by fogLayer".
 */
function compileText(event: Extract<PerfTimelineEvent, { kind: "shader" }>): string {
  const ms = event.ms === null ? "" : ` ${msText(event.ms)} ms`;
  const by = event.view === null ? "" : `, by ${event.view}`;
  return `compile ${event.label ?? event.what}${ms}${by}`;
}

/**
 * The first pass row of a frame or after it.
 *
 * @param history - The history.
 * @param frame - The frame.
 * @returns The pass row; `passCount` when none.
 */
function firstPassOf(history: PerfHistory, frame: number): number {
  let low = 0;
  let high = history.passCount;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((history.passFrame[middle] ?? 0) < frame) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * The grid at 5 and 10 ms with their labels and "Passes" in the gutter.
 *
 * @param g - The context.
 * @param layout - The geometry.
 * @param scene - The scene.
 */
function paintLaneGrid(g: PaintContext, layout: TimelineLayout, scene: PaintScene): void {
  const { palette } = scene;
  const { w } = layout.plot;
  g.strokeStyle = palette.line2;
  g.lineWidth = 1;
  g.setLineDash(DASH.none);
  // eslint-disable-next-line unicorn/no-for-loop -- allocation-free paint: no iterator per frame
  for (let index = 0; index < GRID_MS.length; index += 1) {
    const y = Math.round(yOf(layout, GRID_MS[index] ?? 0, LANE_MAX_MS)) + 0.5;
    g.globalAlpha = 0.7;
    hline(g, y, 0, w);
    g.globalAlpha = 1;
    label(g, "mono500", palette.text2, GRID_TEXT[index] ?? "", at(w + 7, y, "left"));
  }
  label(g, "sans600", palette.text2, "Passes", at(w + 6, 12, "left"));
}

/**
 * Each drawn frame's passes stacked by view colour, resting frames at 55 %.
 *
 * @param g - The context.
 * @param layout - The geometry.
 * @param history - The history.
 * @param scene - The scene.
 */
function paintPassBars(
  g: PaintContext,
  layout: TimelineLayout,
  history: PerfHistory,
  scene: PaintScene
): void {
  const start = scene.endMs - scene.span;
  const first = firstVisibleRow(history, start);
  const end = rowFrom(history, scene.endMs);
  const scale = layout.plot.w / scene.span;
  let pass = firstPassOf(history, history.frame[first] ?? 0);
  for (let row = first; row < end; row += 1) {
    const frame = history.frame[row] ?? 0;
    while (pass < history.passCount && (history.passFrame[pass] ?? 0) < frame) pass += 1;
    const x = xOf(layout, history.t[row] ?? 0, start, scene.span) + 0.3;
    const w = Math.max(1, (history.ms[row] ?? 0) * scale - 0.9);
    const rest = history.rest[row];
    g.globalAlpha = rest === REST.idle || rest === REST.break ? 0.55 : 1;
    let stacked = 0;
    for (; pass < history.passCount && history.passFrame[pass] === frame; pass += 1) {
      const gpu = history.passGpuMs[pass] ?? Number.NaN;
      if (!Number.isFinite(gpu) || gpu <= 0) continue;
      g.fillStyle = laneColourOf(scene, history.passNames[history.passView[pass] ?? 0] ?? "");
      const top = yOf(layout, stacked + gpu, LANE_MAX_MS);
      g.fillRect(x, top, w, yOf(layout, stacked, LANE_MAX_MS) - top);
      stacked += gpu;
    }
  }
  g.globalAlpha = 1;
}

/**
 * Compiles inside a frame (shader events, boot ones left out): a 5 px diamond at y 11 in pick-blue
 * and a dashed `[2, 2]` line at 80 % from 20 to the baseline; at ≤ 30 s their chip at y 2.
 *
 * @param g - The context.
 * @param layout - The geometry.
 * @param history - The history.
 * @param scene - The scene.
 */
function paintCompiles(
  g: PaintContext,
  layout: TimelineLayout,
  history: PerfHistory,
  scene: PaintScene
): void {
  const { palette } = scene;
  const start = scene.endMs - scene.span;
  const bottom = plotBottom(layout);
  for (let index = 0; index < history.eventCount; index += 1) {
    const event = history.events[index];
    if (event?.kind !== "shader" || event.boot || event.t < start || event.t > scene.endMs)
      continue;
    const x = xOf(layout, event.t, start, scene.span);
    g.strokeStyle = palette.pickBlue;
    g.lineWidth = 1;
    g.globalAlpha = 0.8;
    g.setLineDash(DASH.leader);
    vline(g, x, 20, bottom);
    g.globalAlpha = 1;
    g.setLineDash(DASH.none);
    g.fillStyle = palette.pickBlue;
    diamond(g, x, 11, 5, false);
    if (scene.span > CHIP_SPAN) continue;
    const text = labelOf(scene.labels.event, event.seq, event, compileText);
    COMPILE_STYLE.ground = palette.panel;
    COMPILE_STYLE.tint = palette.pickBlue;
    COMPILE_STYLE.text = palette.ink;
    BOX.w = chipWidth(g, scene, "mono600", text);
    BOX.x = Math.min(x + 8, layout.plot.w - BOX.w);
    chip(g, COMPILE_STYLE, text, BOX);
  }
}

/**
 * Paints the Shaders & passes lane on the timeline's axis.
 *
 * @param g - The canvas context (transform set to the dpr).
 * @param layout - The canvas's geometry (`laneLayout`).
 * @param mission - Mission control's state (history, selection, hover).
 * @param scene - The view, the palette, whether passes are on, the caches.
 * @example
 * ```ts
 * paintLane(g, laneLayout(960, 78, 2), mission, scene);
 * ```
 */
export function paintLane(
  g: PaintContext,
  layout: TimelineLayout,
  mission: MissionState,
  scene: PaintScene
): void {
  const { history } = mission;
  const { palette } = scene;
  g.globalAlpha = 1;
  g.setLineDash(DASH.none);
  g.fillStyle = palette.canvas;
  g.fillRect(0, 0, layout.width, layout.height);
  paintLaneGrid(g, layout, scene);
  const middle = layout.plot.y + layout.plot.h / 2;
  if (!scene.passes) {
    label(
      g,
      "sans500",
      palette.text2,
      "Shaders & passes is off: turn it on in Monitoring",
      at(10, middle, "left")
    );
    return;
  }
  if (history.count === 0) {
    label(
      g,
      "sans500",
      palette.text2,
      "Passes show here once frames arrive",
      at(10, middle, "left")
    );
    return;
  }
  paintPassBars(g, layout, history, scene);
  paintCompiles(g, layout, history, scene);
  paintMarker(g, layout, scene, false);
  paintSelection(g, layout, history, mission.selection, scene);
  paintCursor(g, layout, mission.hoverMs, scene);
}

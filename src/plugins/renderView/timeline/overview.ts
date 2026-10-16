/**
 * @file renderView timeline — paints the 2-minute overview scrubber (spec 09 § M8): the series'
 * 500 ms buckets (bars, resting ones in the edge colour; spike ticks in the cause colour; GC and
 * rate-change marks; the recording stripe), the view's viewport (outside dimmed, inside tinted, its
 * border and grab handles), the selection's start, the "−2 min" chip and the source switch's
 * "before: {from}". Empty: "The 2 min history fills as frames arrive". Allocation-free.
 */

import { rowOfFrame } from "../series/rows";
import { OVERVIEW_BUCKET_MS, OVERVIEW_FLAGS } from "../series/series";
import { HISTORY_MS, REST } from "../source/contract";
import type { MissionState } from "../types";
import { at, chipWidth, DASH, label, roundBox, vline } from "./draw";
import { overviewX } from "./hit";
import type { PaintContext, TimelineLayout } from "./layout";
import { yMaxOf } from "./layout";
import { causeColour } from "./palette";
import type { PaintScene } from "./scene";

/**
 * The buckets: a bar `min(1, max / yMax) × (H − 14)` high from `H − 4` (the edge colour at 55 %
 * when the bucket rested, else phase-3 at 55 %), a 6 px spike tick at y 2 in its cause colour, a
 * 3 px GC mark at the bottom and a 2 px rate-change line from y 10.
 *
 * @param g - The context.
 * @param layout - The geometry.
 * @param mission - Mission control's state.
 * @param scene - The scene.
 */
function paintBuckets(
  g: PaintContext,
  layout: TimelineLayout,
  mission: MissionState,
  scene: PaintScene
): void {
  const { overview } = mission.series;
  const { palette } = scene;
  const { height } = layout;
  const width = Math.max(1, (OVERVIEW_BUCKET_MS / HISTORY_MS) * layout.plot.w);
  const yMax = yMaxOf(newestBudget(mission));
  for (let bucket = 0; bucket < overview.count; bucket += 1) {
    const x = overviewX(layout, overview.start + bucket * OVERVIEW_BUCKET_MS, scene.liveEndMs);
    if (x + width < 0 || x > layout.plot.w) continue;
    const max = overview.max[bucket] ?? Number.NaN;
    const flags = overview.flags[bucket] ?? 0;
    if (!Number.isNaN(max)) {
      const bar = Math.min(1, max / yMax) * (height - 14);
      g.globalAlpha = 0.55;
      g.fillStyle = (flags & OVERVIEW_FLAGS.rested) === 0 ? palette.phase3 : palette.edge;
      g.fillRect(x, height - 4 - bar, width, bar);
      g.globalAlpha = 1;
    }
    if ((flags & OVERVIEW_FLAGS.spike) !== 0) {
      g.fillStyle = causeColour(palette, overview.cause[bucket] ?? 0);
      g.fillRect(x, 2, width, 6);
    }
    if ((flags & OVERVIEW_FLAGS.gc) !== 0) {
      g.fillStyle = palette.teal;
      g.fillRect(x, height - 3, width, 3);
    }
    if ((flags & OVERVIEW_FLAGS.rate) !== 0) {
      g.fillStyle = palette.warn;
      g.fillRect(x, 10, 2, height - 16);
    }
  }
}

/**
 * The newest awake budget of the history (the overview's scale follows the timeline's).
 *
 * @param mission - Mission control's state.
 * @returns ms; 16.7 without one.
 */
function newestBudget(mission: MissionState): number {
  const { history } = mission;
  for (let row = history.count - 1; row >= 0; row -= 1) {
    if (history.rest[row] === REST.awake) return history.budgetMs[row] ?? 16.7;
  }
  return 16.7;
}

/**
 * The recording: a 2 px stripe in the error colour at the top from the log's start, and its marks
 * as 1 px lines.
 *
 * @param g - The context.
 * @param layout - The geometry.
 * @param mission - Mission control's state.
 * @param scene - The scene.
 */
function paintOverviewRecording(
  g: PaintContext,
  layout: TimelineLayout,
  mission: MissionState,
  scene: PaintScene
): void {
  const { recorder, history } = mission;
  if (recorder?.state !== "recording" || history.count === 0) return;
  const logStart = (history.t[history.count - 1] ?? 0) - recorder.sinceMs;
  const left = Math.max(0, overviewX(layout, logStart, scene.liveEndMs));
  g.fillStyle = scene.palette.error;
  g.fillRect(left, 0, layout.plot.w - left, 2);
  const { marks } = recorder;
  // eslint-disable-next-line unicorn/no-for-loop -- allocation-free paint: no iterator per frame
  for (let index = 0; index < marks.length; index += 1) {
    const x = overviewX(layout, logStart + (marks[index]?.atMs ?? 0), scene.liveEndMs);
    g.fillRect(x, 0, 1, layout.height);
  }
}

/**
 * The viewport of the view: outside dimmed (the canvas colour at 60 %), inside the accent at 12 %,
 * a 1.5 px accent border with radius 4 and 3 × 14 grab handles at both ends.
 *
 * @param g - The context.
 * @param layout - The geometry.
 * @param scene - The scene.
 */
function paintViewport(g: PaintContext, layout: TimelineLayout, scene: PaintScene): void {
  const { palette } = scene;
  const { height } = layout;
  const width = layout.plot.w;
  const left = Math.max(0, overviewX(layout, scene.endMs - scene.span, scene.liveEndMs));
  const right = Math.min(
    width,
    Math.max(left + 2, overviewX(layout, scene.endMs, scene.liveEndMs))
  );
  g.globalAlpha = 0.6;
  g.fillStyle = palette.canvas;
  g.fillRect(0, 0, left, height);
  g.fillRect(right, 0, width - right, height);
  g.globalAlpha = 0.12;
  g.fillStyle = palette.accent;
  g.fillRect(left, 0, right - left, height);
  g.globalAlpha = 1;
  g.strokeStyle = palette.accent;
  g.lineWidth = 1.5;
  g.setLineDash(DASH.none);
  roundBox(g, left + 0.75, 0.75, right - left - 1.5, height - 1.5, 4);
  g.stroke();
  g.fillStyle = palette.accent;
  g.fillRect(left - 1.5, height / 2 - 7, 3, 14);
  g.fillRect(right - 1.5, height / 2 - 7, 3, 14);
}

/**
 * The selection's start: an 8 × 6 triangle in the accent ink at the top.
 *
 * @param g - The context.
 * @param layout - The geometry.
 * @param mission - Mission control's state.
 * @param scene - The scene.
 */
function paintSelectionStart(
  g: PaintContext,
  layout: TimelineLayout,
  mission: MissionState,
  scene: PaintScene
): void {
  const { selection, history } = mission;
  if (selection === undefined) return;
  const row = rowOfFrame(history, selection.from);
  if (row < 0) return;
  const x = overviewX(layout, history.t[row] ?? 0, scene.liveEndMs);
  g.fillStyle = scene.palette.accentInk;
  g.beginPath();
  g.moveTo(x - 4, 0);
  g.lineTo(x + 4, 0);
  g.lineTo(x, 6);
  g.closePath();
  g.fill();
}

/**
 * The "−2 min" chip at the left (Geist 600 12 on the panel at 85 %) and, left of a source switch,
 * "before: {from}".
 *
 * @param g - The context.
 * @param layout - The geometry.
 * @param scene - The scene.
 */
function paintOverviewWords(g: PaintContext, layout: TimelineLayout, scene: PaintScene): void {
  const { palette } = scene;
  const middle = layout.height / 2;
  const width = chipWidth(g, scene, "sans600", "−2 min");
  g.globalAlpha = 0.85;
  g.fillStyle = palette.panel;
  roundBox(g, 4, middle - 9, width, 18, 4);
  g.fill();
  g.globalAlpha = 1;
  label(g, "sans600", palette.text2, "−2 min", at(10, middle, "left"));
  if (Number.isNaN(scene.markerT) || scene.markerBefore === "") return;
  const x = overviewX(layout, scene.markerT, scene.liveEndMs);
  if (x < width + 16) return;
  g.strokeStyle = palette.text2;
  g.lineWidth = 1;
  g.setLineDash(DASH.marker);
  vline(g, x, 0, layout.height);
  g.setLineDash(DASH.none);
  label(g, "sans500", palette.text2, scene.markerBefore, at(x - 6, middle, "right"));
}

/**
 * Paints the 2-minute overview scrubber: buckets, recording, viewport, selection start and words.
 *
 * @param g - The canvas context (transform set to the dpr).
 * @param layout - The canvas's geometry (`boxLayout`, 40 high).
 * @param mission - Mission control's state (series, recorder, selection).
 * @param scene - The view's end and span, the live end, the palette.
 * @example
 * ```ts
 * paintOverview(g, boxLayout(900, 40, 2), mission, scene);
 * ```
 */
export function paintOverview(
  g: PaintContext,
  layout: TimelineLayout,
  mission: MissionState,
  scene: PaintScene
): void {
  const { palette } = scene;
  g.globalAlpha = 1;
  g.setLineDash(DASH.none);
  g.fillStyle = palette.canvas;
  g.fillRect(0, 0, layout.width, layout.height);
  if (mission.series.overview.count === 0) {
    label(
      g,
      "sans500",
      palette.text2,
      "The 2 min history fills as frames arrive",
      at(layout.width / 2, layout.height / 2, "center")
    );
    return;
  }
  paintBuckets(g, layout, mission, scene);
  paintOverviewRecording(g, layout, mission, scene);
  paintViewport(g, layout, scene);
  paintSelectionStart(g, layout, mission, scene);
  paintOverviewWords(g, layout, scene);
}

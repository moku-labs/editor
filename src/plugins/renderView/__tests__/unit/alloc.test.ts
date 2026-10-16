/* eslint-disable unicorn/no-null -- null is "none" in the recorder's status */
import { describe, expect, it } from "vitest";
import {
  heapMeasured,
  logLeak,
  measureGrowth
} from "../../../../../tests/integration/helpers/heap";
import { noteEvents, noteRows } from "../../series/overview";
import { pushSample } from "../../series/series";
import { appendEvents, appendFrames, REST } from "../../source/contract";
import { createRenderViewState } from "../../state";
import { paintFrames } from "../../timeline/frames";
import { paintHealth } from "../../timeline/health";
import { paintLane } from "../../timeline/lane";
import type { PaintContext } from "../../timeline/layout";
import { boxLayout, framesLayout, laneLayout, sparkLayout } from "../../timeline/layout";
import { paintOverview } from "../../timeline/overview";
import { createPaintScene } from "../../timeline/scene";
import {
  createSparkColumns,
  fillFromFrames,
  fillFromSeries,
  fillPassGpu,
  paintCpuSteps,
  paintGpuSteps,
  paintSpark
} from "../../timeline/spark";
import { CONFIG } from "../helpers";
import { bitsOf, eventsOf, line, rowsOf, wireOf } from "../mission-fixtures";
import { PALETTE } from "../paint-recorder";

// ─────────────────────────────────────────────────────────────────────────────
// The painters allocate nothing per frame (spec 09 § M11, M16 alloc.test.ts;
// spec 10 Delta 2026-10-16, memory layer M1): 600 paints of the timeline, the
// lane, the overview, seven sparklines, the Device load steps and the health
// line over a full 2-minute history keep nothing alive.
// ─────────────────────────────────────────────────────────────────────────────

/** A 2D context whose calls do nothing (the recorder of the other tests allocates per call). */
const METRICS = { width: 48 };
const g: PaintContext = {
  fillStyle: "",
  strokeStyle: "",
  lineWidth: 1,
  font: "",
  textAlign: "left",
  textBaseline: "middle",
  globalAlpha: 1,
  fillRect: () => undefined,
  strokeRect: () => undefined,
  beginPath: () => undefined,
  closePath: () => undefined,
  moveTo: () => undefined,
  lineTo: () => undefined,
  arcTo: () => undefined,
  fill: () => undefined,
  stroke: () => undefined,
  save: () => undefined,
  restore: () => undefined,
  rect: () => undefined,
  clip: () => undefined,
  setLineDash: () => undefined,
  fillText: () => undefined,
  measureText: () => METRICS
};

/**
 * Mission control over a full 2-minute history at 60 fps: spikes, rests, two passes a frame, GCs,
 * rate changes, compiles, the overview and the side series filled, and a recording with a mark.
 *
 * @returns The mission state.
 */
function fullMission() {
  const { mission } = createRenderViewState({ config: CONFIG });
  const rows = rowsOf(1, 7190, {
    t0: 10_000,
    each: index => {
      if (index % 97 === 0) return { ms: 41, jsMs: 30, causes: bitsOf("js") };
      if (index % 251 < 20) return { ms: 33.3, rest: REST.idle, budgetMs: 33.3 };
      return {};
    }
  });
  const passes = rows.flatMap((_, row) => [
    { row, index: 0, kind: "canvas" as const, view: "main", gpuMs: 2 },
    { row, index: 1, kind: "filter" as const, view: "fogLayer", owner: 412, gpuMs: 3 }
  ]);
  appendFrames(mission.history, wireOf(rows, { passes, draws: true }));
  const lines = [];
  for (let second = 0; second < 118; second += 4) {
    const t = 10_000 + second * 1000;
    lines.push(
      line.gc(t, 1 + second * 60, 4.2),
      line.rate(t + 500, 30 + second * 60, 120, 60),
      line.shader(t + 700, 40 + second * 60, "fog.blur", 31)
    );
  }
  appendEvents(mission.history, eventsOf(lines));
  noteRows(mission.series, mission.history, 0);
  noteEvents(mission.series, mission.history, 0);
  for (let second = 0; second < 120; second += 1) {
    const t = 10_000 + second * 1000;
    pushSample(mission.series.textures, t, 130);
    pushSample(mission.series.heap, t, 30 + (second % 30));
    pushSample(mission.series.load.cpuApp, t, 27);
    pushSample(mission.series.load.cpuRenderer, t, 35);
    pushSample(mission.series.load.cpuFlinger, t, 11);
    pushSample(mission.series.load.gpuBusy, t, 64);
    pushSample(mission.series.load.gpuMhz, t, 585);
  }
  mission.recorder = {
    state: "recording",
    lines: 10,
    bytes: 3_100_000,
    sent: 10,
    pending: 0,
    monitor: true,
    file: "perf.jsonl",
    label: null,
    sinceMs: 42_000,
    storage: "opfs",
    dropped: 0,
    startedBy: { by: "agent", name: "Claude" },
    marks: [{ atMs: 20_000, label: "boss intro", auto: false }]
  };
  mission.selection = { from: 4810, to: 4860 };
  mission.hoverMs = 100_000;
  return mission;
}

describe("painters allocate nothing per frame", () => {
  it("600 paints over a full 2 min history keep nothing alive", { timeout: 60_000 }, async () => {
    // Bug: a per-frame array, closure or string in a paint grows the tools page for hours.
    const mission = fullMission();
    const scene = createPaintScene(PALETTE);
    const frames = framesLayout(960, 262, 2);
    const lane = laneLayout(960, 78, 2);
    const overview = boxLayout(900, 40, 2);
    const spark = sparkLayout(220, 46, 2);
    const healthLine = boxLayout(72, 14, 2);
    const health = {
      kind: "wire" as const,
      latencyMs: 9,
      samples: new Float32Array(48).fill(9),
      head: 0
    };
    const sparks = Array.from({ length: 7 }, () => createSparkColumns());
    const style = { min: 0, max: 36, reference: 16.7, colour: "src" as const };
    const view = { startMs: 0, span: 6000 };
    const range = { minMhz: 221, maxMhz: 949 };
    const spans = [6000, 30_000, 120_000] as const;

    const paint = (round: number): void => {
      scene.span = spans[round % 3] ?? 6000;
      scene.liveEndMs = 129_000 + (round % 10);
      scene.endMs = scene.liveEndMs - (round % 2) * 20_000;
      view.startMs = scene.endMs - scene.span;
      view.span = scene.span;
      paintFrames(g, frames, mission, scene);
      paintLane(g, lane, mission, scene);
      paintOverview(g, overview, mission, scene);
      fillFromFrames(sparks[0] ?? createSparkColumns(), mission.history, "fps", view);
      fillFromFrames(sparks[1] ?? createSparkColumns(), mission.history, "worst", view);
      fillFromFrames(sparks[2] ?? createSparkColumns(), mission.history, "draws", view);
      fillFromSeries(
        sparks[3] ?? createSparkColumns(),
        mission.series.textures,
        view.startMs,
        view.span
      );
      fillPassGpu(sparks[4] ?? createSparkColumns(), mission.history, view);
      fillFromSeries(
        sparks[5] ?? createSparkColumns(),
        mission.series.heap,
        view.startMs,
        view.span
      );
      fillFromSeries(
        sparks[6] ?? createSparkColumns(),
        mission.series.load.gpuBusy,
        view.startMs,
        view.span
      );
      for (const columns of sparks) paintSpark(g, spark, columns, style, scene, mission);
      paintCpuSteps(g, spark, mission.series.load, scene);
      paintGpuSteps(g, spark, mission.series.load, scene, range);
      paintHealth(g, healthLine, health, PALETTE);
    };

    const ceiling = { heapBytes: 256 * 1024, objects: 2000 };
    const growth = await measureGrowth(paint, { warmup: 60, rounds: 600, ceiling });
    logLeak("Mission control painters, 600 paints over a full 2 min history", growth);

    if (growth.objects !== undefined) expect(growth.objects).toBeLessThan(ceiling.objects);
    if (heapMeasured(growth)) expect(growth.heapBytes).toBeLessThan(ceiling.heapBytes);
  });
});

/* eslint-disable unicorn/no-null -- null is a value of the wire and of perf's types */
import { describe, expect, it } from "vitest";
import { createMissionSeries, pushSample } from "../../series/series";
import { appendFrames, REST } from "../../source/contract";
import { createRenderViewState } from "../../state";
import { paintHealth } from "../../timeline/health";
import { boxLayout, sparkLayout } from "../../timeline/layout";
import { createPaintScene } from "../../timeline/scene";
import {
  createSparkColumns,
  fillFromFrames,
  fillFromSeries,
  fillPassGpu,
  markCompiles,
  markGcs,
  paintCpuSteps,
  paintSpark,
  SPARK_COLUMNS,
  SPARK_MARK
} from "../../timeline/spark";
import { CONFIG } from "../helpers";
import { bitsOf, ENGINE_REST, line, rowsOf, wireOf, withEvents } from "../mission-fixtures";
import { PALETTE, recorder } from "../paint-recorder";

// ─────────────────────────────────────────────────────────────────────────────
// timeline/spark.ts and health.ts (spec 09 § M7, M9): the cards' columns over
// the shared axis, the Device load steps and the health line.
// ─────────────────────────────────────────────────────────────────────────────

describe("spark columns", () => {
  it("a column keeps its worst frame and rests only when all its rows rest", () => {
    // Bug: a spike averaged away in the Frame time card, or a column with work drawn as rest.
    const { mission } = createRenderViewState({ config: CONFIG });
    const rows = rowsOf(1, 360, {
      t0: 10_000,
      each: index => {
        if (index === 100) return { ms: 41, causes: bitsOf("js") };
        if (index >= 300) return { ms: 33, rest: REST.idle };
        return {};
      }
    });
    appendFrames(mission.history, wireOf(rows));
    const columns = createSparkColumns();

    fillFromFrames(columns, mission.history, "worst", { startMs: 10_000, span: 6000 });

    expect(Math.max(...columns.v.filter(value => !Number.isNaN(value)))).toBe(41);
    expect(columns.rested[SPARK_COLUMNS - 2]).toBe(1);
    expect(columns.rested[10]).toBe(0);
  });

  it("a scroll keeps each column's frames: the same time holds the same value after the view moved", () => {
    // Bug: columns cut from the moving view start regroup the frames at every paint, so the
    // sparklines wobble while they scroll (the cards on the A26).
    const { mission } = createRenderViewState({ config: CONFIG });
    appendFrames(
      mission.history,
      wireOf(rowsOf(1, 720, { t0: 10_000, each: index => ({ ms: 8 + ((index * 7) % 11) }) }))
    );
    const before = createSparkColumns();
    const after = createSparkColumns();
    const shift = 6000 / 159 / 3;

    fillFromFrames(before, mission.history, "worst", { startMs: 12_000, span: 6000 });
    fillFromFrames(after, mission.history, "worst", { startMs: 12_000 + shift, span: 6000 });

    const valueAt = (columns: typeof before, t: number) =>
      columns.v[Math.floor((t - columns.startMs) / columns.stepMs)];
    for (let t = 12_500; t < 17_500; t += 100) {
      expect(valueAt(after, t)).toBe(valueAt(before, t));
    }
  });

  it("the FPS columns of a real engine's rest read the rest rate, 30, not the loop's 60", () => {
    // Bug: the FPS card drawn flat at 60 through a rest: rateMs stays the loop's 16.67 ms while the
    // engine rests at a 33.3 ms budget.
    const { mission } = createRenderViewState({ config: CONFIG });
    appendFrames(
      mission.history,
      wireOf(rowsOf(1, 360, { t0: 10_000, each: index => (index >= 300 ? ENGINE_REST : {}) }))
    );
    const columns = createSparkColumns();

    fillFromFrames(columns, mission.history, "fps", { startMs: 10_000, span: 6000 });

    expect(columns.v[SPARK_COLUMNS - 2]).toBe(30);
    expect(columns.v[10]).toBe(60);
  });

  it("a series column holds the newest sample; a stopped feed leaves a gap, never 0", () => {
    // Bug: the Textures card drawn flat at 0 where the source sent nothing.
    const series = createMissionSeries();
    pushSample(series.textures, 10_000, 120);
    pushSample(series.textures, 11_000, 130);
    const columns = createSparkColumns();

    fillFromSeries(columns, series.textures, 10_000, 6000);

    expect(columns.v[0]).toBe(120);
    expect(columns.v[30]).toBe(130);
    expect(Number.isNaN(columns.v[SPARK_COLUMNS - 1] ?? 0)).toBe(true);
  });
});

/** The view of the marks tests. */
const VIEW = { startMs: 10_000, span: 6000 };

/**
 * The column of a time in VIEW.
 *
 * @param t - Source-clock ms.
 * @returns The column.
 */
function columnAt(t: number): number {
  return Math.floor(((t - VIEW.startMs) / VIEW.span) * SPARK_COLUMNS);
}

describe("marks on the cards' axis", () => {
  it("a GC marks the column of its time, the engine's filled and a heap drop's hollow; a compile inside a frame marks the GPU card, a boot compile does not", () => {
    // Bug: an inferred GC drawn as a measured one on the Memory card, or a compile while loading
    // marked as if it cost a frame.
    const { mission } = createRenderViewState({ config: CONFIG });
    appendFrames(mission.history, wireOf(rowsOf(1, 360, { t0: 10_000 })));
    withEvents(mission.history, [
      line.gc(11_000, 60, 4.2),
      line.shader(12_000, 120, "fog.blur", 31),
      line.shader(13_000, 180, "boot.main", 12, true)
    ]);
    pushSample(mission.series.gcs, 14_000, 6);
    mission.series.gcs.inferred[0] = 1;
    const memory = createSparkColumns();
    const gpu = createSparkColumns();

    fillFromSeries(memory, mission.series.heap, VIEW.startMs, VIEW.span);
    markGcs(memory, mission.history, mission.series.gcs, VIEW);
    fillPassGpu(gpu, mission.history, VIEW);
    markCompiles(gpu, mission.history, VIEW);

    expect(memory.marks[columnAt(11_000)]).toBe(SPARK_MARK.gc);
    expect(memory.marks[columnAt(14_000)]).toBe(SPARK_MARK.inferredGc);
    expect(memory.marks.filter(mark => mark !== SPARK_MARK.none)).toHaveLength(2);
    expect(gpu.marks[columnAt(12_000)]).toBe(SPARK_MARK.compile);
    expect(gpu.marks.filter(mark => mark !== SPARK_MARK.none)).toHaveLength(1);
  });

  it("a refill forgets the last paint's marks: a GC that scrolled out leaves no diamond", () => {
    // Bug: a diamond stuck in its column after its GC left the view.
    const { mission } = createRenderViewState({ config: CONFIG });
    withEvents(mission.history, [line.gc(11_000, null, 4.2)]);
    const columns = createSparkColumns();
    markGcs(columns, mission.history, mission.series.gcs, VIEW);

    fillFromSeries(columns, mission.series.heap, 20_000, 6000);
    markGcs(columns, mission.history, mission.series.gcs, { startMs: 20_000, span: 6000 });

    expect(columns.marks.every(mark => mark === SPARK_MARK.none)).toBe(true);
  });

  it("paints each mark as a diamond at top + 4 (teal, hollow and dashed when inferred; pick-blue for a compile) and the trend dashed [4, 3] in warn across the view", () => {
    // Bug: the Memory card without its baseline trend, or its marks off the shared axis.
    const { mission } = createRenderViewState({ config: CONFIG });
    const columns = createSparkColumns();
    fillFromSeries(columns, mission.series.heap, 10_000, 6000);
    columns.v.fill(30);
    columns.marks[20] = SPARK_MARK.gc;
    columns.marks[80] = SPARK_MARK.inferredGc;
    columns.marks[140] = SPARK_MARK.compile;
    const scene = createPaintScene(PALETTE);
    scene.endMs = 16_000;
    scene.span = 6000;
    const trend = { t: 10_000, value: 30, perMs: 0.001 };
    const { g, calls, of } = recorder();

    paintSpark(
      g,
      sparkLayout(160, 46, 1),
      columns,
      { min: 20, max: 40, reference: Number.NaN, colour: "src", trend },
      scene,
      {
        history: createRenderViewState({ config: CONFIG }).mission.history,
        selection: undefined,
        hoverMs: undefined
      }
    );

    const diamonds = of("moveTo")
      .filter(call => call.args[1] === 7 - 3.5)
      .map(call => call.args[0] ?? 0);
    // Each at its column's middle: column 0 starts at the view's start here (10 000 ms is whole).
    expect(diamonds).toHaveLength(3);
    for (const [index, column] of [20, 80, 140].entries()) {
      expect(diamonds[index]).toBeCloseTo(((column + 0.5) * 160) / 159, 9);
    }
    expect(of("fill").filter(call => call.fillStyle === "teal")).toHaveLength(1);
    expect(
      of("stroke").filter(call => call.strokeStyle === "teal" && call.dash.join(",") === "2,2")
    ).toHaveLength(1);
    expect(of("fill").filter(call => call.fillStyle === "pickBlue")).toHaveLength(1);
    const stroke = calls.findIndex(call => call.op === "stroke" && call.strokeStyle === "warn");
    expect(calls[stroke]).toMatchObject({ lineWidth: 1.25, dash: [4, 3] });
    const ends = calls
      .slice(0, stroke)
      .filter(call => call.op === "moveTo" || call.op === "lineTo")
      .slice(-2)
      .map(call => call.args.map(value => Math.round(value * 10) / 10));
    // 30 MB at the view's start (y 21), 36 MB at its end (y 10.2) on a 20–40 scale.
    expect(ends).toEqual([
      [0, 21],
      [160, 10.2]
    ]);
  });
});

describe("Device load steps", () => {
  it("one step per 1 s sample; a missing second is a gap, not a ramp", () => {
    // Bug: a slope drawn across a second the phone did not report.
    const series = createMissionSeries();
    const { load } = series;
    for (const [t, app] of [
      [10_000, 20],
      [11_000, 25],
      [14_000, 30]
    ] as const) {
      pushSample(load.cpuApp, t, app);
      pushSample(load.cpuRenderer, t, 10);
      pushSample(load.cpuFlinger, t, 5);
    }
    const scene = createPaintScene(PALETTE);
    scene.endMs = 16_000;
    scene.span = 6000;
    const { g, calls } = recorder();

    paintCpuSteps(g, sparkLayout(600, 46, 1), load, scene);

    const lastStroke = calls.findLastIndex(call => call.op === "stroke");
    const path = calls.slice(
      calls.findLastIndex((call, index) => index < lastStroke && call.op === "beginPath"),
      lastStroke
    );
    const segments = path
      .filter(call => call.op === "moveTo" || call.op === "lineTo")
      .map(call => [call.op, call.args[0]]);
    expect(segments).toEqual([
      ["moveTo", 0],
      ["lineTo", 100],
      ["moveTo", 100],
      ["lineTo", 200],
      ["moveTo", 400],
      ["lineTo", 500]
    ]);
  });
});

describe("paintHealth", () => {
  it("draws the 48 samples oldest first and breaks the line at a missing one", () => {
    // Bug: the newest latency drawn at the left (the ring read from 0, not after head).
    const samples = new Float32Array(48).fill(10);
    samples[5] = Number.NaN;
    samples[20] = 30;
    const { g, of } = recorder();

    paintHealth(
      g,
      boxLayout(47, 14, 1),
      { kind: "wire", latencyMs: 30, samples, head: 20 },
      PALETTE
    );

    const points = [...of("moveTo"), ...of("lineTo")].map(call => call.args[0] ?? 0);
    expect(Math.max(...points)).toBe(47);
    expect(of("moveTo")).toHaveLength(2);
    const newest = of("lineTo").find(call => call.args[0] === 47);
    expect(newest?.args[1]).toBeLessThan(of("moveTo")[0]?.args[1] ?? 0);
  });
});

describe("empty and dashed", () => {
  it("draws no health line without a sample; a sparkline's reference line is dashed and its gap breaks the line", () => {
    // Bug: a line drawn at 0 ms when the link has no sample yet.
    const empty = recorder();
    paintHealth(
      empty.g,
      boxLayout(47, 14, 1),
      { kind: "wire", latencyMs: null, samples: new Float32Array(48).fill(Number.NaN), head: 0 },
      PALETTE
    );
    expect(empty.calls).toEqual([]);

    const columns = createSparkColumns();
    columns.v.fill(10);
    columns.v[80] = Number.NaN;
    const scene = createPaintScene(PALETTE);
    scene.endMs = 16_000;
    const { g, of } = recorder();
    paintSpark(
      g,
      sparkLayout(160, 46, 1),
      columns,
      { min: 0, max: 20, reference: 16.7, colour: "src" },
      scene,
      {
        history: createRenderViewState({ config: CONFIG }).mission.history,
        selection: undefined,
        hoverMs: 13_000
      }
    );
    expect(of("stroke").some(call => call.dash.join(",") === "3,3")).toBe(true);
    expect(
      of("moveTo").filter(call => call.strokeStyle === "src" || call.fillStyle === "src").length
    ).toBeGreaterThanOrEqual(2);
  });
});

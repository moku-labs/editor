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
  paintCpuSteps,
  paintSpark,
  SPARK_COLUMNS
} from "../../timeline/spark";
import { CONFIG } from "../helpers";
import { bitsOf, rowsOf, wireOf } from "../mission-fixtures";
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

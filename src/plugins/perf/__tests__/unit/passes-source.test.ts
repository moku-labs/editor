/* eslint-disable unicorn/no-null -- null is "not measured" on the wire */
import { describe, expect, it } from "vitest";
import type { FakeMonitor } from "../../../../../tests/fixtures/fake-monitor";
import {
  headerLine,
  passesLine,
  patchedSampleLine
} from "../../../../../tests/fixtures/fake-monitor";
import type { Json } from "../../../registry/protocol";
import type { PerfPassesSummary, PerfPassesWire } from "../../protocol";
import { passesSummaryOf } from "../../protocol";
import { feedRig } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// editor.perf.passes (spec 03 Delta 2026-10-16 D5; owner 2026-10-16): the agent
// sends the newest full second's raw pass rows, or the engine's own `passes`
// line as it came (next change); the tools page builds the panel's summary with
// passesSummaryOf (protocol/passes), never the phone.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The summary the tools page builds of an answer.
 *
 * @param value - The `editor.perf.passes` answer.
 * @returns Its summary.
 */
function summaryOf(value: Json): PerfPassesSummary {
  if (value === null) throw new Error("editor.perf.passes answered null");
  return passesSummaryOf(value as PerfPassesWire);
}

/** Frame ms between two frames of the test runs. */
const STEP = 16.7;

/**
 * Commits `count` frames from page-clock 0, each with a canvas pass (2 ms GPU, 40 draws) and two
 * `fog.blur` filter passes of owner 412 on the fog layer (3 ms GPU, one draw each); the frame at
 * index 30 works 30 ms (the heaviest) and its canvas pass takes 4 ms GPU.
 *
 * @param monitor - The fake monitor.
 * @param count - Frames.
 */
function commitPassFrames(monitor: FakeMonitor, count: number): void {
  for (let index = 0; index < count; index += 1) {
    const workMs = index === 30 ? 30 : 3;
    monitor.commit({ t: index * STEP, gapMs: STEP, workMs, draws: 42 });
    const canvasMs = index === 30 ? 4 : 2;
    monitor.commitPass({ label: "main", gpuMs: canvasMs, drawsAt: 0, format: "bgra8unorm" });
    for (const drawsAt of [40, 41]) {
      monitor.commitPass({
        kind: "filter",
        label: "fogLayer",
        owner: 412,
        filter: "fog.blur",
        gpuMs: 3,
        drawsAt,
        w: 540,
        h: 1170
      });
    }
  }
}

describe("editor.perf.passes", () => {
  it("sends the newest full second's raw pass rows and its heaviest drawn frame, no chains (bug: chain building on the phone, or nothing on a 0.15.x engine)", () => {
    const { monitor, tick, read } = feedRig({ feedPasses: true });
    commitPassFrames(monitor, 70);
    monitor.emit(patchedSampleLine(70));
    tick();

    const wire = read("editor.perf.passes") as PerfPassesWire;
    expect(wire).toMatchObject({
      v: 1,
      source: "agent",
      t: 1000,
      frames: 60,
      tiler: true,
      gpuTimer: true,
      heaviest: { frame: 31, row: 30 },
      line: null,
      targets: { created: 6, destroyed: 6 },
      lost: 0
    });
    expect(wire).not.toHaveProperty("chains");
    expect(wire.rows?.row).toHaveLength(180);
    expect(wire.rows?.draws.slice(0, 3)).toEqual([40, 1, 1]);
  });

  it("builds the chains and the heaviest frame's shares from the agent's rows on the tools page (bug: shares or chains of the wrong frames)", () => {
    const { monitor, tick, read } = feedRig({ feedPasses: true });
    commitPassFrames(monitor, 70);
    monitor.emit(patchedSampleLine(70));
    tick();

    expect(summaryOf(read("editor.perf.passes"))).toEqual({
      v: 1,
      source: "agent",
      t: 1000,
      frames: 60,
      tiler: true,
      gpuTimer: true,
      chains: [
        {
          owner: 412,
          view: "fogLayer",
          kinds: ["fog.blur", "fog.blur"],
          applies: 120,
          mpx: 75.8,
          draws: 2,
          gpuMs: { p50: 6, max: 6 },
          share: 0.75
        }
      ],
      heaviest: {
        frame: 31,
        passes: [
          {
            index: 0,
            kind: "canvas",
            view: "main",
            owner: null,
            filter: null,
            w: 1080,
            h: 2340,
            format: "bgra8unorm",
            resolution: null,
            draws: 40,
            gpuMs: 4,
            share: 0.4
          },
          expect.objectContaining({
            index: 1,
            kind: "filter",
            owner: 412,
            filter: "fog.blur",
            draws: 1
          }),
          expect.objectContaining({ index: 2, filter: "fog.blur", draws: 1, share: 0.3 })
        ]
      },
      shaders: null,
      targets: { created: 6, destroyed: 6 },
      lost: 0
    });
  });

  it("answers null before the first full second (bug: a half second summed as a whole one)", () => {
    const { monitor, tick, read } = feedRig({ feedPasses: true });
    commitPassFrames(monitor, 30);
    tick();
    expect(read("editor.perf.passes")).toBeNull();
  });

  it("is not a tile GPU on a desktop NVIDIA, and has no chain GPU without a GPU timer (bug: shares computed from NaN)", () => {
    const gpu = {
      backend: "webgpu" as const,
      vendor: "nvidia",
      architecture: null,
      renderer: null,
      timer: null
    };
    const { monitor, tick, read } = feedRig({ feedPasses: true }, { header: headerLine({ gpu }) });
    for (let index = 0; index < 70; index += 1) {
      monitor.commit({ t: index * STEP, gapMs: STEP });
      monitor.commitPass({ kind: "filter", owner: 7, filter: "glow" });
    }
    tick();
    expect(summaryOf(read("editor.perf.passes"))).toMatchObject({
      tiler: false,
      gpuTimer: false,
      chains: [{ owner: 7, kinds: ["glow"], gpuMs: null, share: null }]
    });
  });

  it("passes the engine's passes line on as it came with source engine, and the tools page shows its chains (bug: the editor's own sum shown while the engine's is available)", () => {
    const { monitor, tick, read, state } = feedRig({ feedPasses: true });
    commitPassFrames(monitor, 70);
    tick();
    monitor.emit(passesLine());

    const wire = read("editor.perf.passes") as PerfPassesWire;
    expect(wire).toMatchObject({ source: "engine", t: 41_000, rows: null, heaviest: null });
    expect(wire.line).toEqual(structuredClone(passesLine()));
    expect(summaryOf(wire)).toMatchObject({
      v: 1,
      source: "engine",
      t: 41_000,
      chains: [
        {
          owner: 412,
          view: "fogLayer",
          kinds: ["fog.blur", "fog.blur"],
          applies: 120,
          mpx: 221.2,
          draws: 4,
          gpuMs: { p50: 6.2, max: 6.9 },
          share: null
        }
      ],
      heaviest: {
        frame: 4852,
        passes: [
          { index: 0, kind: "canvas", view: "main", w: 1080, h: 2340, gpuMs: 3.1, owner: null }
        ]
      },
      lost: 0
    });
    expect(state.caps.passesLine).toBe(true);
  });
});

/* eslint-disable unicorn/no-null -- null is "not measured" in the log lines */
import { describe, expect, it } from "vitest";
import type { PerfSampleLine } from "../../../perf/protocol";
import type { ParsedLog } from "../../report";
import { parsePerfLog, summarize } from "../../report";
import {
  eventLine,
  gfxLine,
  headerLine,
  jsonl,
  markLine,
  sampleLine,
  spikeLine,
  thermalLine
} from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// summarize: per screen and rate tallies in one pass, heat, system frames per
// mark segment, and the game's frame events on the screen whose second holds
// them.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The summary of lines.
 *
 * @param lines - Log lines.
 * @returns The summary.
 */
function summaryOf(lines: readonly object[]) {
  return summarize(parsePerfLog(jsonl([headerLine(), ...lines])));
}

/**
 * The row of a path at 120 fps.
 *
 * @param lines - Log lines.
 * @param path - The flow path.
 * @returns The row.
 */
function rowOf(lines: readonly object[], path = "garden/boss") {
  return summaryOf(lines).screens.find(screen => screen.path === path && screen.rate === 120);
}

describe("summarize — screens", () => {
  it("splits the tallies by path and sorts the rows by seconds, longest first", () => {
    const summary = summaryOf([
      sampleLine(1000, { path: "shop" }),
      sampleLine(2000),
      sampleLine(3000),
      sampleLine(4000, { path: "shop", windowMs: 500 })
    ]);

    expect(summary.screens.map(screen => [screen.path, screen.seconds])).toEqual([
      ["garden/boss", 2],
      ["shop", 1.5]
    ]);
    expect(summary.seconds).toBe(3.5);
    expect(summary.device).toEqual({
      model: "SM-A266B",
      backend: "webgpu",
      engine: "0.14.12+9c41e0",
      build: "debug-1"
    });
  });

  it("counts spikes by primary cause, most first (bug: a spike counted under every cause)", () => {
    const row = rowOf([
      sampleLine(1000),
      spikeLine(1100, ["js", "upload"]),
      spikeLine(1200, ["upload"]),
      spikeLine(1300, ["js"])
    ]);

    expect(row?.spikes).toBe(3);
    expect(row?.causes).toEqual([
      ["upload", 2],
      ["js", 1]
    ]);
    expect(row?.spikesPerMin).toBe(180);
  });

  it("weights GPU ms by the frames each second timed, and answers null without a timer", () => {
    const weighted = rowOf([
      sampleLine(1000, { gpuMs: { p50: 4, p90: 5, max: 6, frames: 100 } }),
      sampleLine(2000, { gpuMs: { p50: 10, p90: 11, max: 12, frames: 50 } })
    ]);
    const untimed = rowOf([sampleLine(1000, { gpuMs: null })]);

    expect(weighted?.gpuMs).toBe(6);
    expect(untimed?.gpuMs).toBeNull();
  });

  it("weights passes by the drawn frames", () => {
    const row = rowOf([
      sampleLine(1000, { drawn: 30, passes: { mean: 2, max: 2, stencil: null } }),
      sampleLine(2000, { drawn: 10, passes: { mean: 6, max: 6, stencil: null } })
    ]);

    expect(row?.passes).toBe(3);
  });

  it("keeps the max texture and heap memory, kept MB from sample.kept when present (bug: kept stuck at 0)", () => {
    const row = rowOf([
      sampleLine(1000, {
        heapMb: 140,
        textures: { count: 1, mb: 1, art: 90, targets: 40, kept: 2 }
      }),
      sampleLine(2000, {
        heapMb: 151,
        textures: { count: 1, mb: 1, art: 96, targets: 32, kept: 0 },
        kept: { pictures: 2, mb: 6.5, retakes: 0, refreshes: 0 }
      })
    ]);

    expect(row?.textureMb).toEqual({ art: 96, targets: 40, kept: 6.5 });
    expect(row?.heapMb).toBe(151);
  });

  // The full parallel suite measured 1481 ms against 1000. Factor 5 keeps the order-of-magnitude
  // guard against the quadratic summary (minutes over 200 000 samples) without failing on runner noise.
  const BUDGET_MS = 1000;
  const CI_FACTOR = 5;

  it("summarizes 200 000 samples within 1 s (CI factor 5; bug: the game's quadratic summary)", () => {
    const sample: PerfSampleLine = sampleLine(0);
    const samples = Array.from({ length: 200_000 }, (_, index) => ({ ...sample, t: index * 1000 }));
    const log: ParsedLog = {
      header: headerLine(),
      samples,
      spikes: [],
      marks: [],
      rates: [],
      frameEvents: [],
      thermal: [],
      gfx: [],
      lost: 0,
      lines: samples.length + 1,
      skipped: { notJson: 0, noVersion: 0, otherVersion: 0, unknownKind: 0, badShape: 0 }
    };

    const started = performance.now();
    const summary = summarize(log);
    const took = performance.now() - started;

    expect(summary.screens[0]?.frames).toBe(200_000 * 118);
    expect(took).toBeLessThan(BUDGET_MS * CI_FACTOR);
  });
});

describe("summarize — order", () => {
  it("orders lines by t, so a resent second still counts at the rate in effect at its t", () => {
    const summary = summaryOf([
      sampleLine(3000, { windowMs: 1000 }),
      {
        v: 1,
        kind: "event",
        t: 2500,
        build: null,
        frame: null,
        name: "rate",
        detail: { from: 120, to: 60, reason: "missed", mode: "auto" }
      },
      sampleLine(1000, { windowMs: 1000 }),
      sampleLine(2000, { windowMs: 1000 })
    ]);

    expect(summary.screens.map(screen => [screen.rate, screen.seconds])).toEqual([
      [120, 2],
      [60, 1]
    ]);
  });
});

describe("summarize — frame events", () => {
  it("counts two pool trims inside garden/boss seconds on that row and none on shop", () => {
    const summary = summaryOf([
      sampleLine(1000),
      eventLine(1500, "pool-trim", { reason: "scene", freedMb: 41.5 }),
      eventLine(1900, "pool-trim", { reason: "scene", freedMb: 41.5 }),
      sampleLine(2000),
      sampleLine(3000, { path: "shop" })
    ]);

    const boss = summary.screens.find(screen => screen.path === "garden/boss");
    const shop = summary.screens.find(screen => screen.path === "shop");
    expect(boss?.poolTrims).toEqual({ count: 2, freedMb: 83 });
    expect(shop?.poolTrims).toEqual({ count: 0, freedMb: 0 });
  });

  it("counts a warm-up during loading on the loading screen, and an event after the last sample on the last", () => {
    const summary = summaryOf([
      eventLine(700, "warm", { draws: 12 }),
      sampleLine(1000, { path: "loading" }),
      sampleLine(2000, { path: "garden" }),
      eventLine(2500, "warm", { draws: 3 })
    ]);

    const loading = summary.screens.find(screen => screen.path === "loading");
    const garden = summary.screens.find(screen => screen.path === "garden");
    expect(loading?.warmUps).toEqual({ count: 1, draws: 12 });
    expect(garden?.warmUps).toEqual({ count: 1, draws: 3 });
  });

  it("lists overlay changes by label and what, with counts (bug: overlays listed by entity id)", () => {
    const row = rowOf([
      eventLine(500, "overlay", {
        entity: 412,
        label: "shopDimLayer",
        what: "open",
        mode: "modal"
      }),
      eventLine(600, "overlay", {
        entity: 977,
        label: "shopDimLayer",
        what: "open",
        mode: "modal"
      }),
      eventLine(700, "overlay", {
        entity: 977,
        label: "shopDimLayer",
        what: "kept",
        mode: "modal"
      }),
      sampleLine(1000)
    ]);

    expect(row?.overlays).toEqual([
      { label: "shopDimLayer", what: "open", count: 2 },
      { label: "shopDimLayer", what: "kept", count: 1 }
    ]);
  });

  it("counts no frame event in a log without samples", () => {
    const summary = summaryOf([eventLine(700, "warm", { draws: 12 })]);

    expect(summary.screens).toEqual([]);
  });
});

describe("summarize — heat, system frames, marks", () => {
  it("keeps first, last and max of battery and status per device; a shell line's null device reads as the header's model", () => {
    const summary = summaryOf([
      sampleLine(1000),
      thermalLine(1000, { batteryC: 31.2, status: 0, sensors: { SKIN: 33.1, AP: 40 } }),
      thermalLine(2000, { batteryC: 38.4, status: 1, sensors: { SKIN: 37 } }),
      thermalLine(3000, { batteryC: 38, status: 1, sensors: { SKIN: 38.4, AP: 39 } })
    ]);

    expect(summary.heat).toEqual([
      {
        device: "SM-A266B",
        batteryC: { first: 31.2, last: 38, max: 38.4 },
        status: { first: 0, last: 1, max: 1 },
        sensors: [
          { name: "AP", first: 40, last: 39 },
          { name: "SKIN", first: 33.1, last: 38.4 }
        ]
      }
    ]);
  });

  it("splits system frames at marks, (start) before the first", () => {
    const summary = summaryOf([
      sampleLine(1000),
      gfxLine(10_000, { hist: { "16": 590, "40": 10 } }),
      markLine(15_000, "boss"),
      gfxLine(20_000, { frames: 300, janky: 30, hist: { "33": 300 } }),
      gfxLine(30_000, { frames: 300, janky: 0, hist: { "16": 300 } })
    ]);

    expect(summary.system).toEqual([
      {
        device: "SM-A266B",
        mark: "(start)",
        seconds: 10,
        frames: 600,
        fps: 60,
        latePct: 1,
        p50: 16,
        p90: 16,
        p99: 40
      },
      {
        device: "SM-A266B",
        mark: "boss",
        seconds: 20,
        frames: 600,
        fps: 30,
        latePct: 5,
        p50: 16,
        p90: 33,
        p99: 33
      }
    ]);
    expect(summary.marks).toEqual([{ at: 14, label: "boss", auto: false }]);
  });
});

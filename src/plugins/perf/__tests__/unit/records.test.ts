/* eslint-disable unicorn/no-null -- null is "not measured" in the engine's lines and perf's values */
import { describe, expect, it } from "vitest";
import {
  createFakeMonitor,
  eventLine,
  frameRecord,
  headerLine,
  spikeLine
} from "../../../../../tests/fixtures/fake-monitor";
import type { PerfCause } from "../../protocol";
import { readTick } from "../../reader";
import type { WhyFacts } from "../../records";
import { secondOf, spikeRecord, spikeSummaries, whyOf } from "../../records";
import { attach, commitFrames, perfState } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// records: second(), the spike summaries and the spike record of a frame.
// ─────────────────────────────────────────────────────────────────────────────

/** The frame the spike tests commit as a spike. */
const SPIKE = 4812;

/**
 * A state with a fake monitor: frames 1…11 at 60 fps, then the spike 4812 (work over budget with an
 * upload, after a gap).
 *
 * @param capacity - The ring's capacity.
 * @param stats - The renderer's stats, when the game has one.
 * @returns The perf, the monitor and a tick.
 */
function setup(capacity = 64, stats?: () => unknown) {
  const perf = perfState();
  const monitor = createFakeMonitor({ capacity });
  attach(perf.state, monitor, stats);
  commitFrames(monitor, 11, 40_000, 16.7);
  monitor.commit({
    frame: SPIKE,
    t: 40_183.7,
    gapMs: 41.3,
    workMs: 30,
    agentMs: 0.1,
    gpuMs: 6.6,
    causes: 0b1_0011,
    path: "garden/boss",
    phaseMs: [0.3, 0.4, 0.1, 1.2, 0.1, 5.9],
    passes: 2,
    draws: 212,
    uploads: 3,
    uploadMb: 41,
    compiles: 0,
    changed: 0b1000
  });
  const tick = () => readTick(perf.state, perf.config);
  return { ...perf, monitor, tick };
}

/**
 * The facts of a spike for whyOf.
 *
 * @param cause - The primary cause.
 * @param overrides - Facts to replace.
 * @returns The facts.
 */
function facts(cause: PerfCause, overrides: Partial<WhyFacts> = {}): WhyFacts {
  return {
    cause,
    ms: 41.3,
    jsMs: 12.4,
    gpuMs: 14.2,
    gapMs: 41.3,
    budgetMs: 8.33,
    fps: 120,
    uploads: { mb: 41 },
    compiles: 3,
    gpuTimer: true,
    detail: null,
    ...overrides
  };
}

/**
 * A renderer.stats() answer for the tests.
 *
 * @returns The answer.
 */
function debugStats() {
  return {
    renderPasses: 3,
    renderPassesMax: 3,
    kept: { pictures: 1, mb: 1.4, retakes: 0 },
    redraws: 0,
    rebuilds: 0
  };
}

describe("spike(frame)", () => {
  it("reads phases and counts from the ring slot", () => {
    const { state, tick } = setup();
    tick();
    const record = spikeRecord(state, SPIKE);
    expect(record).toMatchObject({
      frame: SPIKE,
      ms: 41.3,
      cause: "upload",
      causes: ["upload", "js", "gap"],
      jsMs: 29.9,
      gpuMs: 6.6,
      gapMs: 41.3,
      path: "garden/boss",
      passes: 2,
      draws: 212,
      uploads: { count: 3, mb: 41 },
      compiles: 0,
      filters: null,
      changed: ["bundle"],
      drawn: true,
      gpuPartial: false,
      fps: 60,
      at: 1_760_453_960_000 + 40_183.7
    });
    expect(record?.phases).toEqual({
      input: 0.3,
      animate: 0.4,
      layout: 0.1,
      sync: 1.2,
      signals: 0.1,
      render: 5.9,
      agent: 0.1
    });
  });

  it("reads the spike line's numbers once the slot was overwritten, and nulls without one (bug: a record of the wrong frame)", () => {
    const { state, monitor, tick } = setup(16);
    tick();
    commitFrames(monitor, 16, 40_200.4, 16.7);
    tick();
    const bare = spikeRecord(state, SPIKE);
    expect(bare).toMatchObject({
      phases: null,
      passes: null,
      draws: null,
      uploads: null,
      compiles: null,
      changed: []
    });

    const filters = { applies: 2, mpx: 1.5, kinds: [] };
    monitor.emit(spikeLine(frameRecord(SPIKE, { passes: 5, draws: 99, filters, uploads: null })));
    const read = spikeRecord(state, SPIKE);
    expect(read).toMatchObject({
      passes: 5,
      draws: 99,
      filters: { applies: 2, mpx: 1.5 },
      uploads: null,
      changed: ["bundle"]
    });
    expect(read?.phases?.render).toBe(5.9);
  });

  it("carries the engine's spike line once it arrived", () => {
    const { state, monitor, tick } = setup();
    tick();
    expect(spikeRecord(state, SPIKE)?.detail).toBeNull();
    const line = spikeLine(frameRecord(SPIKE));
    monitor.emit(line);
    expect(spikeRecord(state, SPIKE)?.detail).toBe(line);
    expect(spikeRecord(state, SPIKE)?.why).toBe(
      "41.0 MB of textures uploaded this frame (bundle garden-boss)"
    );
  });

  it("answers undefined for a frame that is not a spike or not in the window", () => {
    const { state, tick } = setup();
    tick();
    expect([spikeRecord(state, 1), spikeRecord(state, 999)]).toEqual([undefined, undefined]);
  });

  it("never lets NaN reach a value: no GPU and no gap are null", () => {
    const { state, monitor, tick } = setup();
    const frame = monitor.commit({ t: 40_300, workMs: 30, causes: 0b10 });
    tick();
    const record = spikeRecord(state, frame);
    expect([record?.gpuMs, record?.gapMs, record?.filters]).toEqual([null, null, null]);
    expect(JSON.stringify(record)).not.toContain("NaN");
  });
});

describe("a record's numbers", () => {
  it("reads the filters of the slot and has no epoch time before a header", () => {
    const perf = perfState();
    const monitor = createFakeMonitor({ header: null });
    attach(perf.state, monitor);
    const frame = monitor.commit({
      t: 10,
      workMs: 30,
      causes: 0b10,
      filterApplies: 4,
      filterMpx: 2.5
    });
    readTick(perf.state, perf.config);
    expect(spikeRecord(perf.state, frame)).toMatchObject({
      filters: { applies: 4, mpx: 2.5 },
      at: null
    });
  });
});

describe("a record's events", () => {
  it("lists the overlay of its own frame, not another frame's (bug: an overlay of another frame blamed for this spike)", () => {
    const { state, monitor, tick } = setup();
    tick();
    const detail = { entity: 412, label: "shopDimLayer", what: "open", mode: "freeze" };
    monitor.emit(eventLine("overlay", SPIKE, detail));
    monitor.emit(eventLine("overlay", 4790, { ...detail, label: "toast" }));
    monitor.emit(eventLine("overlay", SPIKE, { ...detail, what: "closed" }));
    expect(spikeRecord(state, SPIKE)?.events).toEqual([
      { kind: "overlay", frame: SPIKE, label: "shopDimLayer", what: "open", mode: "freeze" }
    ]);
  });

  it("lists a pool-trim of the frame before, but not a warm-up of the frame before (bug: the trim that caused the re-allocation missing)", () => {
    const { state, monitor, tick } = setup();
    tick();
    monitor.emit(eventLine("pool-trim", SPIKE - 1, { reason: "rest", freedMb: 41.5 }));
    monitor.emit(eventLine("warm", SPIKE - 1, { draws: 12 }));
    expect(spikeRecord(state, SPIKE)?.events).toEqual([
      { kind: "pool-trim", frame: SPIKE - 1, reason: "rest", freedMb: 41.5 }
    ]);
  });

  it("is empty without a frame event", () => {
    const { state, tick } = setup();
    tick();
    expect(spikeRecord(state, SPIKE)?.events).toEqual([]);
  });
});

describe("whyOf", () => {
  it("says why for each cause", () => {
    expect(whyOf(facts("gpu"))).toBe(
      "The GPU needed 14.2 ms for this frame, over its 8.3 ms budget (120 fps)"
    );
    expect(whyOf(facts("upload"))).toBe("41.0 MB of textures uploaded this frame");
    expect(whyOf(facts("compile"))).toBe("3 shader compiles on first use this frame");
    expect(whyOf(facts("compile", { compiles: 1 }))).toBe(
      "1 shader compile on first use this frame"
    );
    expect(whyOf(facts("longFrame"))).toBe(
      "A long animation frame overlapped: script held the main thread for 41.3 ms"
    );
    expect(whyOf(facts("js"))).toBe(
      "Work ran 12.4 ms on the main thread, over its 8.3 ms budget (120 fps)"
    );
    expect(whyOf(facts("gc?"))).toBe(
      "The loop paused 41.3 ms with no JS work; Chrome hints it was likely GC (a hint, never a certainty)"
    );
    expect(whyOf(facts("gap"))).toBe(
      "The loop paused 41.3 ms with no JS work: GC, OS or compositor"
    );
  });

  it("says the compiles came in the 4 frames before when the frame compiled nothing itself, and names no count it does not know (engine: a compile cause on a gap spike may come from the 4 frames before)", () => {
    expect(whyOf(facts("compile", { compiles: 0 }))).toBe(
      "Shader compiles on first use in the 4 frames before stalled this frame"
    );
    expect(whyOf(facts("compile", { compiles: null }))).toBe(
      "Shader compiles on first use stalled this frame"
    );
  });

  it("adds the subjects the detail names: the bundle, the first labelled compile, the top script", () => {
    const detail = spikeLine(frameRecord(SPIKE), {
      compiles: [
        { label: null, ms: 3 },
        { label: "frost-blur", ms: 9 }
      ],
      longFrames: [
        {
          startMs: 1,
          durationMs: 88,
          blockingMs: 38,
          renderStartMs: null,
          styleLayoutMs: null,
          scripts: [
            { invoker: "a", type: "x", source: "main.js", fn: "", ms: 5, forcedLayoutMs: 0 },
            {
              invoker: "b",
              type: "x",
              source: "board.js",
              fn: "layoutBoard",
              ms: 60,
              forcedLayoutMs: 0
            }
          ]
        }
      ]
    });
    expect(whyOf(facts("upload", { detail }))).toBe(
      "41.0 MB of textures uploaded this frame (bundle garden-boss)"
    );
    expect(whyOf(facts("compile", { detail, compiles: 2 }))).toBe(
      "2 shader compiles on first use this frame (frost-blur)"
    );
    expect(whyOf(facts("longFrame", { detail }))).toBe(
      "A long animation frame overlapped: script held the main thread for 88.0 ms (layoutBoard)"
    );
  });

  it("counts the detail's compiles when the slot has none, and names the longest long frame's top script by its source", () => {
    const script = { invoker: "a", type: "x", forcedLayoutMs: 0 };
    const detail = spikeLine(frameRecord(SPIKE), {
      compiles: [
        { label: null, ms: 3 },
        { label: null, ms: 4 }
      ],
      longFrames: [
        {
          startMs: 1,
          durationMs: 52,
          blockingMs: null,
          renderStartMs: null,
          styleLayoutMs: null,
          scripts: []
        },
        {
          startMs: 2,
          durationMs: 70,
          blockingMs: null,
          renderStartMs: null,
          styleLayoutMs: null,
          scripts: [
            { ...script, source: "a.js", fn: "small", ms: 3 },
            { ...script, source: "pixi.js", fn: "", ms: 40 }
          ]
        }
      ]
    });
    expect(whyOf(facts("compile", { detail, compiles: null }))).toBe(
      "2 shader compiles on first use this frame"
    );
    expect(whyOf(facts("longFrame", { detail }))).toBe(
      "A long animation frame overlapped: script held the main thread for 70.0 ms (pixi.js)"
    );
  });

  it("warns that a busy GPU reads as a gap where the page has no GPU timer", () => {
    expect(whyOf(facts("gap", { gpuTimer: false, gapMs: null, ms: 33.3 }))).toBe(
      "The loop paused 33.3 ms with no JS work: GC, OS or compositor. This browser has no GPU timer, so a busy GPU also reads as a gap"
    );
  });
});

describe("spikes({ lastMs })", () => {
  it("filters by lastMs before the newest frame and clamps it to 0…windowMs", () => {
    const { state, config, monitor, tick } = setup(256);
    commitFrames(monitor, 120, 40_200.4, 16.7);
    tick();
    const newest = state.window.t[state.window.count - 1] ?? 0;
    const ago = newest - 40_183.7;
    expect(spikeSummaries(state, config).map(spike => spike.frame)).toEqual([SPIKE]);
    expect(spikeSummaries(state, config, { lastMs: ago + 1 })).toHaveLength(1);
    expect(spikeSummaries(state, config, { lastMs: ago - 1 })).toEqual([]);
    expect(spikeSummaries(state, config, { lastMs: -5 })).toEqual([]);
    expect(spikeSummaries(state, config, { lastMs: Number.NaN })).toHaveLength(1);
    expect(spikeSummaries(state, config, { lastMs: 1e9 })).toHaveLength(1);
    const [summary] = spikeSummaries(state, config);
    expect(Object.keys(summary ?? {})).toEqual([
      "frame",
      "agoMs",
      "ms",
      "budgetMs",
      "overMs",
      "cause",
      "causes",
      "jsMs",
      "gpuMs",
      "path",
      "why"
    ]);
    expect(summary?.agoMs).toBeCloseTo(ago, 1);
  });
});

describe("second()", () => {
  it("has nulls and a 16.7 budget before a header and before any frame", () => {
    const { state } = perfState();
    expect(secondOf(state)).toEqual({
      state: "waiting",
      fps: { loop: 0, drawn: 0 },
      spikes: 0,
      budgetMs: 16.7,
      rate: { fps: null, mode: null, reason: null, displayHz: null, switches: 0 },
      activity: {
        idle: false,
        idleSince: null,
        idleFrames: 0,
        idleMs: 0,
        breaks: 0,
        p90Ms: null
      },
      gpuTime: null,
      render: null,
      sample: null,
      display: null,
      device: null,
      gpu: null,
      build: null,
      engine: null
    });
  });

  it("copies renderer.stats(), kept MB included (bug: the texture counter's kept stuck at 0 after spec 23)", () => {
    const stats = debugStats;
    const { state, tick } = setup(64, stats);
    tick();
    const second = secondOf(state);
    expect(second.render).toEqual({
      passesMax: 3,
      kept: { pictures: 1, mb: 1.4, retakes: 0 },
      redraws: 0,
      rebuilds: 0
    });
    expect(second).toMatchObject({ state: "on", spikes: 1, build: "debug-20261014T160000Z" });
    expect(second.device).toEqual(headerLine().device);
  });

  it("has a null render for a renderer without stats", () => {
    const { state, tick } = setup();
    tick();
    expect(secondOf(state).render).toBeNull();
  });

  it("says the screen rests, since when, its idle frames and time, and the p90 of the awake frames (bug: p90 ≈ 1000 ms on a still screen)", () => {
    const perf = perfState();
    const monitor = createFakeMonitor({ capacity: 256 });
    attach(perf.state, monitor);
    for (let index = 0; index < 10; index += 1) {
      const heavy = index >= 8;
      monitor.commit({
        t: index * 16.7,
        gapMs: 16.7,
        workMs: heavy ? 30 : 3,
        causes: heavy ? 0b10 : 0
      });
    }
    commitFrames(monitor, 6, 200, 500, { idle: true, capMs: 33.33 });
    readTick(perf.state, perf.config);
    const { activity } = secondOf(perf.state);
    expect(activity).toEqual({
      idle: true,
      idleSince: headerLine().timeOrigin + 200,
      idleFrames: 6,
      idleMs: 3000,
      breaks: 0,
      p90Ms: 30
    });
  });

  it("is awake with no idle frames while the loop runs", () => {
    const { state, tick } = setup();
    tick();
    expect(secondOf(state).activity).toMatchObject({
      idle: false,
      idleSince: null,
      idleFrames: 0,
      breaks: 0
    });
  });
});

describe("second().gpuTime (spec 03 delta item 8: the headline GPU over the window)", () => {
  it("is the p50 and p90 GPU time of the window's drawn frames, to hundredths, not one frame's", () => {
    const perf = perfState();
    const monitor = createFakeMonitor({ capacity: 256 });
    attach(perf.state, monitor);
    for (let index = 0; index < 20; index += 1) {
      monitor.commit({
        t: index * 16.7,
        gapMs: 16.7,
        gpuMs: index === 7 ? 24.5 : 0.49 + index / 1000
      });
    }
    readTick(perf.state, perf.config);
    expect(secondOf(perf.state).gpuTime).toEqual({ p50Ms: 0.5, p90Ms: 0.51 });
  });

  it("is null without a measured GPU time (no GPU timer)", () => {
    const perf = perfState();
    const monitor = createFakeMonitor();
    attach(perf.state, monitor);
    commitFrames(monitor, 5, 0, 16.7);
    readTick(perf.state, perf.config);
    expect(secondOf(perf.state).gpuTime).toBeNull();
  });
});

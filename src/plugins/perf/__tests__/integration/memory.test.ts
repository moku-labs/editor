// @vitest-environment happy-dom
import { PERF_CAUSES } from "@moku-labs/game";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  heapMeasured,
  logLeak,
  measureGrowth
} from "../../../../../tests/integration/helpers/heap";
import { agentCoreConfig, createAgentCore } from "../../../../config";
import { registryPlugin } from "../../../registry";
import type { GameLike } from "../../../registry/types";
import { perfPlugin } from "../..";
import type { GraphContext2D, GraphLayer, GraphState, GraphView } from "../../graph";
import { createGraphState, paintGraph } from "../../graph";
import { graphLook } from "../../graph/themes";
import type { PerfWindowView } from "../../protocol";
import { CAUSE_BITS, GPU_BIT, REST } from "../../protocol";
import type { WindowRow } from "../helpers";
import { windowOf } from "../helpers";
import { stallOnce, startPair } from "../real-engine";

// ─────────────────────────────────────────────────────────────────────────────
// M1 (spec 10, Delta 2026-10-16): perf keeps no memory it does not mean to.
// The reader on the real engine's ring over 20 000 mixed frames, the graph
// painter over 10 000 paints of a full window, and 200 start/stop cycles of
// the plugin: the heap after a forced GC grows less than a fixed ceiling once
// warm, and a stopped plugin leaves no timer and no state behind. Each test
// prints its numbers (`[leak] …`).
// ─────────────────────────────────────────────────────────────────────────────

/** Bytes in a KiB. */
const KIB = 1024;

/** A test's own bound: the work is seconds, the default 5 s is not enough on a loaded machine. */
const TEST_MS = 60_000;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** The engine's ring bit of a GPU over budget (its own cause order). */
const ENGINE_GPU_BIT = 1 << PERF_CAUSES.indexOf("gpu");

/** rAF frames of one scripted cycle: awake (work, a stall, GPU outliers, a break), then rest. */
const CYCLE = 400;

/** The awake frames at the start of a cycle; the rest of it rests (idle cap, nothing drawn). */
const AWAKE = 150;

/** Which rest states and cause bits the window held, OR-ed over the run (allocation-free). */
type Seen = { rest: number; causes: number; noise: number };

describe("perf memory (M1)", () => {
  it("the reader on the real engine's ring keeps its heap flat over 20 000 frames (after 12 000 warm) of awake, idle, wake, break and GPU outliers (bug: a per-read array, a growing history, a closure per frame)", {
    timeout: TEST_MS
  }, async () => {
    const { game, editor, step } = await startPair({ onDemand: true, idleAfterMs: 2000 });
    const work = stallOnce(game);
    const ring = game.renderer.monitor.frames();
    const seen: Seen = { rest: 0, causes: 0, noise: 0 };
    const visit = (window: PerfWindowView): void => {
      for (let row = 0; row < window.count; row += 1) {
        seen.rest |= 1 << (window.rest?.[row] ?? 0);
        seen.causes |= window.causes[row] ?? 0;
        seen.noise |= window.noise?.[row] ?? 0;
      }
    };
    let late = -1;

    // A GPU time the stand-in renderer cannot measure, written where the engine's timer writes
    // it: the newest slot over budget, still partial (it lands a few frames later) or landed.
    const gpuOutlier = (partial: boolean): void => {
      const slot = ring.newest;
      ring.columns.gpuMs[slot] = 30;
      ring.columns.causes[slot] = (ring.columns.causes[slot] ?? 0) | ENGINE_GPU_BIT;
      ring.columns.gpuPartial[slot] = partial ? 1 : 0;
      if (partial) late = slot;
    };

    const frame = (round: number): void => {
      const at = round % CYCLE;
      if (at >= AWAKE) {
        step(16.7); // rest: nothing drawn on demand, the idle cap after idleAfterMs
        return;
      }
      game.time.wake(); // the first frame of a cycle wakes from the rest
      if (at === 120) {
        step(1001); // a break: the browser made no frame for a second
        return;
      }
      work.arm(at === 40 ? 40 : 3); // 40 ms of work is a js spike
      step(16.7);
      if (at === 60 || at === 61 || at === 63) gpuOutlier(at === 60); // sustained: 2 of 3
      if (at === 100) gpuOutlier(false); // a lone outlier: noise
      if (at === 64 && late >= 0) {
        ring.columns.gpuPartial[late] = 0;
        ring.columns.gpuMs[late] = 32;
        late = -1;
      }
      if (at === AWAKE - 1) editor.perf.readWindow(visit);
    };

    // The heap takes one step of a few hundred objects somewhere in the first 12 000 frames (it
    // stays the same over 8 000 or 32 000 more): the warmup covers it.
    const ceiling = { heapBytes: 256 * KIB, objects: 500 };
    const growth = await measureGrowth(frame, { warmup: 12_000, rounds: 20_000, ceiling });
    logLeak("perf reader, real engine, 20 000 frames", {
      ...growth,
      counts: { committed: ring.written }
    });

    expect(seen.rest).toBe(
      (1 << REST.awake) | (1 << REST.idle) | (1 << REST.woke) | (1 << REST.break)
    );
    expect(seen.causes & (1 << CAUSE_BITS.indexOf("js"))).not.toBe(0);
    expect(seen.causes & GPU_BIT).not.toBe(0);
    expect(seen.noise & GPU_BIT).not.toBe(0);
    if (heapMeasured(growth)) expect(growth.heapBytes).toBeLessThan(ceiling.heapBytes);
    // Tighter than the spec's 2 000: steady runs read +6 to +12, and one small object kept per read
    // (4 Hz) reads +1 600 here.
    if (growth.objects !== undefined) expect(growth.objects).toBeLessThan(ceiling.objects);

    await editor.stop();
    await game.stop();
  });

  it("the graph painter keeps its heap flat over 10 000 paints of a full window, every layer in both looks (bug: the allocation-free painter allocating per paint)", {
    timeout: TEST_MS
  }, async () => {
    const window = fullWindow();
    const { g, counts } = countingContext();
    const looks = [
      { width: 273, height: 108, wide: false, selected: -1, leadPx: 9 },
      { width: 1000, height: 200, wide: true, selected: -1, look: graphLook("dark") }
    ] satisfies GraphView[];
    const paints: Paint[] = [];
    for (const look of looks) {
      for (const layer of LAYERS) {
        paints.push({ view: { ...look, layer }, state: createGraphState(window.capacity) });
      }
    }

    const paint = (round: number): void => {
      const job = paints[round % paints.length];
      if (job === undefined) return;
      const { view } = job;
      // Another row selected now and then (the caption is rebuilt), the tools' now moving.
      view.selected = round % 50 === 0 ? (round * 37) % window.count : -1;
      if (view.wide) view.nowMs = window.endMs - 125 + (round % 250);
      paintGraph(g, window, view, job.state);
    };

    const ceiling = { heapBytes: 128 * KIB, objects: 1000 };
    const growth = await measureGrowth(paint, {
      warmup: paints.length * 50,
      rounds: 10_000,
      ceiling
    });
    logLeak("perf graph, 10 000 paints, every layer in both looks", {
      ...growth,
      counts: { fillRect: counts.fillRect, fillText: counts.fillText }
    });

    expect(counts.fillRect).toBeGreaterThan(10_000);
    expect(counts.fillText).toBeGreaterThan(0);
    if (growth.objects !== undefined) expect(growth.objects).toBeLessThan(ceiling.objects);
    if (heapMeasured(growth)) expect(growth.heapBytes).toBeLessThan(ceiling.heapBytes);
  });

  it("200 start/stop cycles of the perf plugin on the real engine keep the heap flat and leave no timer and no stopped state (bug: a stream listener or read timer kept by a stopped perf)", {
    timeout: TEST_MS
  }, async () => {
    const { game, editor, step } = await startPair();
    await editor.stop();
    // A page has a title: happy-dom, asked for the title of a page without one (the registry's
    // game name, read at every start), caches a fresh lookup on every element each time.
    document.title = "perf memory";
    const { createApp } = createAgentCore(agentCoreConfig, {
      plugins: [registryPlugin, perfPlugin]
    });
    const timers = vi.getTimerCount();
    const windows: WeakRef<object>[] = [];
    const keep = (window: PerfWindowView): void => {
      windows.push(new WeakRef(window));
    };

    const cycle = async (round: number): Promise<void> => {
      const cycled = createApp({
        pluginConfigs: { registry: { game: game as unknown as GameLike } }
      });
      cycled.log.clearSinks();
      await cycled.start();
      for (let index = 0; index < 20; index += 1) step(16.7);
      vi.advanceTimersByTime(250);
      // A weak reference to every 10th stopped window: few enough not to count as growth.
      if (round % 10 === 0) cycled.perf.readWindow(keep);
      await cycled.stop();
    };

    // Under Bun the heap takes a one-time step in the first few hundred cycles: the warmup covers it.
    const ceiling = { heapBytes: 256 * KIB, objects: 400 };
    const growth = await measureGrowth(cycle, { warmup: 1000, rounds: 200, ceiling });
    const timersLeft = vi.getTimerCount() - timers;
    const alive = windows.filter(window => window.deref() !== undefined).length;
    logLeak("perf start/stop, 200 cycles", {
      ...growth,
      counts: { timers: timersLeft, "windows alive": alive }
    });

    expect(timersLeft).toBe(0);
    // The collector scans the stack conservatively: the newest stopped window may still look live.
    expect(alive).toBeLessThanOrEqual(2);
    if (growth.objects !== undefined) expect(growth.objects).toBeLessThan(ceiling.objects);
    if (heapMeasured(growth)) expect(growth.heapBytes).toBeLessThan(ceiling.heapBytes);
    await game.stop();
  });
});

/** Every layer the painter takes. */
const LAYERS: readonly GraphLayer[] = ["all", "plot", "fixed", "base", "over"];

/** A view the paint loop changes in place (the overlay keeps one per canvas the same way). */
type MutableView = { -readonly [Key in keyof GraphView]: GraphView[Key] };

/** One layer and look to paint, with the painter state of its canvas. */
type Paint = { readonly view: MutableView; readonly state: GraphState };

/**
 * A 2D context that counts what the painter draws, in fixed counters (no list that grows).
 *
 * @returns The context and its counts.
 */
function countingContext() {
  const counts = { fillRect: 0, strokeRect: 0, path: 0, fillText: 0 };
  const g: GraphContext2D = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    fillRect: () => {
      counts.fillRect += 1;
    },
    strokeRect: () => {
      counts.strokeRect += 1;
    },
    beginPath: () => {
      counts.path += 1;
    },
    closePath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    fill: () => undefined,
    stroke: () => undefined,
    setLineDash: () => undefined,
    fillText: () => {
      counts.fillText += 1;
    },
    measureText: text => ({ width: text.length * 6 })
  };
  return { g, counts };
}

/**
 * A full window of 1024 rows: awake frames at three rates, every cause as a spike, GPU noise, rests
 * with their wakes, and breaks.
 *
 * @returns The window.
 */
function fullWindow(): PerfWindowView {
  const rows: WindowRow[] = [];
  let t = 0;
  for (let index = 0; index < 1024; index += 1) {
    const row = rowAt(index, t);
    rows.push(row);
    t += row.ms ?? 0;
  }
  return windowOf(rows, { spanMs: t, gpuTimer: true });
}

/**
 * The rate of row `index` of the full window: 60 fps, then 120, then 30.
 *
 * @param index - The row.
 * @returns One frame of the rate, ms.
 */
function rateAt(index: number): number {
  if (index < 340) return 16.67;
  return index < 680 ? 8.33 : 33.33;
}

/**
 * Row `index` of the full window, starting at `t`.
 *
 * @param index - The row.
 * @param t - Its page-clock start.
 * @returns The row.
 */
function rowAt(index: number, t: number): WindowRow {
  const rateMs = rateAt(index);
  const rest = restAt(index);
  const spike = rest === REST.awake && index % 23 === 0;
  const frameMs = spike ? rateMs + 30 : rateMs;
  return {
    t,
    ms: rest === REST.break ? 1001 : frameMs,
    rateMs,
    budgetMs: rateMs,
    jsMs: spike ? 30 : 3,
    gpuMs: index % 11 === 0 ? 24 : 4,
    noise: index % 31 === 0 ? GPU_BIT : 0,
    drawn: rest === REST.idle ? 0 : 1,
    causes: spike ? 1 << (Math.floor(index / 23) % CAUSE_BITS.length) : 0,
    rest
  };
}

/**
 * The rest state of row `index` of the full window: a rest of 40 rows every 200, the wake after it,
 * a break every 300.
 *
 * @param index - The row.
 * @returns The rest state.
 */
function restAt(index: number): number {
  const at = index % 200;
  if (at >= 150 && at < 190) return REST.idle;
  if (at === 190) return REST.woke;
  if (index % 300 === 299) return REST.break;
  return REST.awake;
}

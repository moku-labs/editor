/* eslint-disable unicorn/no-null -- null is "none" in perf's and connect's values */
import { describe, expect, it } from "vitest";
import {
  baselineLine,
  baselinesOf,
  breakdownOf,
  counterGrowing,
  isLeak,
  leakTrend,
  memorySourceLine,
  memoryView,
  objectsLine,
  processLine,
  slopePerMinute
} from "../../derive/memory";
import { createMissionSeries, pushSample } from "../../series/series";
import type { DeviceTelemetry, PerfMemory, PerfSecond } from "../../source/contract";
import { createPerfHistory } from "../../source/contract";
import { secondOf } from "../device-fixtures";
import { line, withEvents } from "../mission-fixtures";

// ─────────────────────────────────────────────────────────────────────────────
// derive/memory.ts (spec 09 § M9 Memory, "Memory source rule"): which heap to
// believe, baselines after GCs and Leak?.
// ─────────────────────────────────────────────────────────────────────────────

const WEBVIEW: PerfMemory = {
  heapMb: 10.68,
  source: "performance.memory",
  trusted: false,
  why: "webview",
  processMb: null
};
const TRUSTED: PerfMemory = {
  heapMb: 41.9,
  source: "performance.memory",
  trusted: true,
  why: null,
  processMb: null
};

/**
 * A wired telemetry record.
 *
 * @param heap - Whether CDP's heap is available.
 * @returns The record.
 */
function telemetryOf(heap: boolean): DeviceTelemetry {
  const off = { available: false as const, source: "none", reason: "warming-up" as const };
  return {
    v: 1,
    device: "d-7f3a",
    serial: "R5CX30ABCDE",
    at: 1,
    wired: true,
    gpu: off,
    cpu: { cores: 8, app: off, renderer: off, surfaceflinger: off },
    memory: {
      app: {
        available: true,
        source: "dumpsys meminfo",
        value: {
          pid: 23_811,
          totalPssMb: 541,
          javaMb: 18.2,
          nativeMb: 96.4,
          graphicsMb: 210.5,
          glMb: null,
          codeMb: 61.3,
          stackMb: 1.2,
          otherMb: 22.4,
          systemMb: 31.9,
          at: 1000
        }
      },
      renderer: {
        available: true,
        source: "dumpsys meminfo",
        value: {
          pid: 2,
          totalPssMb: 424,
          javaMb: null,
          nativeMb: null,
          graphicsMb: null,
          glMb: null,
          codeMb: null,
          stackMb: null,
          otherMb: null,
          systemMb: null,
          at: 1000
        }
      }
    },
    heap: heap
      ? {
          available: true,
          source: "cdp Runtime.getHeapUsage",
          value: { samples: [{ t: 1, usedMb: 41.9, totalMb: 64 }], gcs: [] }
        }
      : { available: false, source: "none", reason: "no-devtools-socket" }
  };
}

/**
 * The memory input.
 *
 * @param overrides - Field overrides.
 * @returns The input.
 */
function inputOf(overrides: Partial<Parameters<typeof memoryView>[0]> = {}) {
  return {
    second: secondOf({ memory: WEBVIEW } as Partial<PerfSecond>),
    telemetry: undefined,
    series: createMissionSeries(),
    history: createPerfHistory(),
    device: true,
    ...overrides
  };
}

describe("the source rule", () => {
  it("a device whose telemetry heap is not available reads 'not measured on this device' even when second.memory.heapMb is a number", () => {
    // Bug: the A26 WebView's frozen 10.68 MB shown as the phone's heap.
    const view = memoryView(inputOf({ telemetry: telemetryOf(false) }));
    expect(view.source).toBe("none");
    expect(view.heapMb).toBeNull();
    expect(memorySourceLine("none", { ios: false, link: "wire" })).toBe(
      "Not available: not measured on this device"
    );
    expect(memorySourceLine("none", { ios: true, link: "network" })).toBe(
      "Not available: by wire is Android only"
    );
    expect(memorySourceLine("none", { ios: false, link: "network" })).toBe(
      "Not available: connect by wire to read the heap"
    );
  });

  it("an untrusted heap (webview, frozen) is never shown; the local preview uses a trusted performance.memory", () => {
    // Bug: a frozen desktop counter charted as a flat heap.
    const frozen = inputOf({
      device: false,
      second: secondOf({
        memory: { ...TRUSTED, trusted: false, why: "frozen" }
      } as Partial<PerfSecond>)
    });
    expect(memoryView(frozen)).toMatchObject({ source: "none", heapMb: null });
    const local = inputOf({
      device: false,
      second: secondOf({ memory: TRUSTED } as Partial<PerfSecond>)
    });
    expect(memoryView(local)).toMatchObject({ source: "performance.memory", heapMb: 41.9 });
    expect(memorySourceLine("performance.memory", { ios: false, link: "local" })).toBe(
      "JS heap (performance.memory, coarse)"
    );
  });

  it("the wired heap comes from telemetry; process memory is shown beside it, never as heap", () => {
    // Bug: 541 MB of PSS shown as the JS heap.
    const view = memoryView(inputOf({ telemetry: telemetryOf(true) }));
    expect(view).toMatchObject({
      source: "cdp",
      heapMb: 41.9,
      processMb: { app: 541, renderer: 424 }
    });
    expect(memorySourceLine("cdp", { ios: false, link: "wire" })).toBe(
      "JS heap via DevTools over USB"
    );
    expect(processLine(view.processMb)).toEqual([
      "Process memory: app ",
      { strong: "541 MB" },
      ", renderer ",
      { strong: "424 MB" },
      " (whole process, PSS)"
    ]);
    const shell = memoryView(
      inputOf({
        second: secondOf({
          memory: { ...WEBVIEW, source: "shell", processMb: 612 }
        } as Partial<PerfSecond>)
      })
    );
    expect(shell).toMatchObject({
      source: "shell",
      heapMb: null,
      processMb: { app: 612, renderer: null }
    });
  });

  it("the breakdown lists each process's parts, null parts left out", () => {
    // Bug: a "GL 0 MB" row the table never had.
    const [app, renderer] = breakdownOf(telemetryOf(true), 6000);
    expect(app?.title).toBe("App, pid 23811 — 541 MB");
    expect(app?.parts.map(part => part.name)).toEqual([
      "Java heap",
      "Native heap",
      "Graphics",
      "Code",
      "Stack",
      "Other",
      "System"
    ]);
    expect(app?.read).toBe("read 5 s ago");
    expect(renderer?.parts).toEqual([]);
  });
});

/**
 * Three baselines a minute long at a slope.
 *
 * @param slope - MB per minute.
 * @returns The baselines.
 */
function at(slope: number) {
  return [0, 30_000, 60_000].map(t => ({ t, mb: 30 + (slope * t) / 60_000 }));
}

describe("baselines and Leak?", () => {
  it("the baseline is the lowest sample within 1 s after a GC", () => {
    // Bug: the heap before the GC (or a sample seconds later) taken as the baseline.
    const series = createMissionSeries();
    for (const [t, mb] of [
      [900, 60],
      [1100, 35],
      [1500, 30],
      [1900, 32],
      [2500, 25]
    ] as const)
      pushSample(series.heap, t, mb);
    expect(baselinesOf(series.heap, [1000])).toEqual([{ t: 1500, mb: 30 }]);
    expect(baselinesOf(series.heap, [5000])).toEqual([]);
  });

  it("Leak? needs 3 baselines over ≥ 60 s and ≥ 0.5 MB/min (0.49 steady, 0.5 Leak?)", () => {
    // Bug: a leak called on two GCs, or a boundary slope of 0.5 called steady.
    const objects = createMissionSeries().objects;
    expect(isLeak(at(0.49), objects)).toBe(false);
    expect(isLeak(at(0.5), objects)).toBe(true);
    expect(isLeak(at(2).slice(0, 2), objects)).toBe(false);
    expect(
      isLeak(
        [
          { t: 0, mb: 30 },
          { t: 20_000, mb: 31 },
          { t: 40_000, mb: 32 }
        ],
        objects
      )
    ).toBe(false);
    expect(
      slopePerMinute([
        { t: 0, mb: 27.4 },
        { t: 120_000, mb: 31 }
      ])
    ).toBeCloseTo(1.8, 6);
    expect(baselineLine(at(1.8), "2 min")).toEqual([
      "Baseline after GC ",
      { strong: "30 → 31.8 MB" },
      " in 2 min, ",
      { strong: "+1.8 MB/min" }
    ]);
  });

  it("a growing object counter alone raises Leak?; a counter that falls once is not growing", () => {
    // Bug: a listener leak missed because the heap looked steady; a counter that recovers flagged.
    const series = createMissionSeries();
    for (let second = 0; second <= 90; second += 10)
      pushSample(series.objects.frameListeners, second * 1000, 200 + second * 2);
    expect(counterGrowing(series.objects.frameListeners)).toBe(true);
    expect(isLeak([], series.objects)).toBe(true);
    expect(objectsLine(series.objects)).toEqual(["Objects: ", { strong: "listeners +120/min" }]);
    pushSample(series.objects.frameListeners, 100_000, 100);
    expect(counterGrowing(series.objects.frameListeners)).toBe(false);
    expect(objectsLine(createMissionSeries().objects)).toEqual(["Objects steady"]);
  });

  it("the local preview's baselines follow the engine's gc events", () => {
    // Bug: no trend on a desktop page (GCs looked for in the phone's telemetry only).
    const history = withEvents(createPerfHistory(), [
      line.gc(1000, null, 4),
      line.gc(61_000, null, 4),
      line.gc(121_000, null, 4)
    ]);
    const series = createMissionSeries();
    for (const [t, mb] of [
      [1200, 30],
      [61_200, 31],
      [121_200, 32]
    ] as const)
      pushSample(series.heap, t, mb);
    const view = memoryView(
      inputOf({
        device: false,
        history,
        series,
        second: secondOf({ memory: TRUSTED } as Partial<PerfSecond>)
      })
    );
    expect(view).toMatchObject({ leak: true, slopeMbPerMin: 1 });
  });
});

/**
 * A local preview's input with three GCs a minute apart and the heap after each.
 *
 * @param after - The heap 200 ms after each GC, MB.
 * @returns The input.
 */
function localWith(after: readonly [number, number, number]) {
  const history = withEvents(createPerfHistory(), [
    line.gc(1000, null, 4),
    line.gc(61_000, null, 4),
    line.gc(121_000, null, 4)
  ]);
  const series = createMissionSeries();
  for (const [index, mb] of after.entries()) pushSample(series.heap, 1200 + index * 60_000, mb);
  return inputOf({
    device: false,
    history,
    series,
    second: secondOf({ memory: TRUSTED } as Partial<PerfSecond>)
  });
}

describe("the trend the Memory card draws", () => {
  it("is the baselines' least-squares line while Leak? holds, and none while the heap is steady", () => {
    // Bug: the warn trend drawn over a steady heap, or a leak shown without its line.
    const trend = leakTrend(localWith([30, 31.8, 33.6]));
    expect((trend?.perMs ?? 0) * 60_000).toBeCloseTo(1.8, 4);
    const lineAt = (t: number) => (trend?.mb ?? 0) + (trend?.perMs ?? 0) * (t - (trend?.t ?? 0));
    expect(lineAt(1200)).toBeCloseTo(30, 4);
    expect(lineAt(121_200)).toBeCloseTo(33.6, 4);

    expect(leakTrend(localWith([30, 30.2, 30.1]))).toBeUndefined();
  });
});

describe("the CDP heap between records", () => {
  it("keeps the newest placed sample when a record carries no new one", () => {
    // Bug: the heap reading "—" every other second (records without samples).
    const series = createMissionSeries();
    pushSample(series.heap, 1000, 38.5);
    const telemetry = telemetryOf(true);
    const empty: DeviceTelemetry = {
      ...telemetry,
      heap: { available: true, source: "cdp Runtime.getHeapUsage", value: { samples: [], gcs: [] } }
    };
    expect(memoryView(inputOf({ telemetry: empty, series })).heapMb).toBe(38.5);
    expect(memoryView(inputOf({ telemetry: empty })).heapMb).toBeNull();
  });
});

/* eslint-disable unicorn/no-null -- null is "no reading" in telemetry and on the wire */
import { describe, expect, it } from "vitest";
import { addSecond } from "../../series/samples";
import { clearSeries, createMissionSeries, pushSample } from "../../series/series";
import { addTelemetry } from "../../series/telemetry";
import type { DeviceTelemetry, PerfMemory, PerfSecond } from "../../source/contract";
import { sampleOf, secondOf } from "../device-fixtures";

// ─────────────────────────────────────────────────────────────────────────────
// series/telemetry.ts, series/samples.ts and series/series.ts (spec 09 § M11, M2
// rule 6): a wired phone's records placed on the source clock, the 1 Hz series of
// the second, the 2-minute trim and the reset of a source switch.
// ─────────────────────────────────────────────────────────────────────────────

/** The computer's epoch ms of the record. */
const AT = 1_792_000_050_000;

/** The page's time origin (the second's epoch). */
const ORIGIN = 1_792_000_000_000;

/**
 * A telemetry record of the A26: heap samples and an inferred GC, load readings.
 *
 * @param overrides - Field overrides.
 * @returns The record.
 */
function recordOf(overrides: Partial<DeviceTelemetry> = {}): DeviceTelemetry {
  return {
    v: 1,
    device: "d-7f3a",
    serial: "R5CX30ABCDE",
    at: AT,
    wired: true,
    gpu: {
      available: true,
      source: "/sys/kernel/gpu",
      value: { mhz: 585, busyPct: 64, minMhz: 221, maxMhz: 949 }
    },
    cpu: {
      cores: 8,
      app: {
        available: true,
        source: "/proc/23811/stat",
        value: { pid: 23_811, name: "com.moku.garden", pct: 27, oneCorePct: 216 }
      },
      renderer: { available: false, source: "none", reason: "ambiguous" },
      surfaceflinger: {
        available: true,
        source: "/proc/612/stat",
        value: { pid: 612, name: "surfaceflinger", pct: 11, oneCorePct: 88 }
      }
    },
    memory: {
      app: { available: false, source: "dumpsys meminfo", reason: "warming-up" },
      renderer: { available: false, source: "dumpsys meminfo", reason: "warming-up" }
    },
    heap: {
      available: true,
      source: "cdp Runtime.getHeapUsage",
      value: {
        samples: [
          { t: AT - 500, usedMb: 41.9, totalMb: 64 },
          { t: AT - 250, usedMb: 30.1, totalMb: 64 }
        ],
        gcs: [{ t: AT - 250, freedMb: 11.8, inferred: true }]
      }
    },
    ...overrides
  };
}

describe("addTelemetry", () => {
  it("a telemetry record lands at at + clockOffset − timeOrigin on the source clock", () => {
    // Bug: heap samples drawn seconds off their frames (computer time used as page time).
    const series = createMissionSeries();

    const placed = addTelemetry(series, recordOf(), -412, ORIGIN);

    expect(placed).toBe(true);
    expect(series.heap.count).toBe(2);
    expect(series.heap.t[0]).toBe(AT - 500 - 412 - ORIGIN);
    expect(series.heap.v[1]).toBeCloseTo(30.1, 3);
    expect(series.gcs.t[0]).toBe(AT - 250 - 412 - ORIGIN);
    expect(series.gcs.inferred[0]).toBe(1);
    expect(series.load.cpuApp.t[0]).toBe(AT - 412 - ORIGIN);
    expect(series.load.gpuMhz.v[0]).toBe(585);
    expect(series.load.oneCore.app).toBe(216);
  });

  it("without an offset the record updates nothing on the axis", () => {
    // Bug: a phone's records mapped with offset 0 (seconds off) before two heartbeats.
    const series = createMissionSeries();

    expect(addTelemetry(series, recordOf(), null, ORIGIN)).toBe(false);
    expect(addTelemetry(series, recordOf(), 0, null)).toBe(false);
    expect(series.heap.count).toBe(0);
    expect(series.load.cpuApp.count).toBe(0);
  });

  it("a reading with available: false is stored as a gap, not 0", () => {
    // Bug: an unreadable renderer drawn as 0 % CPU (a cliff in the stacked area).
    const series = createMissionSeries();

    addTelemetry(series, recordOf(), 0, ORIGIN);

    expect(series.load.cpuRenderer.count).toBe(1);
    expect(Number.isNaN(series.load.cpuRenderer.v[0])).toBe(true);
    expect(series.load.oneCore.renderer).toBeNull();
  });

  it("a record already placed adds no second sample (dedup by time)", () => {
    // Bug: the same CDP samples appended on every record (they repeat until the next read).
    const series = createMissionSeries();

    addTelemetry(series, recordOf(), 0, ORIGIN);
    addTelemetry(series, recordOf(), 0, ORIGIN);

    expect(series.heap.count).toBe(2);
    expect(series.gcs.count).toBe(1);
    expect(series.load.gpuBusy.count).toBe(1);
  });
});

describe("pushSample", () => {
  it("drops samples older than two minutes before the newest and shifts when full", () => {
    // Bug: a series that keeps the first two minutes forever (or writes past its arrays).
    const series = createMissionSeries();
    const column = series.textures;

    for (let second = 0; second < 300; second += 1) pushSample(column, second * 1000, second);

    expect(column.count).toBeLessThanOrEqual(121);
    expect(column.t[column.count - 1]).toBe(299_000);
    expect(column.t[0]).toBeGreaterThanOrEqual(299_000 - 120_000);
  });
});

describe("addSecond", () => {
  it("adds textures, the object counters and the targets created; the heap only when trusted and asked", () => {
    // Bug: the A26 WebView's frozen performance.memory charted as the heap (spec 03 D6).
    const series = createMissionSeries();
    const webview: PerfMemory = {
      heapMb: 10.68,
      source: "performance.memory",
      trusted: false,
      why: "webview",
      processMb: null
    };
    const second: PerfSecond = {
      ...secondOf(),
      counts: {
        entities: 104,
        views: 180,
        timers: 3,
        frameListeners: 2,
        clockListeners: 1,
        inputListeners: 9
      },
      memory: webview
    };

    addSecond(series, second, 46_000, true);

    expect(series.textures.v[0]).toBe(130);
    expect(series.objects.entities.v[0]).toBe(104);
    expect(series.objects.inputListeners.v[0]).toBe(9);
    expect(series.heap.count).toBe(0);

    const trusted: PerfSecond = {
      ...second,
      memory: { ...webview, trusted: true, why: null, heapMb: 41.9 }
    };
    addSecond(series, trusted, 47_000, false);
    expect(series.heap.count).toBe(0);
    addSecond(series, trusted, 48_000, true);
    expect(series.heap.v[0]).toBeCloseTo(41.9, 3);
  });

  it("a second without a sample adds nothing", () => {
    // Bug: a waiting source charted as zeros.
    const series = createMissionSeries();

    addSecond(series, { ...secondOf(), sample: null }, 1000, true);

    expect(series.textures.count).toBe(0);
    expect(series.objects.views.count).toBe(0);
  });
});

describe("clearSeries", () => {
  it("empties every series without reallocating and bumps the version", () => {
    // Bug: a device series surviving a source switch into the local preview's cards.
    const series = createMissionSeries();
    const heap = series.heap.t;
    addTelemetry(series, recordOf(), 0, ORIGIN);
    pushSample(series.textures, 1, 2);
    series.overview.count = 3;

    clearSeries(series);

    expect(series.heap.count).toBe(0);
    expect(series.gcs.count).toBe(0);
    expect(series.textures.count).toBe(0);
    expect(series.load.cpuApp.count).toBe(0);
    expect(series.load.oneCore).toEqual({ app: null, renderer: null, flinger: null });
    expect(series.overview.count).toBe(0);
    expect(series.heap.t).toBe(heap);
    expect(series.version).toBeGreaterThan(1);
  });
});

describe("readings that are not there", () => {
  it("a missing GPU reading is a gap; render targets created come from the newer engine's sample field", () => {
    // Bug: 0 MHz charted for a node adb cannot read; render-target churn never charted.
    const series = createMissionSeries();
    addTelemetry(
      series,
      recordOf({
        gpu: { available: false, source: "none", reason: "no-permission" },
        heap: { available: false, source: "none", reason: "no-target" }
      }),
      0,
      ORIGIN
    );
    expect(Number.isNaN(series.load.gpuMhz.v[0] ?? 0)).toBe(true);
    expect(series.heap.count).toBe(0);

    const sample = { ...sampleOf(), targets: { created: 6, destroyed: 6 } };
    addSecond(series, { ...secondOf(), sample }, 1000, false);
    expect(series.objects.targets.v[0]).toBe(6);
    addSecond(series, secondOf(), 2000, false);
    expect(Number.isNaN(series.objects.targets.v[1] ?? 0)).toBe(true);
  });
});

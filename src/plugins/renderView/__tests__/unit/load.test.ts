/* eslint-disable unicorn/no-null -- null is connect's "not reported" */
import { describe, expect, it } from "vitest";
import { cpuTotalPct, loadInSelection, loadView } from "../../derive/load";
import { createMissionSeries, pushSample } from "../../series/series";
import type { DeviceTelemetry } from "../../source/contract";

// ─────────────────────────────────────────────────────────────────────────────
// derive/load.ts (spec 09 § M9 Device load): CPU per process as % of all
// cores, GPU busy and clock, each with its source.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The demo record: app 27 %, renderer 35 %, surfaceflinger 11 %, GPU 64 % at 585 MHz.
 *
 * @param gpu - Whether the GPU reading is available.
 * @returns The record.
 */
function recordOf(gpu = true): DeviceTelemetry {
  const cpu = (pid: number, name: string, pct: number) => ({
    available: true as const,
    source: `/proc/${pid}/stat`,
    value: { pid, name, pct, oneCorePct: pct * 8 }
  });
  const off = { available: false as const, source: "none", reason: "warming-up" as const };
  return {
    v: 1,
    device: "d-7f3a",
    serial: null,
    at: 1,
    wired: true,
    gpu: gpu
      ? {
          available: true,
          source: "/sys/kernel/gpu",
          value: { mhz: 585, busyPct: 64, minMhz: 221, maxMhz: 949 }
        }
      : { available: false, source: "none", reason: "no-permission" },
    cpu: {
      cores: 8,
      app: cpu(23_811, "com.moku.garden", 27),
      renderer: cpu(9, "renderer", 35),
      surfaceflinger: cpu(612, "surfaceflinger", 11)
    },
    memory: { app: off, renderer: off },
    heap: off
  };
}

describe("Device load", () => {
  it("CPU per process stacks pct app, renderer, surfaceflinger in that order and the total line is their sum", () => {
    // Bug: % of one core stacked past 100 %.
    const view = loadView(recordOf());
    expect(view?.cpu.values.map(value => [value.name, value.value])).toEqual([
      ["app", "27 %"],
      ["WebView renderer", "35 %"],
      ["surfaceflinger", "11 %"]
    ]);
    expect(view?.cpu.total).toBe("Stacked per process, 73 % together. CPU is % of all 8 cores.");
    const series = createMissionSeries();
    pushSample(series.load.cpuApp, 1, 27);
    pushSample(series.load.cpuRenderer, 1, Number.NaN);
    pushSample(series.load.cpuFlinger, 1, 11);
    expect(cpuTotalPct(series.load, 0)).toBe(38);
    expect(cpuTotalPct(createMissionSeries().load, 0)).toBeNull();
  });

  it("each value's title holds oneCorePct and its source", () => {
    // Bug: a value whose origin cannot be checked.
    expect(loadView(recordOf())?.cpu.values[0]?.title).toBe("216 % of one core, /proc/23811/stat");
  });

  it("an unavailable GPU reading shows '—' and its reason; the clock range comes from minMhz–maxMhz", () => {
    // Bug: 0 MHz shown for a node the phone does not let adb read.
    expect(loadView(recordOf(false))?.gpu).toMatchObject({
      busy: { value: "—" },
      clock: { value: "—" },
      note: "GPU: not available (the phone does not allow it)"
    });
    expect(loadView(recordOf())?.gpu).toMatchObject({
      busy: { value: "64 % busy" },
      clock: { value: "585 MHz clock" },
      range: "range 221–949 MHz",
      key: "clock, 221–949 MHz (DVFS)"
    });
    expect(loadView(undefined)).toBeUndefined();
  });

  it("the selection line reads the app's max and the clock range inside it", () => {
    // Bug: the clock of the whole history named for a short range.
    const series = createMissionSeries();
    for (const [t, app, mhz] of [
      [1000, 20, 221],
      [2000, 30, 585],
      [9000, 50, 949]
    ] as const) {
      pushSample(series.load.cpuApp, t, app);
      pushSample(series.load.gpuMhz, t, mhz);
    }
    expect(loadInSelection(series.load, 1500, 2500)).toBe(
      "CPU app max 30 %, GPU clock 221–585 MHz"
    );
    expect(loadInSelection(series.load, 50_000, 60_000)).toBeUndefined();
  });
});

describe("cores not known yet", () => {
  it("says 'all cores' before the probe answered", () => {
    // Bug: "CPU is % of all null cores".
    const record = recordOf();
    expect(loadView({ ...record, cpu: { ...record.cpu, cores: null } })?.cpu.total).toBe(
      "Stacked per process, 73 % together. CPU is % of all cores."
    );
  });
});

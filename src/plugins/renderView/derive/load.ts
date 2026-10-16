/**
 * @file renderView derive — the Device load card (spec 09 § M9 Device load): CPU per process as % of
 * all cores (stacked in the order app, WebView renderer, surfaceflinger; the total their sum, never
 * the % of one core), GPU busy and clock with the clock's range (DVFS), each value with its source in
 * its title; an unavailable reading reads "—" and why. Pure.
 */
import type { LoadSeries } from "../series/types";
import type { DeviceTelemetry, ProcessCpu, Reading, ReadingOffReason } from "../source/contract";
import { DASH, oneDecimal } from "./words";

/** Why a reading is not available, in words. */
const REASON_WORDS: Readonly<Record<ReadingOffReason, string>> = {
  "not-wired": "connect by wire to read it",
  ios: "not on iPhone",
  "no-permission": "the phone does not allow it",
  unreadable: "could not be read",
  "unknown-format": "an unknown format",
  "not-found": "not found",
  ambiguous: "two candidates",
  "no-devtools-socket": "WebView debugging is off",
  "no-target": "no DevTools target for this page",
  "warming-up": "warming up",
  "adb-missing": "adb not found",
  error: "an error"
};

/**
 * A reading's reason in words.
 *
 * @param reason - Why it is not available.
 * @returns The words.
 * @example
 * ```ts
 * reasonWords("warming-up"); // "warming up"
 * ```
 */
export function reasonWords(reason: ReadingOffReason): string {
  return REASON_WORDS[reason];
}

/**
 * The CPU total at a sample: app + renderer + surfaceflinger as % of all cores (a missing process
 * adds nothing; never % of one core).
 *
 * @param load - The load series.
 * @param index - A sample's index.
 * @returns The total; null when no process was read.
 * @example
 * ```ts
 * cpuTotalPct(series.load, series.load.cpuApp.count - 1); // 73
 * ```
 */
export function cpuTotalPct(load: LoadSeries, index: number): number | null {
  let total = 0;
  let read = false;
  for (const column of [load.cpuApp, load.cpuRenderer, load.cpuFlinger]) {
    const value = index < column.count ? (column.v[index] ?? Number.NaN) : Number.NaN;
    if (Number.isNaN(value)) continue;
    total += value;
    read = true;
  }
  // eslint-disable-next-line unicorn/no-null -- null: no process read
  return read ? total : null;
}

/**
 * A value of the card: its words and its title (the hover text: one core's % and the source, or why
 * it is not available).
 *
 * @example
 * ```ts
 * const value: LoadValue = { name: "app", value: "27 %", title: "216 % of one core, /proc/23811/stat" };
 * ```
 */
export type LoadValue = { readonly name: string; readonly value: string; readonly title: string };

/**
 * One process's CPU value.
 *
 * @param name - "app", "WebView renderer", "surfaceflinger".
 * @param reading - Its reading.
 * @returns The value.
 */
function cpuValue(name: string, reading: Reading<ProcessCpu>): LoadValue {
  if (!reading.available) {
    return { name, value: DASH, title: `${name}: not available (${reasonWords(reading.reason)})` };
  }
  const { pct, oneCorePct } = reading.value;
  return {
    name,
    value: `${Math.round(pct)} %`,
    title: `${Math.round(oneCorePct)} % of one core, ${reading.source}`
  };
}

/**
 * The Device load card's numbers.
 *
 * @example
 * ```ts
 * const view: LoadView = loadView(telemetry)!;
 * view.cpu.total; // "Stacked per process, 73 % together. CPU is % of all 8 cores."
 * ```
 */
export type LoadView = {
  readonly cpu: { readonly values: readonly LoadValue[]; readonly total: string };
  readonly gpu: {
    readonly busy: LoadValue;
    readonly clock: LoadValue;
    readonly range: string | undefined;
    readonly key: string | undefined;
    readonly note: string | undefined;
  };
};

/**
 * The GPU half: busy %, clock and its range, and the DVFS note.
 *
 * @param telemetry - The record.
 * @returns The GPU half.
 */
function gpuView(telemetry: DeviceTelemetry): LoadView["gpu"] {
  const { gpu } = telemetry;
  if (!gpu.available) {
    const title = `GPU: not available (${reasonWords(gpu.reason)})`;
    return {
      busy: { name: "busy", value: DASH, title },
      clock: { name: "clock", value: DASH, title },
      range: undefined,
      key: undefined,
      note: title
    };
  }
  const { busyPct, mhz, minMhz, maxMhz } = gpu.value;
  const hasRange = minMhz !== null && maxMhz !== null;
  return {
    busy: {
      name: "busy",
      value: busyPct === null ? DASH : `${Math.round(busyPct)} % busy`,
      title: gpu.source
    },
    clock: {
      name: "clock",
      value: mhz === null ? DASH : `${Math.round(mhz)} MHz clock`,
      title: gpu.source
    },
    range: hasRange ? `range ${minMhz}–${maxMhz} MHz` : undefined,
    key: hasRange ? `clock, ${minMhz}–${maxMhz} MHz (DVFS)` : undefined,
    note: hasRange
      ? `The driver lowers the clock when the GPU idles, so the same pass takes longer at ${minMhz} MHz.`
      : undefined
  };
}

/**
 * The Device load card: CPU per process (app, WebView renderer, surfaceflinger) with the total line,
 * and the GPU's busy %, clock and range.
 *
 * @param telemetry - The active device's newest record.
 * @returns The view; undefined without a record (the card says it is read over USB only).
 * @example
 * ```ts
 * loadView(telemetry)?.gpu.range; // "range 221–949 MHz"
 * ```
 */
export function loadView(telemetry: DeviceTelemetry | undefined): LoadView | undefined {
  if (telemetry === undefined) return undefined;
  const { cpu } = telemetry;
  const values = [
    cpuValue("app", cpu.app),
    cpuValue("WebView renderer", cpu.renderer),
    cpuValue("surfaceflinger", cpu.surfaceflinger)
  ];
  let sum = 0;
  for (const reading of [cpu.app, cpu.renderer, cpu.surfaceflinger]) {
    if (reading.available) sum += reading.value.pct;
  }
  const cores = cpu.cores === null ? "all" : `all ${cpu.cores}`;
  return {
    cpu: {
      values,
      total: `Stacked per process, ${Math.round(sum)} % together. CPU is % of ${cores} cores.`
    },
    gpu: gpuView(telemetry)
  };
}

/**
 * The card's "In selection" line from the load series over a time range.
 *
 * @param load - The load series.
 * @param from - The range's start, source clock.
 * @param to - Its end.
 * @returns "CPU app max {a} %, GPU clock {lo}–{hi} MHz"; undefined without samples in the range.
 * @example
 * ```ts
 * loadInSelection(series.load, 79_000, 80_000); // "CPU app max 27 %, GPU clock 221–585 MHz"
 * ```
 */
export function loadInSelection(load: LoadSeries, from: number, to: number): string | undefined {
  let app = Number.NEGATIVE_INFINITY;
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < load.cpuApp.count; index += 1) {
    const t = load.cpuApp.t[index] ?? 0;
    if (t < from - 1000 || t > to) continue;
    app = Math.max(app, load.cpuApp.v[index] ?? Number.NaN);
    const mhz = load.gpuMhz.v[index] ?? Number.NaN;
    if (Number.isNaN(mhz)) continue;
    low = Math.min(low, mhz);
    high = Math.max(high, mhz);
  }
  if (!Number.isFinite(app)) return undefined;
  const clock = Number.isFinite(low)
    ? `, GPU clock ${Math.round(low)}–${Math.round(high)} MHz`
    : "";
  return `CPU app max ${oneDecimal(app)} %${clock}`;
}

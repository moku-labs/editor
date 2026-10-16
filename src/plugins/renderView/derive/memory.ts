/**
 * @file renderView derive — the Memory card (spec 09 § M9 Memory, "Memory source rule"): which heap
 * to believe (a device's comes from its CDP telemetry, a native shell's process memory is never
 * called heap, a WebView's `performance.memory` is never shown; the local preview's when trusted),
 * process memory beside the heap, baselines after GCs, the trend and Leak? (baselines or a growing
 * object counter), the source line and the breakdown popover. Pure.
 */
import type { MissionSeries, ObjectSeries, SeriesColumn } from "../series/types";
import type {
  DeviceTelemetry,
  PerfHistory,
  PerfSecond,
  ProcessMemory,
  Reading
} from "../source/contract";
import type { MissionView } from "../types";
import type { Line } from "./words";
import { oneDecimal, strong } from "./words";

/** Leak? needs a baseline slope of at least this, MB/min (spec 09 § M12). */
export const LEAK_MB_PER_MIN = 0.5;

/** An object counter growing at least this per minute counts as growing (spec 09 § M12). */
export const OBJECT_GROWTH_PER_MIN = 10;

/** A baseline is the lowest heap sample within this long after a GC, ms. */
const BASELINE_MS = 1000;

/** Leak? needs baselines (and a counter needs rises) spanning at least this, ms. */
const LEAK_SPAN_MS = 60_000;

/** Leak? needs at least this many baselines; a growing counter this many rises. */
const LEAK_POINTS = 3;

/** One minute, ms. */
const MINUTE_MS = 60_000;

/**
 * What the Memory card reads.
 *
 * @example
 * ```ts
 * const input: MemoryInput = { second, telemetry: app.activeSource.telemetry(), series: mission.series, history: mission.history, device: true };
 * ```
 */
export type MemoryInput = {
  readonly second: PerfSecond | undefined;
  readonly telemetry: DeviceTelemetry | undefined;
  readonly series: MissionSeries;
  readonly history: PerfHistory;
  /** The source is a device (its heap comes from telemetry, never from its page). */
  readonly device: boolean;
};

/** A baseline: the lowest heap after a GC. */
export type Baseline = { readonly t: number; readonly mb: number };

/**
 * Where the heap comes from (the source rule): a device's CDP heap, a native shell's process memory,
 * the local preview's trusted `performance.memory`, or none. Never a heap the page does not trust.
 *
 * @param input - The source's values.
 * @returns The source.
 * @example
 * ```ts
 * memorySource({ ...input, device: true, telemetry: undefined }); // "none": the A26's WebView heap is never shown
 * ```
 */
export function memorySource(input: MemoryInput): MissionView["memory"]["source"] {
  const memory = input.second?.memory;
  if (input.device) {
    if (input.telemetry?.heap.available === true) return "cdp";
    return memory?.source === "shell" ? "shell" : "none";
  }
  if (memory?.trusted === true && memory.heapMb !== null) return "performance.memory";
  return "none";
}

/**
 * The GC times the baselines follow: the series' GCs (CDP, inferred) on a device, the history's `gc`
 * events on the local preview.
 *
 * @param input - The source's values.
 * @param source - The memory source.
 * @returns Source-clock ms of each GC, oldest first.
 */
function gcTimes(input: MemoryInput, source: MissionView["memory"]["source"]): number[] {
  const times: number[] = [];
  if (source === "cdp") {
    const { gcs } = input.series;
    for (let index = 0; index < gcs.count; index += 1) times.push(gcs.t[index] ?? 0);
    return times;
  }
  const { history } = input;
  for (let index = 0; index < history.eventCount; index += 1) {
    const event = history.events[index];
    if (event?.kind === "gc") times.push(event.t);
  }
  return times;
}

/**
 * The baselines: for each GC the lowest heap sample within 1 s after it (a GC without a sample there
 * has none).
 *
 * @param heap - The heap series.
 * @param gcs - The GC times, source clock.
 * @returns The baselines, oldest first.
 * @example
 * ```ts
 * baselinesOf(series.heap, [79_102]); // [{ t: 79_350, mb: 27.4 }]
 * ```
 */
export function baselinesOf(heap: SeriesColumn, gcs: readonly number[]): Baseline[] {
  const baselines: Baseline[] = [];
  for (const gc of gcs) {
    let low = Number.POSITIVE_INFINITY;
    let at = Number.NaN;
    for (let index = 0; index < heap.count; index += 1) {
      const t = heap.t[index] ?? 0;
      const mb = heap.v[index] ?? Number.NaN;
      if (t < gc || t > gc + BASELINE_MS || Number.isNaN(mb) || mb >= low) continue;
      low = mb;
      at = t;
    }
    if (Number.isFinite(low)) baselines.push({ t: at, mb: low });
  }
  return baselines;
}

/**
 * The least-squares slope of points, per minute.
 *
 * @param points - Times (ms) and values.
 * @returns The slope per minute; null for fewer than two points or no time between them.
 * @example
 * ```ts
 * slopePerMinute([{ t: 0, mb: 27.4 }, { t: 120_000, mb: 31 }]); // 1.8
 * ```
 */
export function slopePerMinute(points: readonly Baseline[]): number | null {
  // eslint-disable-next-line unicorn/no-null -- null: no trend
  if (points.length < 2) return null;
  let meanT = 0;
  let meanV = 0;
  for (const point of points) {
    meanT += point.t / points.length;
    meanV += point.mb / points.length;
  }
  let covariance = 0;
  let variance = 0;
  for (const point of points) {
    covariance += (point.t - meanT) * (point.mb - meanV);
    variance += (point.t - meanT) ** 2;
  }
  // eslint-disable-next-line unicorn/no-null -- null: every point at one time
  return variance === 0 ? null : (covariance / variance) * MINUTE_MS;
}

/**
 * The samples of a counter that are numbers, as points.
 *
 * @param column - The counter's series.
 * @returns The points, oldest first.
 */
function pointsOf(column: SeriesColumn): Baseline[] {
  const points: Baseline[] = [];
  for (let index = 0; index < column.count; index += 1) {
    const value = column.v[index] ?? Number.NaN;
    if (!Number.isNaN(value)) points.push({ t: column.t[index] ?? 0, mb: value });
  }
  return points;
}

/**
 * Whether an object counter grows: at least 3 rises over at least 60 s with no fall, and a slope of
 * at least OBJECT_GROWTH_PER_MIN.
 *
 * @param column - The counter's series.
 * @returns Whether it grows.
 * @example
 * ```ts
 * counterGrowing(series.objects.frameListeners); // true: +12 a minute and never fewer
 * ```
 */
export function counterGrowing(column: SeriesColumn): boolean {
  const points = pointsOf(column);
  let rises = 0;
  for (let index = 1; index < points.length; index += 1) {
    const step = (points[index]?.mb ?? 0) - (points[index - 1]?.mb ?? 0);
    if (step < 0) return false;
    if (step > 0) rises += 1;
  }
  const span = (points.at(-1)?.t ?? 0) - (points[0]?.t ?? 0);
  if (rises < LEAK_POINTS || span < LEAK_SPAN_MS) return false;
  return (slopePerMinute(points) ?? 0) >= OBJECT_GROWTH_PER_MIN;
}

/** The counters the Memory card watches, in the order the objects line names them. */
const COUNTERS: readonly (readonly [keyof ObjectSeries, string])[] = [
  ["frameListeners", "listeners"],
  ["inputListeners", "input listeners"],
  ["timers", "timers"],
  ["views", "views"],
  ["entities", "entities"],
  ["targets", "render targets"]
];

/**
 * The names of the growing counters with their slope.
 *
 * @param objects - The object series.
 * @returns "listeners +12/min" per growing counter.
 */
function growingCounters(objects: ObjectSeries): string[] {
  const growing: string[] = [];
  for (const [key, name] of COUNTERS) {
    const column = objects[key];
    if (!counterGrowing(column)) continue;
    growing.push(`${name} +${Math.round(slopePerMinute(pointsOf(column)) ?? 0)}/min`);
  }
  return growing;
}

/**
 * Leak?: at least 3 baselines spanning at least 60 s with a slope of at least LEAK_MB_PER_MIN, or a
 * growing object counter.
 *
 * @param baselines - The heap's baselines.
 * @param objects - The object counters.
 * @returns Whether to show "Leak?".
 * @example
 * ```ts
 * isLeak(baselinesOf(series.heap, gcs), series.objects); // true at +1.8 MB/min over 2 min
 * ```
 */
export function isLeak(baselines: readonly Baseline[], objects: ObjectSeries): boolean {
  const span = (baselines.at(-1)?.t ?? 0) - (baselines[0]?.t ?? 0);
  const slope = slopePerMinute(baselines) ?? 0;
  if (baselines.length >= LEAK_POINTS && span >= LEAK_SPAN_MS && slope >= LEAK_MB_PER_MIN)
    return true;
  return growingCounters(objects).length > 0;
}

/**
 * The value of a process memory reading.
 *
 * @param reading - The reading.
 * @returns Its PSS, MB; null when not available.
 */
function pssOf(reading: Reading<ProcessMemory>): number | null {
  // eslint-disable-next-line unicorn/no-null -- null: no reading
  return reading.available ? reading.value.totalPssMb : null;
}

/**
 * The newest heap of the source, MB.
 *
 * @param input - The source's values.
 * @param source - The memory source.
 * @returns MB; null when none is shown.
 */
function heapNow(input: MemoryInput, source: MissionView["memory"]["source"]): number | null {
  if (source === "cdp" && input.telemetry?.heap.available === true) {
    const newest = input.telemetry.heap.value.samples.at(-1);
    if (newest !== undefined) return newest.usedMb;
    const { heap } = input.series;
    // eslint-disable-next-line unicorn/no-null -- null: no sample yet
    return heap.count > 0 ? (heap.v[heap.count - 1] ?? null) : null;
  }
  // eslint-disable-next-line unicorn/no-null -- null: not a heap the card shows
  if (source === "performance.memory") return input.second?.memory?.heapMb ?? null;
  // eslint-disable-next-line unicorn/no-null -- null: not a heap the card shows
  return null;
}

/**
 * The process memory beside the heap (never as heap): a wired phone's PSS of the app and the WebView
 * renderer, or a native shell's whole process.
 *
 * @param input - The source's values.
 * @param source - The memory source.
 * @returns The two values; null when none.
 */
function processOf(
  input: MemoryInput,
  source: MissionView["memory"]["source"]
): MissionView["memory"]["processMb"] {
  const telemetry = input.telemetry;
  if (input.device && telemetry !== undefined) {
    const app = pssOf(telemetry.memory.app);
    const renderer = pssOf(telemetry.memory.renderer);
    if (app !== null || renderer !== null) return { app, renderer };
  }
  if (source === "shell") {
    // eslint-disable-next-line unicorn/no-null -- null: the shell reports the whole process only
    return { app: input.second?.memory?.processMb ?? null, renderer: null };
  }
  // eslint-disable-next-line unicorn/no-null -- null: no process memory
  return null;
}

/**
 * The memory part of MissionView (the source rule, the heap now, process memory beside it, Leak?
 * and the baseline slope).
 *
 * @param input - The source's values.
 * @returns The view.
 * @example
 * ```ts
 * memoryView(input); // { source: "cdp", heapMb: 41.9, processMb: { app: 541, renderer: 424 }, leak: true, slopeMbPerMin: 1.8 }
 * ```
 */
export function memoryView(input: MemoryInput): MissionView["memory"] {
  const source = memorySource(input);
  const baselines =
    source === "cdp" || source === "performance.memory"
      ? baselinesOf(input.series.heap, gcTimes(input, source))
      : [];
  const slope = slopePerMinute(baselines);
  return {
    source,
    heapMb: heapNow(input, source),
    processMb: processOf(input, source),
    leak: isLeak(baselines, input.series.objects),
    slopeMbPerMin: slope === null ? slope : Math.round(slope * 10) / 10
  };
}

/**
 * The card's source line: "JS heap via DevTools over USB", "JS heap (performance.memory, coarse)",
 * "Process memory (native shell)", or why it is not available.
 *
 * @param source - The memory source.
 * @param context - The page's OS and how the device is linked.
 * @param context.ios - The page runs on iOS.
 * @param context.link - "wire", "network" or "local".
 * @returns The line.
 * @example
 * ```ts
 * memorySourceLine("none", { ios: false, link: "network" }); // "Not available: connect by wire to read the heap"
 * ```
 */
export function memorySourceLine(
  source: MissionView["memory"]["source"],
  context: { readonly ios: boolean; readonly link: "wire" | "network" | "local" }
): string {
  if (source === "cdp") return "JS heap via DevTools over USB";
  if (source === "performance.memory") return "JS heap (performance.memory, coarse)";
  if (source === "shell") return "Process memory (native shell)";
  if (context.ios) return "Not available: by wire is Android only";
  if (context.link === "network") return "Not available: connect by wire to read the heap";
  return "Not available: not measured on this device";
}

/**
 * The baseline line: "Baseline after GC **{a} → {b} MB** in {span}, **+{slope} MB/min**".
 *
 * @param baselines - The baselines.
 * @param span - The span's words ("2 min").
 * @returns The line; undefined with fewer than two baselines.
 * @example
 * ```ts
 * baselineLine(baselines, "2 min"); // ["Baseline after GC ", { strong: "27.4 → 31 MB" }, " in 2 min, ", { strong: "+1.8 MB/min" }]
 * ```
 */
export function baselineLine(baselines: readonly Baseline[], span: string): Line | undefined {
  const first = baselines[0];
  const last = baselines.at(-1);
  const slope = slopePerMinute(baselines);
  if (first === undefined || last === undefined || slope === null) return undefined;
  const sign = slope >= 0 ? "+" : "−";
  return [
    "Baseline after GC ",
    strong(`${oneDecimal(first.mb)} → ${oneDecimal(last.mb)} MB`),
    ` in ${span}, `,
    strong(`${sign}${oneDecimal(Math.abs(slope))} MB/min`)
  ];
}

/**
 * The process line: "Process memory: app **{a} MB**, renderer **{r} MB** (whole process, PSS)".
 *
 * @param processMb - The view's process memory.
 * @returns The line; undefined without process memory.
 * @example
 * ```ts
 * processLine({ app: 541, renderer: 424 }); // ["Process memory: app ", { strong: "541 MB" }, ", renderer ", { strong: "424 MB" }, " (whole process, PSS)"]
 * ```
 */
export function processLine(processMb: MissionView["memory"]["processMb"]): Line | undefined {
  if (processMb === null) return undefined;
  const app = processMb.app === null ? "—" : `${Math.round(processMb.app)} MB`;
  const renderer = processMb.renderer === null ? "—" : `${Math.round(processMb.renderer)} MB`;
  return [
    "Process memory: app ",
    strong(app),
    ", renderer ",
    strong(renderer),
    " (whole process, PSS)"
  ];
}

/**
 * The objects line: the growing counters first ("Objects: **listeners +12/min**"), else "Objects
 * steady".
 *
 * @param objects - The object counters.
 * @returns The line.
 * @example
 * ```ts
 * objectsLine(series.objects); // ["Objects: ", { strong: "listeners +12/min, render targets +2/min" }]
 * ```
 */
export function objectsLine(objects: ObjectSeries): Line {
  const growing = growingCounters(objects);
  return growing.length === 0 ? ["Objects steady"] : ["Objects: ", strong(growing.join(", "))];
}

/** The parts of a process's memory the breakdown lists, in order. */
const PARTS: readonly (readonly [
  Exclude<keyof ProcessMemory, "pid" | "at" | "totalPssMb">,
  string
])[] = [
  ["javaMb", "Java heap"],
  ["nativeMb", "Native heap"],
  ["graphicsMb", "Graphics"],
  ["glMb", "GL"],
  ["codeMb", "Code"],
  ["stackMb", "Stack"],
  ["otherMb", "Other"],
  ["systemMb", "System"]
];

/**
 * The breakdown popover of a wired phone's process memory: per process its title and the parts
 * (null parts left out), and when it was read.
 *
 * @param telemetry - The active device's telemetry.
 * @param now - Epoch ms now (for "read {s} s ago").
 * @returns The processes; empty without readings.
 * @example
 * ```ts
 * breakdownOf(telemetry, Date.now())[0]?.title; // "App, pid 23811 — 541 MB"
 * ```
 */
export function breakdownOf(
  telemetry: DeviceTelemetry | undefined,
  now: number
): {
  readonly title: string;
  readonly parts: readonly { readonly name: string; readonly mb: number }[];
  readonly read: string;
}[] {
  if (telemetry === undefined) return [];
  const processes: [string, Reading<ProcessMemory>][] = [
    ["App", telemetry.memory.app],
    ["WebView renderer", telemetry.memory.renderer]
  ];
  return processes.flatMap(([name, reading]) => {
    if (!reading.available) return [];
    const { value } = reading;
    const parts = PARTS.flatMap(([key, label]) => {
      const mb = value[key];
      return typeof mb === "number" ? [{ name: label, mb }] : [];
    });
    const pid = name === "App" ? `, pid ${value.pid}` : "";
    return [
      {
        title: `${name}${pid} — ${Math.round(value.totalPssMb)} MB`,
        parts,
        read: `read ${Math.max(0, Math.round((now - value.at) / 1000))} s ago`
      }
    ];
  });
}

/**
 * The baselines of the card under the source rule: a device's CDP heap after its inferred GCs, the
 * local preview's trusted heap after the history's GC events; none for another source.
 *
 * @param input - The source's values.
 * @returns The baselines, oldest first.
 * @example
 * ```ts
 * memoryBaselines(memoryInputOf(mission)); // [{ t: 79_350, mb: 27.4 }, …, { t: 197_100, mb: 31 }]
 * ```
 */
export function memoryBaselines(input: MemoryInput): Baseline[] {
  const source = memorySource(input);
  if (source !== "cdp" && source !== "performance.memory") return [];
  return baselinesOf(input.series.heap, gcTimes(input, source));
}

/**
 * The heap line of the view: "Heap {min} → {max} MB over {span}, GC marks on the shared axis".
 *
 * @param heap - The heap series.
 * @param startMs - The view's start.
 * @param endMs - The view's end.
 * @param span - The span's words ("2 min").
 * @returns The line; undefined without a sample in the view.
 * @example
 * ```ts
 * heapRangeLine(series.heap, 20_000, 140_000, "2 min"); // ["Heap ", { strong: "27 → 57 MB" }, " over 2 min, GC marks on the shared axis"]
 * ```
 */
export function heapRangeLine(
  heap: SeriesColumn,
  startMs: number,
  endMs: number,
  span: string
): Line | undefined {
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < heap.count; index += 1) {
    const t = heap.t[index] ?? 0;
    const mb = heap.v[index] ?? Number.NaN;
    if (t < startMs || t > endMs || Number.isNaN(mb)) continue;
    low = Math.min(low, mb);
    high = Math.max(high, mb);
  }
  if (!Number.isFinite(low)) return undefined;
  return [
    "Heap ",
    strong(`${oneDecimal(low)} → ${oneDecimal(high)} MB`),
    ` over ${span}, GC marks on the shared axis`
  ];
}

/**
 * The GCs of a time range with the MB they freed: a device's CDP GCs, the local preview's GC events.
 *
 * @param input - The source's values.
 * @param from - The range's start, source clock.
 * @param to - Its end.
 * @returns "{n} GC(s), freed {mb} MB", or "No GC".
 * @example
 * ```ts
 * gcsInRangeText(memoryInputOf(mission), 78_000, 79_000); // "1 GC, freed 4.2 MB"
 * ```
 */
export function gcsInRangeText(input: MemoryInput, from: number, to: number): string {
  const source = memorySource(input);
  let count = 0;
  let freed = 0;
  if (source === "cdp") {
    const { gcs } = input.series;
    for (let index = 0; index < gcs.count; index += 1) {
      const t = gcs.t[index] ?? 0;
      if (t < from || t > to) continue;
      count += 1;
      freed += gcs.v[index] ?? 0;
    }
  } else {
    const { history } = input;
    for (let index = 0; index < history.eventCount; index += 1) {
      const event = history.events[index];
      if (event?.kind !== "gc" || event.t < from || event.t > to) continue;
      count += 1;
      freed += event.freedMb;
    }
  }
  if (count === 0) return "No GC";
  return `${count} GC${count === 1 ? "" : "s"}, freed ${oneDecimal(freed)} MB`;
}

/**
 * @file Leak measurement of the memory tests (spec 10, Delta 2026-10-16): run a step until warm,
 * force a full GC, read the heap, run more rounds, GC again and answer the growth. Each read is the
 * median of three GC'd reads, so one late sweep does not read as a leak. Test infrastructure, not a
 * plugin: plugin tests import it by relative path.
 *
 * Bun (`bun --bun vitest`, the project's scripts) collects with `Bun.gc(true)` and also counts the
 * live JSC objects (`heapStats().objectCount` of `bun:jsc`). Under Node it uses `globalThis.gc`
 * (`--expose-gc`), else turns the flag on at run time; when no collector is found the growth says
 * `gc: "none"` and a test leaves the heap unasserted and says so (`heapMeasured`).
 */
import type * as Jsc from "bun:jsc";
import { createRequire } from "node:module";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";

/** Which collector a measurement forced: Bun's, V8's, or none found. */
export type GcKind = "bun" | "v8" | "none";

/** One GC'd read of the heap. */
export type HeapSample = {
  /** `process.memoryUsage().heapUsed`, bytes. */
  readonly heapBytes: number;
  /** Live JSC objects (`heapStats().objectCount`); undefined outside Bun. */
  readonly objects: number | undefined;
};

/** The most growth a measurement window may show; a measure left out has no bound. */
export type GrowthCeiling = {
  /** Heap growth, bytes (checked only when a collector was forced). */
  readonly heapBytes?: number;
  /** Live object growth (checked only under Bun). */
  readonly objects?: number;
};

/** How `measureGrowth` runs a step. */
export type GrowthOptions = {
  /** Calls of the step before the baseline read: caches fill, arrays reach their size. */
  readonly warmup: number;
  /** Calls of the step in one measurement window, between two reads. */
  readonly rounds: number;
  /** Awaited before every GC'd read: let queued work finish (a socket close, a file write). */
  readonly settle?: () => void | Promise<void>;
  /**
   * The test's ceiling. A window over it is measured again, from its own end, up to `windows`
   * times: a leak grows in every window, noise (another file's load, a late JIT or GC step) in one.
   */
  readonly ceiling?: GrowthCeiling;
  /** The most windows a reading over the ceiling gets; 3 by default. */
  readonly windows?: number;
};

/** The growth of one measurement window. */
export type WindowGrowth = {
  /** Heap growth over the window, bytes. */
  readonly heapBytes: number;
  /** Live object growth over the window; undefined outside Bun. */
  readonly objects: number | undefined;
};

/** What `measureGrowth` answers. */
export type Growth = {
  /**
   * Heap growth over the rounds, bytes (negative when the heap shrank): the first window within
   * the ceiling, else the smallest of the windows (a leak exceeds it in every one).
   */
  readonly heapBytes: number;
  /** Live object growth, chosen the same way; undefined outside Bun. */
  readonly objects: number | undefined;
  /** The collector forced before each read. */
  readonly gc: GcKind;
  /** The baseline read, after the warmup. */
  readonly before: HeapSample;
  /** The final read, after the last window. */
  readonly after: HeapSample;
  /** Every window measured, in order: one, or more when a reading was over the ceiling. */
  readonly windows: readonly WindowGrowth[];
};

/** The numbers `logLeak` prints. */
export type LeakNumbers = {
  /** Heap growth, bytes; printed in KiB, "n/a" when undefined. */
  readonly heapBytes?: number | undefined;
  /** Live object growth; left out when undefined. */
  readonly objects?: number | undefined;
  /** More counts by name, printed `name +N` in this order (nodes, listeners, handles…). */
  readonly counts?: Readonly<Record<string, number>>;
  /** The collector; "none" prints why the heap is not asserted. */
  readonly gc?: GcKind;
  /** The windows of a measurement; more than one prints each window's growth. */
  readonly windows?: readonly WindowGrowth[];
};

/** Windows a reading over its ceiling gets, the first included. */
const DEFAULT_WINDOWS = 3;

/** Reads per measurement; the median is kept. */
const READS = 3;

/** A forced full collection and what forced it. */
type Collector = { readonly kind: GcKind; collect(): void };

/**
 * Finds the strongest collector of this runtime: Bun's synchronous full GC, else V8's `gc` (the
 * exposed global, or the flag turned on now and the function taken from a fresh context), else none.
 *
 * @returns The collector.
 */
function findCollector(): Collector {
  if (typeof Bun !== "undefined") return { kind: "bun", collect: () => Bun.gc(true) };
  const exposed: unknown = Reflect.get(globalThis, "gc");
  if (typeof exposed === "function") return { kind: "v8", collect: () => exposed() };
  try {
    setFlagsFromString("--expose-gc");
    const gc: unknown = runInNewContext("gc");
    if (typeof gc === "function") return { kind: "v8", collect: () => gc() };
  } catch {
    // No way to force a collection here: the measurement says "none".
  }
  return { kind: "none", collect: () => undefined };
}

/**
 * The JSC heap statistics of Bun (`bun:jsc`), loaded through `require` so Vitest's module runner
 * never resolves the `bun:` scheme; undefined outside Bun.
 *
 * @returns `heapStats`, or undefined.
 */
function findHeapStats(): (() => { readonly objectCount: number }) | undefined {
  if (typeof Bun === "undefined") return undefined;
  try {
    const jsc = createRequire(import.meta.url)("bun:jsc") as typeof Jsc;
    return jsc.heapStats;
  } catch {
    return undefined;
  }
}

/** The collector of this worker, found once. */
const COLLECTOR = findCollector();

/** Bun's heap statistics, found once. */
const HEAP_STATS = findHeapStats();

/**
 * The middle value of a list.
 *
 * @param values - The values.
 * @returns Their median.
 */
function median(values: readonly number[]): number {
  const sorted = values.toSorted((one, other) => one - other);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

/**
 * Settles, collects and reads the heap three times and keeps the median of each number.
 *
 * @param settle - Awaited before each read.
 * @returns The read.
 */
async function sampleHeap(settle: GrowthOptions["settle"]): Promise<HeapSample> {
  const heaps: number[] = [];
  const objects: number[] = [];
  for (let read = 0; read < READS; read += 1) {
    await settle?.();
    COLLECTOR.collect();
    heaps.push(process.memoryUsage().heapUsed);
    if (HEAP_STATS !== undefined) objects.push(HEAP_STATS().objectCount);
  }
  return {
    heapBytes: median(heaps),
    objects: HEAP_STATS === undefined ? undefined : median(objects)
  };
}

/**
 * The growth between two reads.
 *
 * @param from - The earlier read.
 * @param to - The later read.
 * @returns The growth.
 */
function growthBetween(from: HeapSample, to: HeapSample): WindowGrowth {
  return {
    heapBytes: to.heapBytes - from.heapBytes,
    objects:
      to.objects === undefined || from.objects === undefined ? undefined : to.objects - from.objects
  };
}

/**
 * Whether a window's growth is within a ceiling: the heap only when a collector was forced, the
 * objects only when counted.
 *
 * @param growth - The window.
 * @param ceiling - The ceiling; none means within.
 * @returns Whether every bounded measure is under its bound.
 */
function withinCeiling(growth: WindowGrowth, ceiling: GrowthCeiling | undefined): boolean {
  const heapOver =
    COLLECTOR.kind !== "none" &&
    ceiling?.heapBytes !== undefined &&
    growth.heapBytes >= ceiling.heapBytes;
  const objectsOver =
    growth.objects !== undefined &&
    ceiling?.objects !== undefined &&
    growth.objects >= ceiling.objects;
  return !heapOver && !objectsOver;
}

/**
 * The growth a measurement answers: the first window within the ceiling, else each measure's
 * smallest window.
 *
 * @param windows - The windows, in order.
 * @param ceiling - The ceiling.
 * @returns The growth.
 */
function chosenGrowth(
  windows: readonly WindowGrowth[],
  ceiling: GrowthCeiling | undefined
): WindowGrowth {
  const within = windows.find(window => withinCeiling(window, ceiling));
  if (within !== undefined) return within;
  const counted = windows.flatMap(window => (window.objects === undefined ? [] : [window.objects]));
  return {
    heapBytes: Math.min(...windows.map(window => window.heapBytes)),
    objects: counted.length === 0 ? undefined : Math.min(...counted)
  };
}

/**
 * Runs `step` `warmup` times, reads the heap (forced GC, median of three), runs `rounds` more calls
 * and reads again: the growth is what the rounds kept alive. With a `ceiling`, a window over it is
 * measured again from its own end, up to `windows` (3) in all, and the answer is the first window
 * within it, else each measure's smallest window: a leak grows in every window, while the noise of
 * a loaded machine (another file's work, a late JIT or GC step) shows in one. The step gets its
 * call index, from 0 through the warmup and every window; a step that returns a promise is
 * awaited.
 *
 * @param step - One round of the work under test.
 * @param options - Warmup and round counts, the settle before each read, the ceiling and windows.
 * @returns The growth, every window, the first and last reads and the collector used.
 * @example
 * ```ts
 * const ceiling = { heapBytes: 128 * 1024, objects: 1000 };
 * const growth = await measureGrowth(() => paintGraph(g, window, view, state), {
 *   warmup: 1000,
 *   rounds: 10_000,
 *   ceiling
 * });
 * logLeak("graph paint", growth);
 * if (heapMeasured(growth)) expect(growth.heapBytes).toBeLessThan(ceiling.heapBytes);
 * ```
 */
export async function measureGrowth(
  step: (round: number) => void | Promise<void>,
  options: GrowthOptions
): Promise<Growth> {
  const { warmup, rounds, settle, ceiling } = options;
  const most = options.windows ?? DEFAULT_WINDOWS;
  let round = 0;
  for (; round < warmup; round += 1) await step(round);
  const before = await sampleHeap(settle);
  const windows: WindowGrowth[] = [];
  let start = before;
  let end = before;
  while (windows.length < most) {
    for (const last = round + rounds; round < last; round += 1) await step(round);
    end = await sampleHeap(settle);
    const window = growthBetween(start, end);
    windows.push(window);
    if (withinCeiling(window, ceiling)) break;
    start = end;
  }
  return { ...chosenGrowth(windows, ceiling), gc: COLLECTOR.kind, before, after: end, windows };
}

/**
 * Whether the heap growth means anything: a full collection was forced before each read.
 *
 * @param growth - A measurement.
 * @returns False when no collector was found (the test then leaves the heap unasserted).
 * @example
 * ```ts
 * if (heapMeasured(growth)) expect(growth.heapBytes).toBeLessThan(256 * 1024);
 * ```
 */
export function heapMeasured(growth: Pick<Growth, "gc">): boolean {
  return growth.gc !== "none";
}

/**
 * A count with its sign: "+12", "-3".
 *
 * @param value - The count.
 * @param digits - Decimals kept.
 * @returns The text.
 */
function signed(value: number, digits = 0): string {
  return `${value < 0 ? "-" : "+"}${Math.abs(value).toFixed(digits)}`;
}

/**
 * Prints one measurement as `[leak] <name> heap +X KiB objects +N nodes +N listeners +N`, so the
 * trend shows in CI logs. A run without a collector adds why the heap is not asserted.
 *
 * @param name - What was measured.
 * @param numbers - The growth and the other counts.
 * @example
 * ```ts
 * logLeak("overlay open/close", { ...growth, counts: { nodes: 0, listeners: 0 } });
 * // [leak] overlay open/close heap +41.2 KiB objects +310 nodes +0 listeners +0
 * ```
 */
export function logLeak(name: string, numbers: LeakNumbers): void {
  const heap =
    numbers.heapBytes === undefined || numbers.gc === "none"
      ? "heap n/a"
      : `heap ${signed(numbers.heapBytes / 1024, 1)} KiB`;
  const parts = [`[leak] ${name}`, heap];
  if (numbers.objects !== undefined) parts.push(`objects ${signed(numbers.objects)}`);
  for (const [label, value] of Object.entries(numbers.counts ?? {})) {
    parts.push(`${label} ${signed(value)}`);
  }
  const windows = numbers.windows ?? [];
  if (windows.length > 1) {
    const each = windows.map(
      window => `${signed(window.heapBytes / 1024, 1)} KiB/${signed(window.objects ?? 0)}`
    );
    parts.push(`(windows: ${each.join(", ")})`);
  }
  if (numbers.gc === "none") parts.push("(no gc in this runtime: heap not asserted)");
  console.info(parts.join(" "));
}

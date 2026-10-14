/**
 * @file renderView device strip — STAND-IN for spec 03 `perf/protocol/window.ts`: the window the
 * frame graph draws, its wire form (`editor.perf.window`) and the helpers the strip uses
 * (`createPerfWindow`, `readWireWindow`, `rowOfFrame`, `stepSpike`, `spikeOrdinal`, `meanGpu`),
 * written to 03's contracts. Unit 03 is not built yet; when it lands, `contract/index.ts`
 * re-exports these names from `perf/protocol` and this file is deleted.
 */

import { primaryCause } from "../../../perf/protocol";
import type { Json } from "../../../registry/protocol";
import { ERROR_PREFIX } from "../../../registry/protocol";

/**
 * The last window of frames as struct-of-arrays, oldest row first: what the frame graph draws.
 * The tools strip allocates one and fills it from the wire with `readWireWindow`.
 *
 * @example
 * ```ts
 * const window = createPerfWindow(1024);
 * readWireWindow(value, window); // true; window.count === 358 at 60 fps
 * ```
 */
export type PerfWindow = {
  readonly capacity: number;
  count: number;
  /** Page-clock ms of the left edge of the time axis. */
  startMs: number;
  /** Page-clock ms of the right edge. */
  endMs: number;
  /** False when the page has no GPU timer: the graph stacks JS and idle only. */
  gpuTimer: boolean;
  /** Increments whenever any row or scalar changed. */
  version: number;
  readonly frame: Uint32Array;
  /** Page-clock ms of each frame's start. */
  readonly t: Float64Array;
  readonly ms: Float32Array;
  readonly jsMs: Float32Array;
  /** GPU ms; NaN = not measured. */
  readonly gpuMs: Float32Array;
  readonly rateMs: Float32Array;
  /** The frame's own spike budget, ms. */
  readonly budgetMs: Float32Array;
  readonly drawn: Uint8Array;
  /** The engine's cause bits (CAUSE_BITS). */
  readonly causes: Uint8Array;
  /** The primary cause code (CAUSE_RANK), 0 = not a spike. */
  readonly cause: Uint8Array;
  /** Rows of the spikes, oldest first. */
  readonly spikes: Uint16Array;
  spikeCount: number;
};

/**
 * The window as a reader sees it: every scalar readonly, every column read-only.
 */
export type PerfWindowView = {
  readonly capacity: number;
  readonly count: number;
  readonly startMs: number;
  readonly endMs: number;
  readonly gpuTimer: boolean;
  readonly version: number;
  readonly frame: ArrayLike<number>;
  readonly t: ArrayLike<number>;
  readonly ms: ArrayLike<number>;
  readonly jsMs: ArrayLike<number>;
  readonly gpuMs: ArrayLike<number>;
  readonly rateMs: ArrayLike<number>;
  readonly budgetMs: ArrayLike<number>;
  readonly drawn: ArrayLike<number>;
  readonly causes: ArrayLike<number>;
  readonly cause: ArrayLike<number>;
  readonly spikes: ArrayLike<number>;
  readonly spikeCount: number;
};

/**
 * The wire form of a window (source `editor.perf.window`). Columns are plain arrays.
 *
 * @example
 * ```ts
 * const wire: PerfWindowWire = { v: 1, startMs: 40123.5, endMs: 46123.5, gpuTimer: true, frame: [4811, 4812],
 *   t: [5917.4, 5958.7], ms: [16.7, 41.3], jsMs: [3.4, 8], gpuMs: [5.2, 6.6], rateMs: [16.67, 16.67],
 *   budgetMs: [16.67, 16.67], drawn: [1, 1], causes: [0, 17] };
 * ```
 */
export type PerfWindowWire = {
  v: 1;
  startMs: number;
  endMs: number;
  gpuTimer: boolean;
  frame: number[];
  /** ms after startMs. */
  t: number[];
  ms: number[];
  jsMs: number[];
  gpuMs: (number | null)[];
  rateMs: number[];
  budgetMs: number[];
  drawn: (0 | 1)[];
  causes: number[];
};

/**
 * The most rows a window holds (`spikes` is a Uint16Array).
 */
const MAX_ROWS = 65_535;

/**
 * The longest window a wire value may span, ms: a time axis is at most 60 s.
 */
const MAX_SPAN_MS = 60_000;

/**
 * Allocates a window of `capacity` rows: every array once, `count` 0, `gpuTimer` true.
 *
 * @param capacity - Rows, a whole number from 1 to 65535.
 * @returns The empty window.
 * @throws {TypeError} For a capacity outside 1 to 65535 or not whole.
 * @example
 * ```ts
 * createPerfWindow(1024).capacity; // 1024
 * ```
 */
export function createPerfWindow(capacity: number): PerfWindow {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_ROWS) {
    throw new TypeError(
      `${ERROR_PREFIX}createPerfWindow(${capacity}) needs a whole number of rows from 1 to 65535.\n  Pass perf's frames, for example 1024.`
    );
  }
  return {
    capacity,
    count: 0,
    startMs: 0,
    endMs: 0,
    gpuTimer: true,
    version: 0,
    frame: new Uint32Array(capacity),
    t: new Float64Array(capacity),
    ms: new Float32Array(capacity),
    jsMs: new Float32Array(capacity),
    gpuMs: new Float32Array(capacity),
    rateMs: new Float32Array(capacity),
    budgetMs: new Float32Array(capacity),
    drawn: new Uint8Array(capacity),
    causes: new Uint8Array(capacity),
    cause: new Uint8Array(capacity),
    spikes: new Uint16Array(capacity),
    spikeCount: 0
  };
}

/**
 * True for an array of finite numbers.
 *
 * @param value - A Json value.
 * @returns Whether it is a number column.
 * @example
 * ```ts
 * isNumbers([1, 2.5]); // true
 * ```
 */
function isNumbers(value: Json | undefined): value is number[] {
  return Array.isArray(value) && value.every(item => typeof item === "number");
}

/**
 * True for an array of numbers and nulls (the `gpuMs` column).
 *
 * @param value - A Json value.
 * @returns Whether it is a gpu column.
 * @example
 * ```ts
 * isGpuColumn([5.2, null]); // true
 * ```
 */
function isGpuColumn(value: Json | undefined): value is (number | null)[] {
  return Array.isArray(value) && value.every(item => item === null || typeof item === "number");
}

/**
 * A decoded JSON object.
 */
type JsonObject = { readonly [key: string]: Json };

/**
 * A number column of the wire object with the given length.
 *
 * @param object - The wire object.
 * @param key - The column name.
 * @param length - The length every column has.
 * @returns The column, or undefined when it is missing, not numbers or of another length.
 * @example
 * ```ts
 * columnOf({ ms: [16.7, 41.3] }, "ms", 2); // [16.7, 41.3]
 * ```
 */
function columnOf(object: JsonObject, key: string, length: number): number[] | undefined {
  const column = object[key];
  return isNumbers(column) && column.length === length ? column : undefined;
}

/**
 * Reads a wire value as a `PerfWindowWire`: an object of `v: 1` whose span `endMs − startMs` is
 * finite and in 0 < span ≤ 60 s, with equal-length columns of numbers (`gpuMs` may hold null).
 *
 * @param value - The value of `editor.perf.window`.
 * @returns The wire window, or undefined for any other shape.
 * @example
 * ```ts
 * asWire({ v: 2 }); // undefined
 * ```
 */
function asWire(value: Json): PerfWindowWire | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const { v, startMs, endMs, gpuTimer, gpuMs } = value;
  if (v !== 1 || typeof startMs !== "number" || typeof endMs !== "number") return undefined;
  if (typeof gpuTimer !== "boolean" || !isGpuColumn(gpuMs)) return undefined;
  const span = endMs - startMs;
  if (!Number.isFinite(span) || span <= 0 || span > MAX_SPAN_MS) return undefined;

  const { length } = gpuMs;
  const frame = columnOf(value, "frame", length);
  const t = columnOf(value, "t", length);
  const ms = columnOf(value, "ms", length);
  const jsMs = columnOf(value, "jsMs", length);
  const rateMs = columnOf(value, "rateMs", length);
  const budgetMs = columnOf(value, "budgetMs", length);
  const drawn = columnOf(value, "drawn", length);
  const causes = columnOf(value, "causes", length);
  if (frame === undefined || t === undefined || ms === undefined || jsMs === undefined) {
    return undefined;
  }
  if (rateMs === undefined || budgetMs === undefined || drawn === undefined) return undefined;
  if (causes === undefined) return undefined;

  const flags = drawn.map((flag): 0 | 1 => (flag === 1 ? 1 : 0));
  return {
    v,
    startMs,
    endMs,
    gpuTimer,
    frame,
    t,
    ms,
    jsMs,
    gpuMs,
    rateMs,
    budgetMs,
    drawn: flags,
    causes
  };
}

/**
 * Fills `into` from a wire value: false and `into` untouched for a value of another shape (a span
 * that is not finite or not in 0 < span ≤ 60 s included); keeps
 * the newest `into.capacity` rows; recomputes `cause` and `spikes` from `causes`; `version += 1`.
 *
 * @param value - The value of `editor.perf.window`.
 * @param into - The window to fill.
 * @returns Whether the value was a window.
 * @example
 * ```ts
 * readWireWindow({ v: 1, startMs: 0, endMs: 6000, gpuTimer: true, frame: [1], t: [0], ms: [16.7], jsMs: [3],
 *   gpuMs: [null], rateMs: [16.67], budgetMs: [16.67], drawn: [1], causes: [0] }, window); // true
 * ```
 */
export function readWireWindow(value: Json, into: PerfWindow): boolean {
  const wire = asWire(value);
  if (wire === undefined) return false;

  const offset = Math.max(0, wire.frame.length - into.capacity);
  const count = wire.frame.length - offset;
  let spikeCount = 0;
  for (let row = 0; row < count; row += 1) {
    const from = row + offset;
    const causes = wire.causes[from] ?? 0;
    into.frame[row] = wire.frame[from] ?? 0;
    into.t[row] = wire.startMs + (wire.t[from] ?? 0);
    into.ms[row] = wire.ms[from] ?? 0;
    into.jsMs[row] = wire.jsMs[from] ?? 0;
    into.gpuMs[row] = wire.gpuMs[from] ?? Number.NaN;
    into.rateMs[row] = wire.rateMs[from] ?? 0;
    into.budgetMs[row] = wire.budgetMs[from] ?? 0;
    into.drawn[row] = wire.drawn[from] ?? 0;
    into.causes[row] = causes;
    into.cause[row] = primaryCause(causes);
    if (into.cause[row] !== 0) {
      into.spikes[spikeCount] = row;
      spikeCount += 1;
    }
  }
  into.count = count;
  into.spikeCount = spikeCount;
  into.startMs = wire.startMs;
  into.endMs = wire.endMs;
  into.gpuTimer = wire.gpuTimer;
  into.version += 1;
  return true;
}

/**
 * The row of a frame number (binary search: frames grow along the rows).
 *
 * @param window - The window.
 * @param frame - A frame number.
 * @returns The row; −1 when the frame is not in the window.
 * @example
 * ```ts
 * rowOfFrame(window, 4812); // 357 when 4812 is the newest of 358 rows
 * ```
 */
export function rowOfFrame(window: PerfWindowView, frame: number): number {
  let low = 0;
  let high = window.count - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const at = window.frame[middle] ?? 0;
    if (at === frame) return middle;
    if (at < frame) low = middle + 1;
    else high = middle - 1;
  }
  return -1;
}

/**
 * The next (1) or previous (−1) spike row after (before) `row`, wrapping around; from a row that
 * is not a spike, the first spike after / the last before it.
 *
 * @param window - The window.
 * @param row - The row to step from.
 * @param dir - 1 for next, −1 for previous.
 * @returns The spike row; −1 when the window has no spike.
 * @example
 * ```ts
 * stepSpike(window, window.spikes[window.spikeCount - 1], 1); // window.spikes[0]: wrapped
 * ```
 */
export function stepSpike(window: PerfWindowView, row: number, dir: 1 | -1): number {
  const total = window.spikeCount;
  if (total === 0) return -1;

  if (dir === 1) {
    for (let index = 0; index < total; index += 1) {
      const spike = window.spikes[index] ?? 0;
      if (spike > row) return spike;
    }
    return window.spikes[0] ?? -1;
  }
  for (let index = total - 1; index >= 0; index -= 1) {
    const spike = window.spikes[index] ?? 0;
    if (spike < row) return spike;
  }
  return window.spikes[total - 1] ?? -1;
}

/**
 * The 1-based position of a row among the spikes.
 *
 * @param window - The window.
 * @param row - A row.
 * @returns The position; 0 when the row is not a spike.
 * @example
 * ```ts
 * spikeOrdinal(window, window.spikes[4]); // 5
 * ```
 */
export function spikeOrdinal(window: PerfWindowView, row: number): number {
  for (let index = 0; index < window.spikeCount; index += 1) {
    if (window.spikes[index] === row) return index + 1;
  }
  return 0;
}

/**
 * The mean of the measured `gpuMs` of the drawn rows: the "GPU avg" counter.
 *
 * @param window - The window.
 * @returns The mean; null when no drawn row has a measured GPU time.
 * @example
 * ```ts
 * meanGpu(window); // 6.1
 * ```
 */
export function meanGpu(window: PerfWindowView): number | null {
  let sum = 0;
  let measured = 0;
  for (let row = 0; row < window.count; row += 1) {
    const gpu = window.gpuMs[row] ?? Number.NaN;
    if (window.drawn[row] === 1 && Number.isFinite(gpu)) {
      sum += gpu;
      measured += 1;
    }
  }
  // eslint-disable-next-line unicorn/no-null -- null is 03's "no timer" marker
  return measured === 0 ? null : sum / measured;
}

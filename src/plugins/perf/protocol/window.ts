/**
 * @file perf/protocol — the window of frames the graph draws (struct-of-arrays, oldest row first),
 * its read-only view, its wire form (`editor.perf.window`) and the small readers the overlay and the
 * tools strip share. Runtime-free: no plugin, no kernel, no DOM.
 */
import type { Json } from "../../registry/protocol";
import { primaryCause } from "./causes";

/**
 * One value of a column; NaN past its end (`noUncheckedIndexedAccess` reads a typed array as
 * possibly undefined).
 *
 * @param column - The column.
 * @param index - The index.
 * @returns The value, or NaN.
 * @example
 * ```ts
 * cell(Float32Array.of(16.5), 0); // 16.5
 * ```
 */
function cell(column: ArrayLike<number>, index: number): number {
  return column[index] ?? Number.NaN;
}

/**
 * The last `windowMs` of frames as struct-of-arrays, oldest row first: what the frame graph draws.
 * perf owns one, rewrites it at every read and hands it out only for the length of a `readWindow`
 * call, as the read-only `PerfWindowView` (never keep the reference; copy what you keep); a tools
 * page fills its own from the wire with `readWireWindow`.
 *
 * @example
 * ```ts
 * app.perf.readWindow(window => {
 *   window.count; // 358 at 60 fps
 *   window.budgetMs[window.count - 1]; // 16.67
 * });
 * ```
 */
export type PerfWindow = {
  /** Rows the arrays hold. */
  readonly capacity: number;
  /** Rows in use, oldest first. */
  count: number;
  /** Page-clock ms of the left edge of the time axis: endMs − windowMs. */
  startMs: number;
  /** Page-clock ms of the right edge: start of the newest frame plus its frame time. */
  endMs: number;
  /** False when the page has no GPU timer (header.gpu.timer null, WebKit): the graph stacks JS and idle only. */
  gpuTimer: boolean;
  /** Increments whenever any row or scalar changed, so a painter skips an unchanged window. */
  version: number;
  /** The frame number of each row. */
  readonly frame: Uint32Array;
  /** Page-clock ms of each frame's start. */
  readonly t: Float64Array;
  /** Frame time: max(gap, js + gpu). */
  readonly ms: Float32Array;
  /** The game's work: workMs − agentMs, at least 0. */
  readonly jsMs: Float32Array;
  /** GPU ms; NaN = not measured (yet). */
  readonly gpuMs: Float32Array;
  /** One frame of the frame's rate, ms (ring column `rateMs`); a change from one row to the next is a rate switch. */
  readonly rateMs: Float32Array;
  /** The frame's own spike budget, ms (ring column `budgetMs`): the budget the engine's spike rule used for it. */
  readonly budgetMs: Float32Array;
  /** 1 when the renderer drew the frame. */
  readonly drawn: Uint8Array;
  /** The engine's cause bits (CAUSE_BITS). */
  readonly causes: Uint8Array;
  /** The primary cause code (CAUSE_RANK), 0 = not a spike. */
  readonly cause: Uint8Array;
  /** Rows of the spikes, oldest first. */
  readonly spikes: Uint16Array;
  /** Spikes in `spikes`. */
  spikeCount: number;
};

/**
 * The window as a reader sees it: every scalar `readonly` and every column a read-only
 * `ArrayLike<number>` (a typed array is assignable to it), so a visitor cannot write a row or a
 * scalar without a cast. No copy is made; typed arrays cannot be frozen, so the guard is the type.
 *
 * @example
 * ```ts
 * app.perf.readWindow(window => {
 *   window.ms[window.count - 1]; // 41.3
 *   // window.ms[0] = 0; — a type error: the index signature only permits reading
 * });
 * ```
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
 * The wire form of a window (source `editor.perf.window`). Columns are plain arrays, so the value
 * is Json.
 *
 * @example
 * ```ts
 * const wire: PerfWindowWire = { v: 1, startMs: 40123.5, endMs: 46123.5, gpuTimer: true, frame: [4811, 4812],
 *   t: [5917.4, 5958.7], ms: [16.7, 41.3], jsMs: [3.4, 8], gpuMs: [5.2, 6.6], rateMs: [16.67, 16.67],
 *   budgetMs: [16.67, 16.67], drawn: [1, 1], causes: [0, 17] }; // 17 = gap + upload: primary upload
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
  /** The frame's own spike budget (ring column `budgetMs`). */
  budgetMs: number[];
  drawn: (0 | 1)[];
  causes: number[];
};

/** The most rows a window holds: `spikes` is a Uint16Array. */
const MAX_ROWS = 65_535;

/** The longest span a wire window may have, ms: a longer one is a hostile or broken value. */
const MAX_WIRE_SPAN_MS = 60_000;

/** The longest frame of a rate a wire window may carry, ms (1 fps): `rateMs` is in (0, 1000]. */
const MAX_RATE_MS = 1000;

/** The cause bits the editor knows (seven, CAUSE_BITS): every other bit of a wire value is dropped. */
const KNOWN_CAUSES = 0x7f;

/** The largest `causes` value of a ring column (a byte); a larger wire value is no cause. */
const MAX_CAUSE_BYTE = 0xff;

/** Wire rounding: `t` to tenths of a ms, every other ms value to hundredths. */
const TIME_SCALE = 10;
const MS_SCALE = 100;

/** The number columns of the wire form, besides `gpuMs`. */
const NUMBER_COLUMNS = [
  "frame",
  "t",
  "ms",
  "jsMs",
  "rateMs",
  "budgetMs",
  "drawn",
  "causes"
] as const;

/**
 * Whether a capacity is a row count a window can hold: a whole number from 1 to 65535 (`spikes` is
 * a Uint16Array).
 *
 * @param capacity - The rows asked for.
 * @returns Whether a window can have it.
 * @example
 * ```ts
 * isRowCount(65_536); // false
 * ```
 */
function isRowCount(capacity: number): boolean {
  return Number.isInteger(capacity) && capacity >= 1 && capacity <= MAX_ROWS;
}

/**
 * Whether a wire window's span is one the tools page may draw: finite, above 0 and at most 60 s.
 *
 * @param span - `endMs − startMs`, ms.
 * @returns Whether the span is allowed.
 * @example
 * ```ts
 * isWireSpan(600_000); // false: a hostile ten-minute window
 * ```
 */
function isWireSpan(span: number): boolean {
  return Number.isFinite(span) && span > 0 && span <= MAX_WIRE_SPAN_MS;
}

/**
 * Allocates a window of `capacity` rows: every array once, `count` 0, `gpuTimer` true, `version` 0.
 *
 * @param capacity - Rows, a whole number from 1 to 65535.
 * @returns The empty window.
 * @throws {TypeError} For a capacity that is not a whole number from 1 to 65535.
 * @example
 * ```ts
 * createPerfWindow(1024).capacity; // 1024
 * ```
 */
export function createPerfWindow(capacity: number): PerfWindow {
  if (!isRowCount(capacity)) {
    throw new TypeError(
      `[moku-editor] createPerfWindow(${String(capacity)}) needs a whole number of rows from 1 to 65535.\n  Pass perf's frames, for example 1024.`
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
    const at = cell(window.frame, middle);
    if (at === frame) return middle;
    if (at < frame) low = middle + 1;
    else high = middle - 1;
  }

  return -1;
}

/**
 * The next (1) or previous (−1) spike row after (before) `row`, wrapping around; from a row that is
 * not a spike, the first spike after / the last before it.
 *
 * @param window - The window.
 * @param row - The row to step from.
 * @param dir - 1 for next, −1 for previous.
 * @returns The spike row; −1 when the window has no spike.
 * @example
 * ```ts
 * stepSpike(window, 300, 1); // 12: past the newest spike (row 290), wrapped to the oldest
 * ```
 */
export function stepSpike(window: PerfWindowView, row: number, dir: 1 | -1): number {
  const total = window.spikeCount;
  if (total === 0) return -1;

  if (dir === 1) {
    for (let index = 0; index < total; index += 1) {
      const spike = cell(window.spikes, index);
      if (spike > row) return spike;
    }
    return window.spikes[0] ?? -1;
  }

  for (let index = total - 1; index >= 0; index -= 1) {
    const spike = cell(window.spikes, index);
    if (spike < row) return spike;
  }
  return window.spikes[total - 1] ?? -1;
}

/**
 * The 1-based position of a row among the spikes: the "5/6" counter is `spikeOrdinal` / `spikeCount`.
 *
 * @param window - The window.
 * @param row - A row.
 * @returns The position; 0 when the row is not a spike.
 * @example
 * ```ts
 * spikeOrdinal(window, 290); // 5 when row 290 is the fifth spike
 * ```
 */
export function spikeOrdinal(window: PerfWindowView, row: number): number {
  for (let index = 0; index < window.spikeCount; index += 1) {
    if (window.spikes[index] === row) return index + 1;
  }

  return 0;
}

/**
 * The mean of the measured `gpuMs` of the drawn rows: the "GPU avg" counter of the overlay and the
 * tools strip. An indexed loop, no allocation.
 *
 * @param window - The window.
 * @returns The mean; null when no drawn row has a measured GPU time (WebKit has no GPU timer).
 * @example
 * ```ts
 * // Two drawn rows whose GPU took 5 and 7 ms: the "GPU avg" counter reads 6.
 * const window = createPerfWindow(2);
 * window.count = 2;
 * window.drawn.set([1, 1]);
 * window.gpuMs.set([5, 7]);
 * meanGpu(window); // 6
 * ```
 */
export function meanGpu(window: PerfWindowView): number | null {
  let sum = 0;
  let measured = 0;
  for (let row = 0; row < window.count; row += 1) {
    const gpu = cell(window.gpuMs, row);
    if (window.drawn[row] === 1 && Number.isFinite(gpu)) {
      sum += gpu;
      measured += 1;
    }
  }

  // eslint-disable-next-line unicorn/no-null -- null is spec 03's "no GPU timer" marker
  return measured === 0 ? null : sum / measured;
}

/**
 * A number rounded to `scale` steps (100: 0.01); 0 for a value that is not finite.
 *
 * @param value - The number.
 * @param scale - Steps per unit.
 * @returns The rounded number.
 * @example
 * ```ts
 * roundTo(16.666_666, 100); // 16.67
 * ```
 */
function roundTo(value: number, scale: number): number {
  return Number.isFinite(value) ? Math.round(value * scale) / scale : 0;
}

/**
 * Copies a read-only column into a plain array of rounded numbers.
 *
 * @param column - The column.
 * @param count - Rows in use.
 * @param scale - Steps per unit of the rounding (100: 0.01).
 * @returns The plain array.
 * @example
 * ```ts
 * plainColumn(Float32Array.of(16.666_666), 1, 100); // [16.67]
 * ```
 */
function plainColumn(column: ArrayLike<number>, count: number, scale: number): number[] {
  const plain: number[] = [];
  for (let row = 0; row < count; row += 1) plain.push(roundTo(cell(column, row), scale));
  return plain;
}

/**
 * The wire value of a window (source `editor.perf.window`). Allocates: `t` as ms after `startMs`
 * rounded to 0.1, ms values (`rateMs` and `budgetMs` included) to 0.01, a `NaN` GPU time as `null`.
 *
 * @param window - The window.
 * @returns The wire value.
 * @example
 * ```ts
 * writeWireWindow(window).budgetMs; // [16.67, 16.67]
 * ```
 */
export function writeWireWindow(window: PerfWindowView): PerfWindowWire {
  const { count, startMs } = window;
  const frame: number[] = [];
  const t: number[] = [];
  const gpuMs: (number | null)[] = [];
  const drawn: (0 | 1)[] = [];
  const causes: number[] = [];
  // The columns with their own rule: times after startMs, a NaN GPU time as null, drawn as 0 | 1.
  for (let row = 0; row < count; row += 1) {
    const gpu = cell(window.gpuMs, row);
    frame.push(cell(window.frame, row));
    t.push(roundTo(cell(window.t, row) - startMs, TIME_SCALE));
    // eslint-disable-next-line unicorn/no-null -- null is "not measured" on the wire (JSON has no NaN)
    gpuMs.push(Number.isFinite(gpu) ? roundTo(gpu, MS_SCALE) : null);
    drawn.push(window.drawn[row] === 1 ? 1 : 0);
    causes.push(cell(window.causes, row));
  }

  // The plain ms columns, to hundredths.
  return {
    v: 1,
    startMs,
    endMs: window.endMs,
    gpuTimer: window.gpuTimer,
    frame,
    t,
    ms: plainColumn(window.ms, count, MS_SCALE),
    jsMs: plainColumn(window.jsMs, count, MS_SCALE),
    gpuMs,
    rateMs: plainColumn(window.rateMs, count, MS_SCALE),
    budgetMs: plainColumn(window.budgetMs, count, MS_SCALE),
    drawn,
    causes
  };
}

/**
 * A decoded JSON object.
 */
type JsonObject = { readonly [key: string]: Json };

/**
 * A wire value `checkedWire` accepted: its object, its scalars and its `gpuMs` column.
 */
type CheckedWire = {
  readonly object: JsonObject;
  readonly startMs: number;
  readonly endMs: number;
  readonly gpuTimer: boolean;
  readonly gpu: readonly (number | null)[];
};

/**
 * Whether a Json value is an array of finite numbers of the given length.
 *
 * @param value - The value.
 * @param length - The length every column has.
 * @returns Whether it is a number column.
 * @example
 * ```ts
 * isColumn([16.7, 41.3], 2); // true
 * ```
 */
function isColumn(value: Json | undefined, length: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every(item => typeof item === "number" && Number.isFinite(item))
  );
}

/**
 * Whether a Json value is the `gpuMs` column: finite numbers and nulls.
 *
 * @param value - The value.
 * @returns Whether it is a gpu column.
 * @example
 * ```ts
 * isGpuColumn([5.2, null]); // true
 * ```
 */
function isGpuColumn(value: Json | undefined): value is (number | null)[] {
  return (
    Array.isArray(value) &&
    value.every(item => item === null || (typeof item === "number" && Number.isFinite(item)))
  );
}

/**
 * Whether a wire value is a plain object: not null, not an array, not a scalar.
 *
 * @param value - The wire value.
 * @returns Whether it is a Json object.
 * @example
 * ```ts
 * isJsonObject([1]); // false
 * ```
 */
function isJsonObject(value: Json): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether the wire `rateMs` is a number column of the given length with every rate in (0, 1000].
 *
 * @param rateMs - The wire `rateMs` value.
 * @param length - The length every column has.
 * @returns Whether the rates are valid.
 * @example
 * ```ts
 * hasValidRates([16.7, 0], 2); // false
 * ```
 */
function hasValidRates(rateMs: Json | undefined, length: number): boolean {
  return isColumn(rateMs, length) && rateMs.every(ms => ms > 0 && ms <= MAX_RATE_MS);
}

/**
 * Checks a wire value as a window the tools page may draw: an object of `v: 1`, a finite span of
 * more than 0 and at most 60 s, a boolean `gpuTimer`, equal-length number columns (`gpuMs` may
 * hold null) and every `rateMs` in (0, 1000]. A hostile phone value must not freeze the page, so a span past 60 s is refused.
 *
 * @param value - The value of `editor.perf.window`.
 * @returns The checked parts, or undefined for any other shape.
 * @example
 * ```ts
 * checkedWire({ v: 2 }); // undefined
 * ```
 */
function checkedWire(value: Json): CheckedWire | undefined {
  // Shape: an object of v: 1 with numeric startMs and endMs.
  if (!isJsonObject(value)) return undefined;
  const { v, startMs, endMs, gpuTimer, gpuMs } = value;
  if (v !== 1 || typeof startMs !== "number" || typeof endMs !== "number") return undefined;

  // Span: a hostile phone value must not make the tools page loop for long.
  if (!isWireSpan(endMs - startMs)) return undefined;

  // Columns: a boolean gpuTimer, equal-length number columns, every rateMs in (0, 1000].
  if (typeof gpuTimer !== "boolean" || !isGpuColumn(gpuMs)) return undefined;
  const { length } = gpuMs;
  if (!NUMBER_COLUMNS.every(key => isColumn(value[key], length))) return undefined;
  const { rateMs } = value;
  if (!hasValidRates(rateMs, length)) return undefined;
  return { object: value, startMs, endMs, gpuTimer, gpu: gpuMs };
}

/**
 * Whether a wire `causes` item can be a ring value: a whole number from 0 to 255.
 *
 * @param value - The wire item.
 * @returns Whether it is a cause byte.
 * @example
 * ```ts
 * isCauseByte(300); // false
 * ```
 */
function isCauseByte(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_CAUSE_BYTE;
}

/**
 * A known cause bits value: an integer from the wire with every unknown bit dropped; 0 for a value
 * that is not a whole number from 0 to 255. Never throws.
 *
 * @param value - The wire `causes` item.
 * @returns The bits the editor knows.
 * @example
 * ```ts
 * knownCauses(0b1001_0001); // 17: bit 7 is not a cause the editor knows
 * ```
 */
function knownCauses(value: number): number {
  return isCauseByte(value) ? value & KNOWN_CAUSES : 0;
}

/**
 * The number at `index` of a column that `checkedWire` accepted.
 *
 * @param object - The checked wire object.
 * @param key - The column.
 * @param index - The index.
 * @returns The number; 0 when missing.
 * @example
 * ```ts
 * cellOf({ ms: [16.7] }, "ms", 0); // 16.7
 * ```
 */
function cellOf(object: JsonObject, key: string, index: number): number {
  const column = object[key];
  const value = Array.isArray(column) ? column[index] : undefined;
  return typeof value === "number" ? value : 0;
}

/**
 * Copies one row of a checked wire value into a window row: times back to page-clock ms, a null GPU
 * time as NaN, unknown cause bits dropped, the primary cause recomputed. Allocates nothing.
 *
 * @param wire - The checked wire value.
 * @param from - The wire row.
 * @param into - The window.
 * @param row - The window row.
 * @returns The row's primary cause code (0 = not a spike).
 */
function copyRow(wire: CheckedWire, from: number, into: PerfWindow, row: number): number {
  const { object } = wire;
  const gpuValue = wire.gpu[from];
  const causes = knownCauses(cellOf(object, "causes", from));
  const cause = primaryCause(causes);
  into.frame[row] = cellOf(object, "frame", from);
  into.t[row] = wire.startMs + cellOf(object, "t", from);
  into.ms[row] = cellOf(object, "ms", from);
  into.jsMs[row] = cellOf(object, "jsMs", from);
  into.gpuMs[row] = typeof gpuValue === "number" ? gpuValue : Number.NaN;
  into.rateMs[row] = cellOf(object, "rateMs", from);
  into.budgetMs[row] = cellOf(object, "budgetMs", from);
  into.drawn[row] = cellOf(object, "drawn", from) === 1 ? 1 : 0;
  into.causes[row] = causes;
  into.cause[row] = cause;
  return cause;
}

/**
 * Fills `into` from a wire value: false and `into` untouched for a value of another shape (see
 * `checkedWire`); keeps the newest `into.capacity` rows; drops the cause bits the editor does not
 * know; recomputes `cause` and `spikes` with `primaryCause`; `version += 1`.
 *
 * @param value - The value of `editor.perf.window`.
 * @param into - The window to fill.
 * @returns Whether the value was a window.
 * @example
 * ```ts
 * readWireWindow({ v: 2 }, window); // false: window unchanged
 * ```
 */
export function readWireWindow(value: Json, into: PerfWindow): boolean {
  const wire = checkedWire(value);
  if (wire === undefined) return false;

  // The rows: the newest `capacity` of the wire, the spike index rebuilt from their causes.
  const offset = Math.max(0, wire.gpu.length - into.capacity);
  const count = wire.gpu.length - offset;
  let spikeCount = 0;
  for (let row = 0; row < count; row += 1) {
    if (copyRow(wire, row + offset, into, row) === 0) continue;
    into.spikes[spikeCount] = row;
    spikeCount += 1;
  }

  // The scalars, and a new version for the painter.
  const { startMs } = wire;
  into.count = count;
  into.spikeCount = spikeCount;
  into.startMs = startMs;
  into.endMs = wire.endMs;
  into.gpuTimer = wire.gpuTimer;
  into.version += 1;
  return true;
}

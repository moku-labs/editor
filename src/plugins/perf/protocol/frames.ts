/**
 * @file perf/protocol — the frames feed (spec 03 Delta 2026-10-16 D9) and the range detail (D8):
 * the window rows after a frame with the per-frame blocks the feeds switched on, and the wire value
 * of `editor.perf.detail`. Columns are plain arrays (Json); `readFramesWire` checks one before the
 * tools page keeps it. Runtime-free.
 */
import type { Json } from "../../registry/protocol";
import type { PassKind } from "./engine";
import { PASS_KINDS } from "./passes";
import type { RestState } from "./window";

/**
 * The systems kept per frame: the engine's top 5 (`sysIdx` / `sysMs` are rows × 5, −1 = none).
 */
export const SYSTEMS_PER_FRAME = 5;

/**
 * The top 5 systems of each frame row: `names` indexes, `idx` and `ms` are rows × 5, −1 = none.
 *
 * @example
 * ```ts
 * const systems: PerfSystemsWire = { names: ["ward.update", "fog.render"], idx: [0, 1, -1, -1, -1], ms: [6.2, 1.4, 0, 0, 0] };
 * ```
 */
export type PerfSystemsWire = { names: string[]; idx: number[]; ms: number[] };

/**
 * Pass rows, flat columns; `row` is the index into the frame columns. Owner / filter / draws / format
 * are null when not measured (an engine before the 0.15.x patch).
 *
 * @example
 * ```ts
 * const passes: PerfPassRowsWire = { row: [0], index: [0], kind: ["canvas"], view: ["main"], owner: [null], filter: [null],
 *   w: [1080], h: [2340], format: ["bgra8unorm"], resolution: [2.6], draws: [41], gpuMs: [3.1] };
 * ```
 */
export type PerfPassRowsWire = {
  row: number[];
  index: number[];
  kind: PassKind[];
  view: (string | null)[];
  owner: (number | null)[];
  filter: (string | null)[];
  w: number[];
  h: number[];
  format: (string | null)[];
  resolution: (number | null)[];
  draws: (number | null)[];
  gpuMs: (number | null)[];
};

/**
 * Window rows after a frame, with the per-frame blocks the feeds switched on (the wire value of
 * `editor.perf.frames { after? }`). Each frame crosses the wire once.
 *
 * @example
 * ```ts
 * const wire: PerfFramesWire = { v: 1, epoch: "1792000000000.5", t0: 80000, hole: false, gpuTimer: true,
 *   frame: [4855], t: [310.2], ms: [18.4], jsMs: [8.1], gpuMs: [9.6], rateMs: [16.67], budgetMs: [16.67], drawn: [1],
 *   rest: [0], causes: [4], noise: [0], draws: [61],
 *   systems: { names: ["ward.update", "fog.render"], idx: [0, 1, -1, -1, -1], ms: [6.2, 1.4, 0, 0, 0] }, nodes: [20] };
 * ```
 */
export type PerfFramesWire = {
  v: 1;
  /** The page's clock origin (header.timeOrigin) as text; a new value means a new page (reload). */
  epoch: string | null;
  /** Page-clock ms every `t` is relative to (the first row's start, rounded to 0.1). */
  t0: number;
  /** True when `after` was older than the oldest row perf still had: frames are missing before `frame[0]`. */
  hole: boolean;
  gpuTimer: boolean;
  frame: number[];
  t: number[];
  ms: number[];
  jsMs: number[];
  gpuMs: (number | null)[];
  rateMs: number[];
  budgetMs: number[];
  drawn: (0 | 1)[];
  rest: RestState[];
  causes: number[];
  noise: number[];
  /** Draw calls per frame (ring `draws`); absent on WebGL (not counted). */
  draws?: (number | null)[];
  /** feeds.systems and caps.systemNames: the top 5 systems per frame. */
  systems?: PerfSystemsWire;
  /** feeds.nodes: demand marks per frame (ring `marks`). */
  nodes?: number[];
  /** feeds.passes: the pass rows of these frames. */
  passes?: PerfPassRowsWire;
};

/**
 * The wire value of `editor.perf.detail { from, to }`: the rows of a range from the engine's
 * `monitor.detail` (next change), else from perf's own window, else none (`reason: "gone"`).
 *
 * @example
 * ```ts
 * const detail: PerfDetailWire = { v: 1, from: 4810, to: 4860, source: "agent", reason: "no-detail", frames: null, nodes: null };
 * ```
 */
export type PerfDetailWire = {
  v: 1;
  from: number;
  to: number;
  /** Where the rows came from; null when none. */
  source: "engine" | "agent" | null;
  /** Why not the engine's detail: no `monitor.detail` (older engine), refused (build without control), failed, or the frames are gone. */
  reason: "no-detail" | "control" | "failed" | "gone" | null;
  frames: PerfFramesWire | null;
  /** Nodes updated or redrawn, from the engine's mark ring (next change); null otherwise. */
  nodes:
    | {
        entity: number;
        label: string | null;
        how: "mark" | "moved" | "loose" | "invalidate" | "redraw";
        count: number;
      }[]
    | null;
};

/**
 * A decoded JSON object.
 */
type JsonObject = { readonly [key: string]: Json };

/** The most frame rows a wire may carry: a window's bound (`createPerfWindow`). */
const MAX_WIRE_ROWS = 65_535;

/** The most pass rows a wire may carry: four for each of the most frame rows. */
const MAX_WIRE_PASSES = MAX_WIRE_ROWS * 4;

/** The largest frame number and owner entity (Uint32 columns). */
const MAX_UINT32 = 0xff_ff_ff_ff;

/** The largest pass width or height (Uint16 columns). */
const MAX_UINT16 = 0xff_ff;

/** The largest pass index (a Uint8 column). */
const MAX_UINT8 = 0xff;

/** The largest `REST` value. */
const MAX_REST = 3;

/** The plain number columns of a frames wire, besides `frame`, `gpuMs`, `drawn` and `rest`. */
const NUMBER_COLUMNS = ["t", "ms", "jsMs", "rateMs", "budgetMs", "causes", "noise"] as const;

/** The text-or-null columns of the pass rows. */
const PASS_TEXT_COLUMNS = ["view", "filter", "format"] as const;

/** The number-or-null columns of the pass rows. */
const PASS_MEASURE_COLUMNS = ["owner", "resolution", "draws", "gpuMs"] as const;

/**
 * Whether a Json value is a plain object.
 *
 * @param value - The value.
 * @returns Whether it is one.
 * @example
 * ```ts
 * isJsonObject([1]); // false
 * ```
 */
function isJsonObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether a Json value is an array of `length` items that each pass `test`.
 *
 * @param value - The value.
 * @param length - The items it must have.
 * @param test - The check of one item.
 * @returns Whether it is such a column.
 * @example
 * ```ts
 * isColumnOf([1, 2], 2, isFinite); // true
 * ```
 */
function isColumnOf(
  value: Json | undefined,
  length: number,
  test: (item: Json) => boolean
): boolean {
  return Array.isArray(value) && value.length === length && value.every(item => test(item));
}

/**
 * Whether a Json item is a finite number.
 *
 * @param item - The item.
 * @returns Whether it is one.
 * @example
 * ```ts
 * isNumber(Number.NaN); // false
 * ```
 */
function isNumber(item: Json): item is number {
  return typeof item === "number" && Number.isFinite(item);
}

/**
 * Whether a Json item is a finite number or null.
 *
 * @param item - The item.
 * @returns Whether it is one.
 * @example
 * ```ts
 * isNumberOrNull(null); // true
 * ```
 */
function isNumberOrNull(item: Json): boolean {
  return item === null || isNumber(item);
}

/**
 * Whether a Json item is a string or null.
 *
 * @param item - The item.
 * @returns Whether it is one.
 * @example
 * ```ts
 * isTextOrNull(4); // false
 * ```
 */
function isTextOrNull(item: Json): boolean {
  return item === null || typeof item === "string";
}

/**
 * A check of whole numbers from `min` to `max`.
 *
 * @param min - The smallest allowed.
 * @param max - The largest allowed.
 * @returns The check.
 * @example
 * ```ts
 * wholeIn(0, 1)(2); // false
 * ```
 */
function wholeIn(min: number, max: number): (item: Json) => boolean {
  return item => typeof item === "number" && Number.isInteger(item) && item >= min && item <= max;
}

/**
 * Whether the pass `row` column is a list of frame rows, each inside the wire's rows and never going
 * back (the history keeps pass rows in frame order).
 *
 * @param value - The column.
 * @param rows - The wire's frame rows.
 * @returns Whether it is.
 * @example
 * ```ts
 * isPassRowColumn([0, 0, 1], 2); // true
 * ```
 */
function isPassRowColumn(value: Json | undefined, rows: number): value is number[] {
  if (!Array.isArray(value) || value.length > MAX_WIRE_PASSES) return false;
  let previous = 0;
  for (const item of value) {
    if (typeof item !== "number" || !Number.isInteger(item) || item < previous || item >= rows) {
      return false;
    }
    previous = item;
  }
  return true;
}

/**
 * Whether a Json value is the pass rows of a wire of `rows` frame rows: twelve columns of one length,
 * `row` inside the rows and in order, `index` a byte, `kind` a known pass kind, texts or null, numbers
 * or null, `w` and `h` whole numbers that fit 16 bits.
 *
 * @param value - The `passes` block.
 * @param rows - The wire's frame rows.
 * @returns Whether it is.
 * @example
 * ```ts
 * isPassRows({ row: [2] }, 1); // false: row 2 of a one-row wire
 * ```
 */
function isPassRows(value: Json | undefined, rows: number): boolean {
  if (!isJsonObject(value) || !isPassRowColumn(value.row, rows)) return false;
  const count = value.row.length;
  const kinds: readonly Json[] = PASS_KINDS;
  return (
    isColumnOf(value.index, count, wholeIn(0, MAX_UINT8)) &&
    isColumnOf(value.kind, count, item => kinds.includes(item)) &&
    isColumnOf(value.w, count, wholeIn(0, MAX_UINT16)) &&
    isColumnOf(value.h, count, wholeIn(0, MAX_UINT16)) &&
    PASS_TEXT_COLUMNS.every(key => isColumnOf(value[key], count, isTextOrNull)) &&
    PASS_MEASURE_COLUMNS.every(key => isColumnOf(value[key], count, isNumberOrNull))
  );
}

/**
 * Whether a Json value is the systems block of a wire of `rows` frame rows: a list of names, and
 * `idx` / `ms` of rows × 5 with every index −1 or inside the names.
 *
 * @param value - The `systems` block.
 * @param rows - The wire's frame rows.
 * @returns Whether it is.
 * @example
 * ```ts
 * isSystems({ names: ["ward.update"], idx: [1, -1, -1, -1, -1], ms: [6, 0, 0, 0, 0] }, 1); // false: index 1
 * ```
 */
function isSystems(value: Json | undefined, rows: number): boolean {
  if (!isJsonObject(value)) return false;
  const { names } = value;
  if (!Array.isArray(names) || !names.every(name => typeof name === "string")) return false;
  const cells = rows * SYSTEMS_PER_FRAME;
  return (
    isColumnOf(value.idx, cells, wholeIn(-1, names.length - 1)) &&
    isColumnOf(value.ms, cells, isNumber)
  );
}

/**
 * Whether the optional blocks of a wire are each absent or aligned with its `rows` frame rows.
 *
 * @param wire - The wire object.
 * @param rows - Its frame rows.
 * @returns Whether every present block lines up.
 * @example
 * ```ts
 * hasValidBlocks({ draws: [61] }, 2); // false: one draw count for two rows
 * ```
 */
function hasValidBlocks(wire: JsonObject, rows: number): boolean {
  const { draws, nodes, systems, passes } = wire;
  return (
    (draws === undefined || isColumnOf(draws, rows, isNumberOrNull)) &&
    (nodes === undefined || isColumnOf(nodes, rows, isNumber)) &&
    (systems === undefined || isSystems(systems, rows)) &&
    (passes === undefined || isPassRows(passes, rows))
  );
}

/**
 * Whether a Json value is a frames wire (see `readFramesWire`).
 *
 * @param value - The value.
 * @returns Whether it is one.
 * @example
 * ```ts
 * isFramesWire({ v: 2 }); // false
 * ```
 */
function isFramesWire(value: Json): value is PerfFramesWire {
  if (!isJsonObject(value) || value.v !== 1) return false;
  const { epoch, t0, hole, gpuTimer, frame } = value;
  if (epoch !== null && typeof epoch !== "string") return false;
  if (typeof t0 !== "number" || !Number.isFinite(t0)) return false;
  if (typeof hole !== "boolean" || typeof gpuTimer !== "boolean") return false;
  if (!Array.isArray(frame) || frame.length > MAX_WIRE_ROWS) return false;

  const rows = frame.length;
  return (
    isColumnOf(frame, rows, wholeIn(0, MAX_UINT32)) &&
    NUMBER_COLUMNS.every(key => isColumnOf(value[key], rows, isNumber)) &&
    isColumnOf(value.gpuMs, rows, isNumberOrNull) &&
    isColumnOf(value.drawn, rows, wholeIn(0, 1)) &&
    isColumnOf(value.rest, rows, wholeIn(0, MAX_REST)) &&
    hasValidBlocks(value, rows)
  );
}

/**
 * Checks a frames wire: `v: 1`, an epoch (text or null), a finite `t0`, boolean `hole` and
 * `gpuTimer`; frame columns of one length (at most 65 535 rows) with whole frame numbers, finite
 * numbers, `drawn` 0 or 1 and `rest` a REST value; and each optional block aligned with the rows:
 * `draws` and `nodes` per row, `systems.idx` / `ms` of rows × 5 with indexes inside `names`, pass rows
 * inside the rows and in order with a known kind. The tools page drops a value it refuses and warns
 * once. Pure; answers the value itself, never a copy.
 *
 * @param value - The value read from `editor.perf.frames` (or the frames of a detail answer).
 * @returns The value typed, or undefined.
 * @example
 * ```ts
 * readFramesWire({ ...wire, ms: wire.ms.slice(1) }); // undefined: a column one row short
 * ```
 */
export function readFramesWire(value: Json): PerfFramesWire | undefined {
  return isFramesWire(value) ? value : undefined;
}

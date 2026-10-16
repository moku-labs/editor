/**
 * @file perf/protocol — the tools page's 2-minute history of one source (spec 03 Delta 2026-10-16
 * D10): frames, pass rows, timeline events and per-second pass summaries of the last HISTORY_MS,
 * struct-of-arrays, allocated once by `createPerfHistory` and written allocation-free by the
 * `append*` functions; `rangeRows` and `rangeSummary` read a selection. It lives on the tools page,
 * not on the device: the engine ring holds about 8 s, pause and rewind are a view of the tools page,
 * and a disconnect must not lose what was seen. renderView owns one instance (spec 09 § M11) and
 * reads its columns, never writes them. Runtime-free. `createPerfHistory` is built (the tools page's
 * state allocates it); the other functions are typed stubs until build wave 1 (unit A).
 */
import type { PassKind, PerfCause, RateReason } from "./engine";
import type { PerfFramesWire } from "./frames";
import { SYSTEMS_PER_FRAME } from "./frames";
import type { PerfPassesWire } from "./passes";
import type { PerfEventsWire, PerfTimelineEvent, ShaderWhat } from "./timeline";

/** The history's span, ms: owner item 25, "about 2 min". */
export const HISTORY_MS = 120_000;

/** Frame rows held at most: 120 s × 120 fps. */
export const HISTORY_ROWS = 14_400;

/** Pass rows held at most: 4 per frame, like the engine ring. */
export const HISTORY_PASS_ROWS = 57_600;

/** Timeline events held at most: 2 min with room for a shader burst at boot. */
export const HISTORY_EVENTS = 1024;

/** Per-second pass summaries held at most: one per second. */
export const HISTORY_SECONDS = 120;

/** Holes (frames missing after a frame) held at most; the oldest drop first. */
export const HISTORY_HOLES = 256;

/**
 * The tools page's history of one source, oldest row at index 0 of every column. Frame columns hold
 * `count` rows, pass columns `passCount`, `events` `eventCount`, `seconds` `secondCount`, `holes`
 * `holeCount`. A number that was not measured is NaN in a float column (null on the wire). A new
 * `epoch` (a reload) or another source clears it; `version` is bumped on every change, so painters
 * and selections key on it.
 *
 * @example
 * ```ts
 * const history = createPerfHistory();
 * history.count; // 0
 * history.frame.length; // 14400 (HISTORY_ROWS)
 * ```
 */
export type PerfHistory = {
  /** Frame rows held at most (HISTORY_ROWS). */
  readonly capacity: number;
  /** Frame rows held. */
  count: number;
  /** The page's clock origin of the rows (the frames wire's `epoch`); null before the first rows. */
  epoch: string | null;
  /** Bumped whenever rows, pass rows, events, seconds or holes change. */
  version: number;
  /** The newest frames wire's `gpuTimer`: false on iOS, every gpuMs is then NaN. */
  gpuTimer: boolean;

  /** Frame number of each row. */
  readonly frame: Uint32Array;
  /** Page-clock ms of each frame's start (the wire's `t0 + t`). */
  readonly t: Float64Array;
  readonly ms: Float32Array;
  readonly jsMs: Float32Array;
  /** NaN: not measured. */
  readonly gpuMs: Float32Array;
  readonly rateMs: Float32Array;
  readonly budgetMs: Float32Array;
  /** 1: the renderer drew the frame. */
  readonly drawn: Uint8Array;
  /** REST values (awake, idle, woke, break). */
  readonly rest: Uint8Array;
  /** Cause bits in CAUSE_BITS order. */
  readonly causes: Uint32Array;
  readonly noise: Uint8Array;
  /** Draw calls; NaN: not counted (WebGL, or the feed sent none). */
  readonly draws: Float32Array;
  /** Top 5 systems per row (rows × SYSTEMS_PER_FRAME): indexes into `systemNames`; −1: none. */
  readonly sysIdx: Int16Array;
  /** Their ms (rows × SYSTEMS_PER_FRAME). */
  readonly sysMs: Float32Array;
  /** The source's system names by the index `sysIdx` holds, merged from each wire's names. */
  readonly systemNames: string[];
  /** Demand marks per row; −1: not sent (feeds.nodes off). */
  readonly nodes: Int32Array;

  /** Pass rows held at most (HISTORY_PASS_ROWS). */
  readonly passCapacity: number;
  /** Pass rows held. */
  passCount: number;
  /** The frame number each pass row belongs to. */
  readonly passFrame: Uint32Array;
  readonly passIndex: Uint8Array;
  readonly passKind: PassKind[];
  readonly passView: (string | null)[];
  /** The owner entity; 0: none or not measured. */
  readonly passOwner: Uint32Array;
  /** The filter kind's name; null: not a filter or not measured. */
  readonly passFilter: (string | null)[];
  readonly passW: Uint16Array;
  readonly passH: Uint16Array;
  readonly passFormat: (string | null)[];
  /** NaN: not measured. */
  readonly passResolution: Float32Array;
  /** NaN: not counted. */
  readonly passDraws: Float32Array;
  /** NaN: not measured. */
  readonly passGpuMs: Float32Array;

  /** Frame numbers after which frames are missing (a stall longer than the agent's window), oldest first. */
  readonly holes: Uint32Array;
  /** Holes held. */
  holeCount: number;

  /** Timeline events, oldest first. */
  readonly events: (PerfTimelineEvent | undefined)[];
  /** Events held. */
  eventCount: number;
  /** The events feed's `next` of the newest answer: the `after` of the next read; undefined before. */
  eventsNext: number | undefined;

  /** Per-second pass summaries, oldest first. */
  readonly seconds: (PerfPassesWire | undefined)[];
  /** Summaries held. */
  secondCount: number;
};

/**
 * What one `appendFrames` did: rows added, whether a hole was recorded, whether a new epoch cleared
 * the history first.
 *
 * @example
 * ```ts
 * const appended: AppendResult = { added: 120, hole: false, reset: false };
 * ```
 */
export type AppendResult = {
  readonly added: number;
  readonly hole: boolean;
  readonly reset: boolean;
};

/**
 * One system over a range: total ms, its share of the range's summed JS, its largest frame.
 *
 * @example
 * ```ts
 * const system: RangeSystem = { name: "ward.update", totalMs: 312.4, share: 0.41, maxMs: 9.1 };
 * ```
 */
export type RangeSystem = {
  readonly name: string;
  readonly totalMs: number;
  readonly share: number;
  readonly maxMs: number;
};

/**
 * One pass kind and view over a range: how often it ran, its GPU ms in total, its share of the
 * range's pass GPU.
 *
 * @example
 * ```ts
 * const pass: RangePass = { kind: "filter", view: "fogLayer", count: 102, gpuMs: 316.2, share: 0.58 };
 * ```
 */
export type RangePass = {
  readonly kind: PassKind;
  readonly view: string | null;
  readonly count: number;
  readonly gpuMs: number | null;
  readonly share: number | null;
};

/**
 * One filter chain over a range.
 *
 * @example
 * ```ts
 * const chain: RangeChain = { owner: 412, view: "fogLayer", kinds: ["fog.blur", "fog.blur"], applies: 102, gpuMs: 316.2 };
 * ```
 */
export type RangeChain = {
  readonly owner: number | null;
  readonly view: string | null;
  readonly kinds: readonly string[];
  readonly applies: number;
  readonly gpuMs: number | null;
};

/**
 * What a range selection holds (D10 `rangeSummary`): its frames and seconds, the worst frame, the
 * systems (from the per-frame top 5, or prorated from the seconds' `sample.systems` with
 * `systemsPerSecond`), spikes, GCs, rate changes, shader compiles, passes and filter chains (from
 * the pass rows, or the seconds' chains with `passesPerSecond`), demand marks and the holes inside.
 *
 * @example
 * ```ts
 * const summary: PerfRangeSummary = { from: 4810, to: 4860, frames: 51, durationMs: 850.2, seconds: 1, worstMs: 41.3, jsMs: 762.1,
 *   systems: [{ name: "ward.update", totalMs: 312.4, share: 0.41, maxMs: 9.1 }], systemsPerSecond: false,
 *   spikes: [{ frame: 4851, cause: "compile", ms: 41.3 }], gcs: [{ frame: 4818, t: 79102, freedMb: 4.2 }],
 *   rates: [{ frame: 4855, from: 120, to: 60, reason: "missed" }],
 *   compiles: [{ frame: 4851, what: "compile", label: "fog.blur", ms: 38.2, boot: false }],
 *   passes: [], chains: [], passesPerSecond: false, nodes: 420, holes: [] };
 * ```
 */
export type PerfRangeSummary = {
  readonly from: number;
  readonly to: number;
  /** Frames of the range the history holds. */
  readonly frames: number;
  /** Page-clock ms from the first frame's start to the last frame's end. */
  readonly durationMs: number;
  /** Per-second summaries inside the range. */
  readonly seconds: number;
  readonly worstMs: number | null;
  /** The range's summed JS ms, the base of every system's share. */
  readonly jsMs: number;
  readonly systems: readonly RangeSystem[];
  /** The systems are prorated from the seconds (no per-frame top 5 in the rows). */
  readonly systemsPerSecond: boolean;
  readonly spikes: readonly {
    readonly frame: number;
    readonly cause: PerfCause;
    readonly ms: number;
  }[];
  readonly gcs: readonly {
    readonly frame: number | null;
    readonly t: number;
    readonly freedMb: number;
  }[];
  readonly rates: readonly {
    readonly frame: number | null;
    readonly from: number;
    readonly to: number;
    readonly reason: RateReason;
  }[];
  readonly compiles: readonly {
    readonly frame: number;
    readonly what: ShaderWhat;
    readonly label: string | null;
    readonly ms: number | null;
    readonly boot: boolean;
  }[];
  readonly passes: readonly RangePass[];
  readonly chains: readonly RangeChain[];
  /** The passes and chains come from the seconds' summaries (no pass rows in the range). */
  readonly passesPerSecond: boolean;
  /** Demand marks summed over the range; null when no row carried them. */
  readonly nodes: number | null;
  /** Hole frames inside the range. */
  readonly holes: readonly number[];
};

/**
 * A string column of a capacity, every cell null.
 *
 * @param capacity - The cells.
 * @returns The column.
 */
function textColumn(capacity: number): (string | null)[] {
  // eslint-disable-next-line unicorn/no-null -- null is "none" in the history's text columns
  return Array.from<string | null>({ length: capacity }).fill(null);
}

/**
 * Allocates an empty history: every column at its full capacity, once (about 2.5 MB). The `append*`
 * functions write into it without allocating.
 *
 * @returns The empty history.
 * @example
 * ```ts
 * const history = createPerfHistory();
 * history.capacity; // 14400
 * history.epoch; // null
 * ```
 */
export function createPerfHistory(): PerfHistory {
  const rows = HISTORY_ROWS;
  const passes = HISTORY_PASS_ROWS;
  return {
    capacity: rows,
    count: 0,
    // eslint-disable-next-line unicorn/no-null -- null: no rows yet, the wire's "no epoch"
    epoch: null,
    version: 0,
    gpuTimer: true,
    frame: new Uint32Array(rows),
    t: new Float64Array(rows),
    ms: new Float32Array(rows),
    jsMs: new Float32Array(rows),
    gpuMs: new Float32Array(rows),
    rateMs: new Float32Array(rows),
    budgetMs: new Float32Array(rows),
    drawn: new Uint8Array(rows),
    rest: new Uint8Array(rows),
    causes: new Uint32Array(rows),
    noise: new Uint8Array(rows),
    draws: new Float32Array(rows),
    sysIdx: new Int16Array(rows * SYSTEMS_PER_FRAME),
    sysMs: new Float32Array(rows * SYSTEMS_PER_FRAME),
    systemNames: [],
    nodes: new Int32Array(rows),
    passCapacity: passes,
    passCount: 0,
    passFrame: new Uint32Array(passes),
    passIndex: new Uint8Array(passes),
    passKind: Array.from<PassKind>({ length: passes }).fill("canvas"),
    passView: textColumn(passes),
    passOwner: new Uint32Array(passes),
    passFilter: textColumn(passes),
    passW: new Uint16Array(passes),
    passH: new Uint16Array(passes),
    passFormat: textColumn(passes),
    passResolution: new Float32Array(passes),
    passDraws: new Float32Array(passes),
    passGpuMs: new Float32Array(passes),
    holes: new Uint32Array(HISTORY_HOLES),
    holeCount: 0,
    events: Array.from<PerfTimelineEvent | undefined>({ length: HISTORY_EVENTS }),
    eventCount: 0,
    eventsNext: undefined,
    seconds: Array.from<PerfPassesWire | undefined>({ length: HISTORY_SECONDS }),
    secondCount: 0
  };
}

/**
 * Throws the "not built" error of a stubbed function: build wave 1 (unit A) replaces each stub.
 *
 * @param name - The function.
 * @throws {Error} `[moku-editor] perf/protocol.<name> is not built yet.\n  It lands in build wave 1.`
 */
function notBuilt(name: string): never {
  throw new Error(
    `[moku-editor] perf/protocol.${name} is not built yet.\n  It lands in build wave 1.`
  );
}

/**
 * Empties the history without reallocating (a source switch): every count to 0, no epoch, the
 * system names forgotten, `version` bumped.
 *
 * @param _history - The history.
 * @throws {Error} Until build wave 1: `[moku-editor] perf/protocol.clearPerfHistory is not built yet.`
 */
export function clearPerfHistory(_history: PerfHistory): void {
  notBuilt("clearPerfHistory");
}

/**
 * Appends a frames wire: a different `epoch` clears first (`reset`); rows with a `frame` at or below the newest
 * kept are skipped (dedup); `hole` or a frame jump records a hole; past capacity or older than
 * HISTORY_MS drops the oldest (`copyWithin`, no allocation); `version` is bumped when rows changed.
 *
 * @param _history - The history.
 * @param _wire - A validated frames wire (`readFramesWire`).
 * @returns What the append did.
 * @throws {Error} Until build wave 1: `[moku-editor] perf/protocol.appendFrames is not built yet.`
 */
export function appendFrames(_history: PerfHistory, _wire: PerfFramesWire): AppendResult {
  return notBuilt("appendFrames");
}

/**
 * Appends an events wire by `seq` (dedup); `lost` records a hole in the events; keeps `next` as the
 * next read's `after`.
 *
 * @param _history - The history.
 * @param _wire - The events wire.
 * @returns The events added.
 * @throws {Error} Until build wave 1: `[moku-editor] perf/protocol.appendEvents is not built yet.`
 */
export function appendEvents(_history: PerfHistory, _wire: PerfEventsWire): number {
  return notBuilt("appendEvents");
}

/**
 * Appends a per-second passes summary by `t` (dedup).
 *
 * @param _history - The history.
 * @param _passes - The `editor.perf.passes` value.
 * @returns True when it was added, false for a second the history has.
 * @throws {Error} Until build wave 1: `[moku-editor] perf/protocol.appendSecond is not built yet.`
 */
export function appendSecond(_history: PerfHistory, _passes: PerfPassesWire): boolean {
  return notBuilt("appendSecond");
}

/**
 * The row indexes of the frames in `[from, to]`.
 *
 * @param _history - The history.
 * @param _from - The first frame of the range.
 * @param _to - The last frame of the range (inclusive).
 * @returns The first and last row; `{ first: -1, last: -1 }` when no frame of the range is held.
 * @throws {Error} Until build wave 1: `[moku-editor] perf/protocol.rangeRows is not built yet.`
 */
export function rangeRows(
  _history: PerfHistory,
  _from: number,
  _to: number
): { readonly first: number; readonly last: number } {
  return notBuilt("rangeRows");
}

/**
 * The summary of a range selection (allocates once per selection; see PerfRangeSummary).
 *
 * @param _history - The history.
 * @param _from - The first frame of the range.
 * @param _to - The last frame of the range (inclusive).
 * @returns The summary.
 * @throws {Error} Until build wave 1: `[moku-editor] perf/protocol.rangeSummary is not built yet.`
 */
export function rangeSummary(_history: PerfHistory, _from: number, _to: number): PerfRangeSummary {
  return notBuilt("rangeSummary");
}

/**
 * @file perf/protocol — the tools page's 2-minute history of one source (spec 03 Delta 2026-10-16
 * D10): frames, pass rows, timeline events, per-second pass summaries and samples of the last
 * HISTORY_MS, struct-of-arrays, allocated once by `createPerfHistory` (about 3 MB: the pass texts are
 * interned as 16-bit ids into one name table) and written without allocating by the `append*`
 * functions; `rangeRows` and `rangeSummary` read a selection. It lives on the tools page, not on the
 * device: the engine ring holds about 8 s, pause and rewind are a view of the tools page, and a
 * disconnect must not lose what was seen. renderView owns one instance (spec 09 § M11) and reads its
 * columns, never writes them. Runtime-free.
 */
import { causeName, spikeCause } from "./causes";
import type { PassKind, PerfCause, PerfSampleLine, RateReason } from "./engine";
import type { PerfFramesWire, PerfPassRowsWire, PerfSystemsWire } from "./frames";
import { SYSTEMS_PER_FRAME } from "./frames";
import type { ChainReader, PerfPassesWire } from "./passes";
import { PASS_KINDS, walkChains } from "./passes";
import type { PerfEventsWire, PerfTimelineEvent, ShaderWhat } from "./timeline";

/** The history's span, ms: owner item 25, "about 2 min". */
export const HISTORY_MS = 120_000;

/** Frame rows held at most: 120 s × 120 fps. */
export const HISTORY_ROWS = 14_400;

/** Pass rows held at most: 4 per frame, like the engine ring. */
export const HISTORY_PASS_ROWS = 57_600;

/** Timeline events held at most: 2 min with room for a shader burst at boot. */
export const HISTORY_EVENTS = 1024;

/** Per-second pass summaries (and samples) held at most: one per second. */
export const HISTORY_SECONDS = 120;

/** Holes (frames or events missing after a frame or a seq) held at most; the oldest drop first. */
export const HISTORY_HOLES = 256;

/**
 * The tools page's history of one source, oldest row at index 0 of every column. Frame columns hold
 * `count` rows, pass columns `passCount`, `events` `eventCount`, `seconds` `secondCount`, `samples`
 * `sampleCount`, `holes` `holeCount`, `eventHoles` `eventHoleCount`. A number that was not measured
 * is NaN in a float column (null on the wire). The pass texts (view, filter, format) are ids into
 * `passNames` (0: none) and the pass kind an index into `PASS_KINDS`, so the pass columns are typed
 * arrays: about 3 MB in all, allocated once. A new `epoch` (a reload) or another source clears it;
 * `version` is bumped on every change, so painters and selections key on it.
 *
 * @example
 * ```ts
 * const history = createPerfHistory();
 * appendFrames(history, framesWire); // the editor.perf.frames answer, checked by readFramesWire
 * history.passNames[history.passView[0] ?? 0]; // "main": the first pass row's view
 * PASS_KINDS[history.passKind[0] ?? 0]; // "canvas"
 * ```
 */
export type PerfHistory = {
  /** Frame rows held at most (HISTORY_ROWS). */
  readonly capacity: number;
  /** Frame rows held. */
  count: number;
  /** The page's clock origin of the rows (the feeds' `epoch`); null before the first rows. */
  epoch: string | null;
  /** Bumped whenever rows, pass rows, events, seconds, samples or holes change. */
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
  /** Cause bits in CAUSE_BITS order (the agent's counted bits; unknown bits dropped). */
  readonly causes: Uint8Array;
  /** Cause bits heard but not counted (`GPU_BIT`: a faint GPU tick). */
  readonly noise: Uint8Array;
  /** Draw calls; NaN: not counted (WebGL, or the feed sent none). */
  readonly draws: Float32Array;
  /** Top 5 systems per row (rows × SYSTEMS_PER_FRAME): indexes into `systemNames`; −1: none. */
  readonly sysIdx: Int16Array;
  /** Their ms (rows × SYSTEMS_PER_FRAME). */
  readonly sysMs: Float32Array;
  /** The source's system names by the index `sysIdx` holds, merged by name from each wire's names. */
  readonly systemNames: string[];
  /** Demand marks per row; −1: not sent (feeds.nodes off). */
  readonly nodes: Int32Array;

  /** Pass rows held at most (HISTORY_PASS_ROWS). */
  readonly passCapacity: number;
  /** Pass rows held, in frame order. */
  passCount: number;
  /** The frame number each pass row belongs to. */
  readonly passFrame: Uint32Array;
  readonly passIndex: Uint8Array;
  /** The pass kind: an index into PASS_KINDS. */
  readonly passKind: Uint8Array;
  /** The view label: an id into `passNames`; 0: none. */
  readonly passView: Uint16Array;
  /** The owner entity; 0: none or not measured. */
  readonly passOwner: Uint32Array;
  /** The filter kind's name: an id into `passNames`; 0: not a filter or not measured. */
  readonly passFilter: Uint16Array;
  readonly passW: Uint16Array;
  readonly passH: Uint16Array;
  /** The target format: an id into `passNames`; 0: not measured. */
  readonly passFormat: Uint16Array;
  /** NaN: not measured. */
  readonly passResolution: Float32Array;
  /** NaN: not counted. */
  readonly passDraws: Float32Array;
  /** NaN: not measured. */
  readonly passGpuMs: Float32Array;
  /**
   * The pass texts by id: index 0 is null ("none"). Grows with each new name; when its 65 536 ids are
   * used up, the names no held pass row uses are dropped and the ids renumbered (a long session).
   */
  readonly passNames: (string | null)[];

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
  /** Seqs after which the agent's ring overwrote events before they were read (`lost`), oldest first. */
  readonly eventHoles: Uint32Array;
  /** Event holes held. */
  eventHoleCount: number;

  /** Per-second pass summaries (`editor.perf.passes`), oldest first. */
  readonly seconds: (PerfPassesWire | undefined)[];
  /** Summaries held. */
  secondCount: number;
  /**
   * The source's per-second samples (`editor.perf.second`'s `sample`), oldest first: the per-second
   * systems a range falls back on when its rows carry no top 5 (an engine without `systemNames`).
   */
  readonly samples: (PerfSampleLine | undefined)[];
  /** Samples held. */
  sampleCount: number;

  /** The index of each name of `systemNames` (the interning table). */
  readonly systemIds: Map<string, number>;
  /** The id of each name of `passNames` (the interning table). */
  readonly passNameIds: Map<string, number>;
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

/** Ids of the pass name table: a Uint16 column holds 0 to 65 535. */
const PASS_NAME_IDS = 65_536;

/** Names of the system table: an Int16 column holds indexes to 32 767. */
const SYSTEM_NAME_IDS = 32_768;

/** The pass texts one pass row may add to the name table: view, filter, format. */
const PASS_TEXTS = 3;

/** The cause bits the editor knows (seven, CAUSE_BITS): every other bit of a wire value is dropped. */
const KNOWN_CAUSES = 0x7f;

/** The span of one per-second summary, ms. */
const SECOND_MS = 1000;

/** Rounding: durations to 0.1 ms, ms to 0.01, shares to 0.001. */
const TIME_SCALE = 10;
const MS_SCALE = 100;
const SHARE_SCALE = 1000;

/** The byte of a filter pass in `passKind`. */
const FILTER_KIND = PASS_KINDS.indexOf("filter");

/** A pass key's room for a view id (kind × 65 536 + view). */
const KIND_STRIDE = 65_536;

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
 * A number rounded to `scale` steps.
 *
 * @param value - The number.
 * @param scale - Steps per unit (100: 0.01).
 * @returns The rounded number.
 * @example
 * ```ts
 * roundTo(306.699_996_9, 100); // 306.7
 * ```
 */
function roundTo(value: number, scale: number): number {
  return Math.round(value * scale) / scale;
}

/**
 * Allocates an empty history: every column at its full capacity, once (about 3 MB). The `append*`
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
    causes: new Uint8Array(rows),
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
    passKind: new Uint8Array(passes),
    passView: new Uint16Array(passes),
    passOwner: new Uint32Array(passes),
    passFilter: new Uint16Array(passes),
    passW: new Uint16Array(passes),
    passH: new Uint16Array(passes),
    passFormat: new Uint16Array(passes),
    passResolution: new Float32Array(passes),
    passDraws: new Float32Array(passes),
    passGpuMs: new Float32Array(passes),
    passNames: textColumn(1),
    holes: new Uint32Array(HISTORY_HOLES),
    holeCount: 0,
    events: Array.from<PerfTimelineEvent | undefined>({ length: HISTORY_EVENTS }),
    eventCount: 0,
    eventsNext: undefined,
    eventHoles: new Uint32Array(HISTORY_HOLES),
    eventHoleCount: 0,
    seconds: Array.from<PerfPassesWire | undefined>({ length: HISTORY_SECONDS }),
    secondCount: 0,
    samples: Array.from<PerfSampleLine | undefined>({ length: HISTORY_SECONDS }),
    sampleCount: 0,
    systemIds: new Map(),
    passNameIds: new Map()
  };
}

/**
 * Empties the history without reallocating (a source switch, a reload): every count to 0, no
 * epoch, the system and pass names forgotten, the kept events, seconds and samples released,
 * `version` bumped.
 *
 * @param history - The history.
 * @example
 * ```ts
 * clearPerfHistory(history);
 * history.count; // 0, the same 14 400-row columns kept
 * ```
 */
export function clearPerfHistory(history: PerfHistory): void {
  shiftList(history.events, history.eventCount, history.eventCount);
  shiftList(history.seconds, history.secondCount, history.secondCount);
  shiftList(history.samples, history.sampleCount, history.sampleCount);
  history.count = 0;
  history.passCount = 0;
  history.holeCount = 0;
  history.eventCount = 0;
  history.eventHoleCount = 0;
  history.secondCount = 0;
  history.sampleCount = 0;
  // eslint-disable-next-line unicorn/no-null -- null: no page yet
  history.epoch = null;
  history.eventsNext = undefined;
  history.gpuTimer = true;
  history.systemNames.length = 0;
  history.systemIds.clear();
  history.passNames.length = 1;
  history.passNameIds.clear();
  history.version += 1;
}

/**
 * Takes the epoch of a feed answer: a different epoch than the history's is a new page, so the
 * history is cleared first. A null epoch (an agent before its header) changes nothing.
 *
 * @param history - The history.
 * @param epoch - The answer's epoch.
 * @returns Whether the history was cleared.
 * @example
 * ```ts
 * adoptEpoch(history, "1792000099999.5"); // true after frames of "1792000000000.5"
 * ```
 */
function adoptEpoch(history: PerfHistory, epoch: string | null): boolean {
  if (epoch === null) return false;
  const reset = history.epoch !== null && history.epoch !== epoch;
  if (reset) clearPerfHistory(history);
  history.epoch = epoch;
  return reset;
}

/**
 * The index of a system name in `systemNames`, added when new; −1 once the table holds 32 768 names
 * (the systems a game registers never come near it).
 *
 * @param history - The history.
 * @param name - The system's name.
 * @returns Its index, or −1.
 * @example
 * ```ts
 * systemId(history, "ward.update"); // 0 in a fresh history
 * ```
 */
function systemId(history: PerfHistory, name: string): number {
  const known = history.systemIds.get(name);
  if (known !== undefined) return known;
  const id = history.systemNames.length;
  if (id >= SYSTEM_NAME_IDS) return -1;
  history.systemNames.push(name);
  history.systemIds.set(name, id);
  return id;
}

/**
 * The id of a pass text in `passNames`, added when new; 0 for null (none), and 0 when every id is
 * used by a held row (more distinct texts than ids, never reached by real labels).
 *
 * @param history - The history.
 * @param text - The view, filter or format.
 * @returns Its id.
 * @example
 * ```ts
 * passNameId(history, "fogLayer"); // 1 in a fresh history
 * ```
 */
function passNameId(history: PerfHistory, text: string | null | undefined): number {
  if (text === null || text === undefined) return 0;
  const known = history.passNameIds.get(text);
  if (known !== undefined) return known;
  const id = history.passNames.length;
  if (id >= PASS_NAME_IDS) return 0;
  history.passNames.push(text);
  history.passNameIds.set(text, id);
  return id;
}

/**
 * Drops the pass names no held pass row uses and renumbers the rest in their order, rewriting the
 * three text columns: a long session with changing labels never runs out of ids. Rare (when the
 * table is full); allocates its two tables then.
 *
 * @param history - The history.
 * @example
 * ```ts
 * compactPassNames(history); // passNames back to the names of the 57 600 held rows at most
 * ```
 */
function compactPassNames(history: PerfHistory): void {
  const { passNames, passNameIds, passView, passFilter, passFormat, passCount } = history;
  const used = new Uint8Array(PASS_NAME_IDS);
  for (let pass = 0; pass < passCount; pass += 1) {
    used[passView[pass] ?? 0] = 1;
    used[passFilter[pass] ?? 0] = 1;
    used[passFormat[pass] ?? 0] = 1;
  }
  const renumbered = new Uint16Array(PASS_NAME_IDS);
  passNameIds.clear();
  let next = 1;
  for (let id = 1; id < passNames.length; id += 1) {
    const name = passNames[id];
    if (used[id] !== 1 || name === null || name === undefined) continue;
    passNames[next] = name;
    passNameIds.set(name, next);
    renumbered[id] = next;
    next += 1;
  }
  passNames.length = next;
  for (let pass = 0; pass < passCount; pass += 1) {
    passView[pass] = renumbered[passView[pass] ?? 0] ?? 0;
    passFilter[pass] = renumbered[passFilter[pass] ?? 0] ?? 0;
    passFormat[pass] = renumbered[passFormat[pass] ?? 0] ?? 0;
  }
}

/**
 * The first index of an ascending column whose value is at least `value` (`count` when none).
 *
 * @param column - The column, ascending over its first `count` cells.
 * @param count - Cells in use.
 * @param value - The value looked for.
 * @returns The index.
 * @example
 * ```ts
 * lowerBound(Uint32Array.of(100, 101, 110), 3, 105); // 2
 * ```
 */
function lowerBound(column: ArrayLike<number>, count: number, value: number): number {
  let low = 0;
  let high = count;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((column[middle] ?? 0) < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * Drops the first `drop` items of a list of `count`, releasing the freed cells.
 *
 * @param list - The list, oldest first.
 * @param count - Items in use.
 * @param drop - Items to drop from the start.
 * @returns The items left.
 * @example
 * ```ts
 * shiftList(history.seconds, 120, 1); // 119: the oldest second gone
 * ```
 */
function shiftList<Item>(list: (Item | undefined)[], count: number, drop: number): number {
  if (drop <= 0) return count;
  list.copyWithin(0, drop, count);
  list.fill(undefined, count - drop, count);
  return count - drop;
}

/**
 * Drops the first `drop` values of a ring of numbers held at the start of a typed array.
 *
 * @param values - The values, oldest first.
 * @param count - Values in use.
 * @param drop - Values to drop.
 * @returns The values left.
 * @example
 * ```ts
 * shiftValues(history.holes, 256, 1); // 255
 * ```
 */
function shiftValues(values: Uint32Array, count: number, drop: number): number {
  if (drop <= 0) return count;
  values.copyWithin(0, drop, count);
  return count - drop;
}

/**
 * Appends a value to a ring of `HISTORY_HOLES` numbers, dropping the oldest when full.
 *
 * @param values - The ring.
 * @param count - Values in use.
 * @param value - The new value.
 * @returns The values held.
 * @example
 * ```ts
 * history.holeCount = pushValue(history.holes, history.holeCount, 102);
 * ```
 */
function pushValue(values: Uint32Array, count: number, value: number): number {
  const kept = shiftValues(values, count, count + 1 - values.length);
  values[kept] = value;
  return kept + 1;
}

/**
 * Moves the frame rows left by `drop` (the oldest out), every frame column and the systems.
 *
 * @param history - The history.
 * @param drop - Rows to drop, at most `count`.
 */
function shiftFrameRows(history: PerfHistory, drop: number): void {
  const { count } = history;
  history.frame.copyWithin(0, drop, count);
  history.t.copyWithin(0, drop, count);
  history.ms.copyWithin(0, drop, count);
  history.jsMs.copyWithin(0, drop, count);
  history.gpuMs.copyWithin(0, drop, count);
  history.rateMs.copyWithin(0, drop, count);
  history.budgetMs.copyWithin(0, drop, count);
  history.drawn.copyWithin(0, drop, count);
  history.rest.copyWithin(0, drop, count);
  history.causes.copyWithin(0, drop, count);
  history.noise.copyWithin(0, drop, count);
  history.draws.copyWithin(0, drop, count);
  history.nodes.copyWithin(0, drop, count);
  history.sysIdx.copyWithin(0, drop * SYSTEMS_PER_FRAME, count * SYSTEMS_PER_FRAME);
  history.sysMs.copyWithin(0, drop * SYSTEMS_PER_FRAME, count * SYSTEMS_PER_FRAME);
  history.count = count - drop;
}

/**
 * Moves the pass rows left by `drop` (the oldest out).
 *
 * @param history - The history.
 * @param drop - Pass rows to drop.
 */
function shiftPassRows(history: PerfHistory, drop: number): void {
  if (drop <= 0) return;
  const count = history.passCount;
  history.passFrame.copyWithin(0, drop, count);
  history.passIndex.copyWithin(0, drop, count);
  history.passKind.copyWithin(0, drop, count);
  history.passView.copyWithin(0, drop, count);
  history.passOwner.copyWithin(0, drop, count);
  history.passFilter.copyWithin(0, drop, count);
  history.passW.copyWithin(0, drop, count);
  history.passH.copyWithin(0, drop, count);
  history.passFormat.copyWithin(0, drop, count);
  history.passResolution.copyWithin(0, drop, count);
  history.passDraws.copyWithin(0, drop, count);
  history.passGpuMs.copyWithin(0, drop, count);
  history.passCount = count - drop;
}

/**
 * Drops the oldest `rows` frame rows, the pass rows of the frames dropped and the holes before the
 * new first frame (`copyWithin`, no allocation).
 *
 * @param history - The history.
 * @param rows - Rows to drop.
 */
function dropFrames(history: PerfHistory, rows: number): void {
  const drop = Math.min(rows, history.count);
  if (drop <= 0) return;
  shiftFrameRows(history, drop);
  const first = history.count > 0 ? (history.frame[0] ?? 0) : Number.POSITIVE_INFINITY;
  shiftPassRows(history, lowerBound(history.passFrame, history.passCount, first));
  const holes = lowerBound(history.holes, history.holeCount, first);
  history.holeCount = shiftValues(history.holes, history.holeCount, holes);
}

/**
 * The page-clock time before which rows are older than HISTORY_MS once the wire is in: the newest
 * start of the held rows and the wire's last row, less HISTORY_MS.
 *
 * @param history - The history.
 * @param wire - The frames wire.
 * @returns The cut, ms; −Infinity with no rows at all.
 */
function cutOf(history: PerfHistory, wire: PerfFramesWire): number {
  const last = wire.frame.length - 1;
  const wireT = last >= 0 ? wire.t0 + (wire.t[last] ?? 0) : Number.NEGATIVE_INFINITY;
  const heldT = history.t[history.count - 1] ?? Number.NEGATIVE_INFINITY;
  return Math.max(wireT, history.count > 0 ? heldT : Number.NEGATIVE_INFINITY) - HISTORY_MS;
}

/**
 * Whether a wire row is new: its frame above the newest taken so far and its start not older than
 * the cut.
 *
 * @param wire - The frames wire.
 * @param from - The wire row.
 * @param newest - The newest frame held or taken.
 * @param cut - The oldest start kept, ms.
 * @returns Whether to take it.
 */
function isFresh(wire: PerfFramesWire, from: number, newest: number, cut: number): boolean {
  return (wire.frame[from] ?? -1) > newest && wire.t0 + (wire.t[from] ?? 0) >= cut;
}

/**
 * The wire rows `appendFrames` would take: frames above the newest held (and above every row taken
 * before it in the wire), not older than the cut.
 *
 * @param wire - The frames wire.
 * @param newest - The newest frame held; −1 when empty.
 * @param cut - The oldest start kept, ms.
 * @returns The count.
 */
function freshRows(wire: PerfFramesWire, newest: number, cut: number): number {
  let taken = 0;
  let running = newest;
  for (let from = 0; from < wire.frame.length; from += 1) {
    if (!isFresh(wire, from, running, cut)) continue;
    running = wire.frame[from] ?? running;
    taken += 1;
  }
  return taken;
}

/**
 * Records a hole before a new frame when the wire said frames were lost or the frame jumps past
 * the newest held one.
 *
 * @param history - The history.
 * @param frame - The new frame.
 * @param flagged - The wire's `hole`, for its first new row.
 * @returns Whether a hole was recorded.
 */
function noteHole(history: PerfHistory, frame: number, flagged: boolean): boolean {
  if (history.count === 0) return false;
  const last = history.frame[history.count - 1] ?? 0;
  if (!flagged && frame <= last + 1) return false;
  history.holeCount = pushValue(history.holes, history.holeCount, last);
  return true;
}

/**
 * Writes the top 5 systems of a wire row into a history row: each index moved to the history's
 * own name table by name; −1 and 0 ms without the block.
 *
 * @param history - The history.
 * @param systems - The wire's systems block, or undefined.
 * @param from - The wire row.
 * @param row - The history row.
 */
function writeSystems(
  history: PerfHistory,
  systems: PerfSystemsWire | undefined,
  from: number,
  row: number
): void {
  const base = row * SYSTEMS_PER_FRAME;
  for (let slot = 0; slot < SYSTEMS_PER_FRAME; slot += 1) {
    const cell = from * SYSTEMS_PER_FRAME + slot;
    const index = systems?.idx[cell] ?? -1;
    const name = index >= 0 ? systems?.names[index] : undefined;
    history.sysIdx[base + slot] = name === undefined ? -1 : systemId(history, name);
    history.sysMs[base + slot] = name === undefined ? 0 : (systems?.ms[cell] ?? 0);
  }
}

/**
 * Writes one wire row into a history row: `t` back to page-clock ms, a null GPU time or draw count
 * as NaN, unknown cause bits dropped, −1 nodes without the column, the systems by name.
 *
 * @param history - The history.
 * @param wire - The frames wire.
 * @param from - The wire row.
 * @param row - The history row.
 */
function writeRow(history: PerfHistory, wire: PerfFramesWire, from: number, row: number): void {
  const gpu = wire.gpuMs[from];
  const draws = wire.draws?.[from];
  history.frame[row] = wire.frame[from] ?? 0;
  history.t[row] = wire.t0 + (wire.t[from] ?? 0);
  history.ms[row] = wire.ms[from] ?? 0;
  history.jsMs[row] = wire.jsMs[from] ?? 0;
  history.gpuMs[row] = typeof gpu === "number" ? gpu : Number.NaN;
  history.rateMs[row] = wire.rateMs[from] ?? 0;
  history.budgetMs[row] = wire.budgetMs[from] ?? 0;
  history.drawn[row] = wire.drawn[from] ?? 0;
  history.rest[row] = wire.rest[from] ?? 0;
  history.causes[row] = (wire.causes[from] ?? 0) & KNOWN_CAUSES;
  history.noise[row] = (wire.noise[from] ?? 0) & KNOWN_CAUSES;
  history.draws[row] = typeof draws === "number" ? draws : Number.NaN;
  history.nodes[row] = wire.nodes?.[from] ?? -1;
  writeSystems(history, wire.systems, from, row);
}

/**
 * Writes one wire pass row into a history pass row: kind as its PASS_KINDS byte, texts as name ids,
 * a null owner as 0, null measures as NaN.
 *
 * @param history - The history.
 * @param passes - The wire's pass rows.
 * @param from - The wire pass row.
 * @param frame - Its frame number.
 */
function writePass(
  history: PerfHistory,
  passes: PerfPassRowsWire,
  from: number,
  frame: number
): void {
  if (history.passNames.length + PASS_TEXTS > PASS_NAME_IDS) compactPassNames(history);
  const at = history.passCount;
  history.passFrame[at] = frame;
  history.passIndex[at] = passes.index[from] ?? 0;
  history.passKind[at] = Math.max(0, PASS_KINDS.indexOf(passes.kind[from] ?? "canvas"));
  history.passView[at] = passNameId(history, passes.view[from]);
  history.passOwner[at] = passes.owner[from] ?? 0;
  history.passFilter[at] = passNameId(history, passes.filter[from]);
  history.passW[at] = passes.w[from] ?? 0;
  history.passH[at] = passes.h[from] ?? 0;
  history.passFormat[at] = passNameId(history, passes.format[from]);
  history.passResolution[at] = passes.resolution[from] ?? Number.NaN;
  history.passDraws[at] = passes.draws[from] ?? Number.NaN;
  history.passGpuMs[at] = passes.gpuMs[from] ?? Number.NaN;
  history.passCount = at + 1;
}

/**
 * The frame number of a wire pass row (−1 for a row outside the wire).
 *
 * @param wire - The frames wire.
 * @param passes - Its pass rows.
 * @param pass - The pass row.
 * @returns The frame.
 */
function passFrameOf(wire: PerfFramesWire, passes: PerfPassRowsWire, pass: number): number {
  return wire.frame[passes.row[pass] ?? -1] ?? -1;
}

/**
 * Appends the wire's pass rows of the frames just added (rows `start` to the end): past the pass
 * capacity the oldest pass rows drop.
 *
 * @param history - The history.
 * @param wire - The frames wire.
 * @param start - The first history row this append wrote.
 */
function appendPassRows(history: PerfHistory, wire: PerfFramesWire, start: number): void {
  const { passes } = wire;
  if (passes === undefined || history.count === start) return;
  const first = history.frame[start] ?? 0;
  const last = history.frame[history.count - 1] ?? 0;
  let taken = 0;
  for (let pass = 0; pass < passes.row.length; pass += 1) {
    const frame = passFrameOf(wire, passes, pass);
    if (frame >= first && frame <= last) taken += 1;
  }
  const added = Math.min(taken, history.passCapacity);
  shiftPassRows(history, history.passCount + added - history.passCapacity);
  let skip = taken - added;
  for (let pass = 0; pass < passes.row.length; pass += 1) {
    const frame = passFrameOf(wire, passes, pass);
    if (frame < first || frame > last) continue;
    if (skip > 0) skip -= 1;
    else writePass(history, passes, pass, frame);
  }
}

/** A timeline event or a passes summary: an item with a page-clock time. */
type Timed = { readonly t: number };

/**
 * The page-clock time of a timeline event or a passes summary.
 *
 * @param item - The event or summary.
 * @returns Its `t`.
 */
function timeOfItem(item: Timed): number {
  return item.t;
}

/**
 * The newest frame of a sample.
 *
 * @param sample - The sample.
 * @returns Its `frame`.
 */
function frameOfSample(sample: PerfSampleLine): number {
  return sample.frame;
}

/**
 * The items at the start of a list whose key is below `limit`.
 *
 * @param list - The list, oldest first.
 * @param count - Items in use.
 * @param keyOf - The item's key (a time or a frame).
 * @param limit - The first key kept.
 * @returns The items to drop.
 */
function leadingBelow<Item>(
  list: readonly (Item | undefined)[],
  count: number,
  keyOf: (item: Item) => number,
  limit: number
): number {
  let index = 0;
  for (; index < count; index += 1) {
    const item = list[index];
    if (item === undefined || keyOf(item) >= limit) break;
  }
  return index;
}

/**
 * Keeps the events, seconds and samples inside the rows' two minutes: events and seconds older than
 * the newest frame less HISTORY_MS, samples of frames before the first row, and event holes before
 * the first event drop.
 *
 * @param history - The history.
 */
function trimSide(history: PerfHistory): void {
  if (history.count > 0) {
    const cut = (history.t[history.count - 1] ?? 0) - HISTORY_MS;
    const first = history.frame[0] ?? 0;
    const { events, seconds, samples } = history;
    const oldEvents = leadingBelow(events, history.eventCount, timeOfItem, cut);
    history.eventCount = shiftList(events, history.eventCount, oldEvents);
    const oldSeconds = leadingBelow(seconds, history.secondCount, timeOfItem, cut);
    history.secondCount = shiftList(seconds, history.secondCount, oldSeconds);
    const oldSamples = leadingBelow(samples, history.sampleCount, frameOfSample, first);
    history.sampleCount = shiftList(samples, history.sampleCount, oldSamples);
  }
  const firstSeq =
    history.eventCount > 0 ? (history.events[0]?.seq ?? 0) : Number.POSITIVE_INFINITY;
  const oldHoles = lowerBound(history.eventHoles, history.eventHoleCount, firstSeq);
  history.eventHoleCount = shiftValues(history.eventHoles, history.eventHoleCount, oldHoles);
}

/**
 * Appends a frames wire (D10): a different `epoch` clears first (`reset`); rows with a `frame` at or
 * below the newest kept are skipped (dedup); `hole` or a frame jump records a hole after the newest
 * held frame; past capacity or older than HISTORY_MS the oldest rows drop with their pass rows
 * (`copyWithin`, no allocation); the pass rows of the new frames follow; `version` is bumped when
 * rows changed. Allocates nothing per row: names are interned once.
 *
 * @param history - The history.
 * @param wire - A checked frames wire (`readFramesWire`).
 * @returns What the append did.
 * @example
 * ```ts
 * appendFrames(history, framesWire); // { added: 120, hole: false, reset: false } at 120 fps, once a second
 * ```
 */
export function appendFrames(history: PerfHistory, wire: PerfFramesWire): AppendResult {
  const reset = adoptEpoch(history, wire.epoch);
  history.gpuTimer = wire.gpuTimer;
  const newest = history.count > 0 ? (history.frame[history.count - 1] ?? -1) : -1;
  const cut = cutOf(history, wire);
  const fresh = freshRows(wire, newest, cut);
  const added = Math.min(fresh, history.capacity);
  if (added === 0) return { added, hole: false, reset };

  // Room: the oldest rows past capacity or past two minutes go first.
  const old = lowerBound(history.t, history.count, cut);
  dropFrames(history, Math.max(history.count + added - history.capacity, old));

  // The new rows, the oldest of a wire larger than the capacity skipped.
  const start = history.count;
  let skip = fresh - added;
  let running = newest;
  let flagged = wire.hole;
  let hole = false;
  for (let from = 0; from < wire.frame.length; from += 1) {
    if (!isFresh(wire, from, running, cut)) continue;
    running = wire.frame[from] ?? running;
    if (skip > 0) {
      skip -= 1;
      continue;
    }
    hole = noteHole(history, running, flagged) || hole;
    flagged = false;
    writeRow(history, wire, from, history.count);
    history.count += 1;
  }

  appendPassRows(history, wire, start);
  trimSide(history);
  history.version += 1;
  return { added, hole, reset };
}

/**
 * The newest seq the history has seen: its newest event's, or the one before the last answer's
 * `next`; −1 before any.
 *
 * @param history - The history.
 * @returns The seq.
 */
function seenSeq(history: PerfHistory): number {
  const newest = history.events[history.eventCount - 1]?.seq ?? -1;
  return Math.max(newest, (history.eventsNext ?? 0) - 1);
}

/**
 * The events of a wire with a seq above `seen`, in order.
 *
 * @param items - The wire's events, oldest first.
 * @param seen - The newest seq seen.
 * @returns The count.
 */
function freshEvents(items: readonly PerfTimelineEvent[], seen: number): number {
  let taken = 0;
  let running = seen;
  for (const item of items) {
    if (item.seq <= running) continue;
    running = item.seq;
    taken += 1;
  }
  return taken;
}

/**
 * Appends an events wire by `seq` (D10): a different epoch clears first; events at or below the
 * newest seq seen are skipped (dedup); `lost` records a hole after the newest held event; past
 * HISTORY_EVENTS the oldest drop; `next` is kept as the next read's `after`.
 *
 * @param history - The history.
 * @param wire - The events wire.
 * @returns The events added.
 * @example
 * ```ts
 * appendEvents(history, eventsWire); // 2: a GC and a rate change since the last read
 * history.eventsNext; // the `after` of the next editor.perf.events read
 * ```
 */
export function appendEvents(history: PerfHistory, wire: PerfEventsWire): number {
  adoptEpoch(history, wire.epoch);
  const seen = seenSeq(history);
  const newest = history.events[history.eventCount - 1];
  const hole = wire.lost && newest !== undefined;
  if (hole) {
    history.eventHoleCount = pushValue(history.eventHoles, history.eventHoleCount, newest.seq);
  }

  const fresh = freshEvents(wire.items, seen);
  const added = Math.min(fresh, HISTORY_EVENTS);
  const drop = history.eventCount + added - HISTORY_EVENTS;
  history.eventCount = shiftList(history.events, history.eventCount, drop);
  let skip = fresh - added;
  let running = seen;
  for (const item of wire.items) {
    if (item.seq <= running) continue;
    running = item.seq;
    if (skip > 0) {
      skip -= 1;
      continue;
    }
    history.events[history.eventCount] = item;
    history.eventCount += 1;
  }

  history.eventsNext = wire.next;
  trimSide(history);
  if (added > 0 || hole) history.version += 1;
  return added;
}

/**
 * Appends a per-second passes summary by `t` (dedup): a summary at or before the newest held is
 * skipped; past HISTORY_SECONDS the oldest drops.
 *
 * @param history - The history.
 * @param passes - The `editor.perf.passes` value.
 * @returns True when it was added, false for a second the history has.
 * @example
 * ```ts
 * appendSecond(history, passes); // true once per second, false for the same watched value again
 * ```
 */
export function appendSecond(history: PerfHistory, passes: PerfPassesWire): boolean {
  const newest = history.seconds[history.secondCount - 1];
  if (newest !== undefined && passes.t <= newest.t) return false;
  const full = history.secondCount === HISTORY_SECONDS ? 1 : 0;
  history.secondCount = shiftList(history.seconds, history.secondCount, full);
  history.seconds[history.secondCount] = passes;
  history.secondCount += 1;
  trimSide(history);
  history.version += 1;
  return true;
}

/**
 * Appends a per-second sample (`editor.perf.second`'s `sample`) by its frame (dedup): the source of
 * the per-second systems a range falls back on (an engine without `systemNames`). A sample at or
 * before the newest held frame is skipped; past HISTORY_SECONDS the oldest drops.
 *
 * @param history - The history.
 * @param sample - The sample line.
 * @returns True when it was added, false for a sample the history has.
 * @example
 * ```ts
 * if (second.sample !== null) appendSample(history, second.sample); // true once per second
 * ```
 */
export function appendSample(history: PerfHistory, sample: PerfSampleLine): boolean {
  const newest = history.samples[history.sampleCount - 1];
  if (newest !== undefined && sample.frame <= newest.frame) return false;
  const full = history.sampleCount === HISTORY_SECONDS ? 1 : 0;
  history.sampleCount = shiftList(history.samples, history.sampleCount, full);
  history.samples[history.sampleCount] = sample;
  history.sampleCount += 1;
  trimSide(history);
  history.version += 1;
  return true;
}

/**
 * The row indexes of the held frames in `[from, to]` (either way round).
 *
 * @param history - The history.
 * @param from - The first frame of the range.
 * @param to - The last frame of the range (inclusive).
 * @returns The first and last row; `{ first: -1, last: -1 }` when no frame of the range is held.
 * @example
 * ```ts
 * rangeRows(history, 4810, 4860); // { first: 10, last: 58 } with frames 4841 and 4842 missing
 * ```
 */
export function rangeRows(
  history: PerfHistory,
  from: number,
  to: number
): { readonly first: number; readonly last: number } {
  const first = lowerBound(history.frame, history.count, Math.min(from, to));
  const last = lowerBound(history.frame, history.count, Math.max(from, to) + 1) - 1;
  return first > last ? { first: -1, last: -1 } : { first, last };
}

/** Page-clock ms of a range's held rows: the first frame's start, the last frame's end. */
type Span = { readonly start: number; readonly end: number };

/** What a range's rows sum to. */
type RowTotals = {
  readonly worstMs: number | null;
  readonly jsMs: number;
  readonly nodes: number | null;
  readonly spikes: PerfRangeSummary["spikes"];
};

/** A system's sum over a range. */
type SystemSum = { total: number; max: number };

/** A pass kind and view's sum over a range. */
type PassSum = {
  readonly kind: number;
  readonly view: number;
  count: number;
  gpu: number;
  measured: boolean;
};

/** A filter chain's sum over a range. */
type ChainTotal = {
  readonly owner: number | null;
  readonly view: string | null;
  readonly kinds: readonly string[];
  applies: number;
  gpu: number;
  measured: boolean;
};

/**
 * The time span of rows `first`..`last`; undefined without rows.
 *
 * @param history - The history.
 * @param first - The first row, −1 for none.
 * @param last - The last row.
 * @returns The span.
 */
function spanOf(history: PerfHistory, first: number, last: number): Span | undefined {
  if (first < 0) return undefined;
  return {
    start: history.t[first] ?? 0,
    end: (history.t[last] ?? 0) + (history.ms[last] ?? 0)
  };
}

/**
 * The worst frame, the summed JS, the demand marks and the spikes of rows `first`..`last` (a spike:
 * a row the editor's rule calls one, with its primary cause).
 *
 * @param history - The history.
 * @param first - The first row, −1 for none.
 * @param last - The last row.
 * @returns The totals.
 */
function rowTotals(history: PerfHistory, first: number, last: number): RowTotals {
  const spikes: { frame: number; cause: PerfCause; ms: number }[] = [];
  let worst = Number.NEGATIVE_INFINITY;
  let js = 0;
  let nodes = 0;
  let marked = false;
  for (let row = Math.max(first, 0); first >= 0 && row <= last; row += 1) {
    const ms = history.ms[row] ?? 0;
    const marks = history.nodes[row] ?? -1;
    const cause = causeName(spikeCause(history.causes[row] ?? 0, history.rest[row] ?? 0));
    worst = Math.max(worst, ms);
    js += history.jsMs[row] ?? 0;
    if (marks >= 0) {
      nodes += marks;
      marked = true;
    }
    if (cause !== undefined) {
      spikes.push({ frame: history.frame[row] ?? 0, cause, ms: roundTo(ms, MS_SCALE) });
    }
  }
  // eslint-disable-next-line unicorn/no-null -- null is "no frame held" / "no row carried marks"
  const none = null;
  return {
    worstMs: first < 0 ? none : roundTo(worst, MS_SCALE),
    jsMs: roundTo(js, MS_SCALE),
    nodes: marked ? nodes : none,
    spikes
  };
}

/**
 * One system of a range: total and max to 0.01 ms, its share of the range's JS to 0.001.
 *
 * @param name - The system.
 * @param sum - Its total and max.
 * @param jsMs - The range's summed JS.
 * @returns The range system.
 */
function rangeSystem(name: string, sum: SystemSum, jsMs: number): RangeSystem {
  return {
    name,
    totalMs: roundTo(sum.total, MS_SCALE),
    share: jsMs > 0 ? roundTo(sum.total / jsMs, SHARE_SCALE) : 0,
    maxMs: roundTo(sum.max, MS_SCALE)
  };
}

/**
 * The systems of a range from the per-frame top 5 of its rows, the largest total first; undefined
 * when no row carries one.
 *
 * @param history - The history.
 * @param first - The first row, −1 for none.
 * @param last - The last row.
 * @param jsMs - The range's summed JS.
 * @returns The systems, or undefined.
 */
function frameSystems(
  history: PerfHistory,
  first: number,
  last: number,
  jsMs: number
): RangeSystem[] | undefined {
  const sums = new Map<number, SystemSum>();
  const end = first < 0 ? 0 : (last + 1) * SYSTEMS_PER_FRAME;
  for (let cell = Math.max(first, 0) * SYSTEMS_PER_FRAME; cell < end; cell += 1) {
    const index = history.sysIdx[cell] ?? -1;
    if (index < 0) continue;
    const ms = history.sysMs[cell] ?? 0;
    const sum = sums.get(index) ?? { total: 0, max: 0 };
    sum.total += ms;
    sum.max = Math.max(sum.max, ms);
    sums.set(index, sum);
  }
  if (sums.size === 0) return undefined;
  return [...sums]
    .map(([index, sum]) => rangeSystem(history.systemNames[index] ?? "", sum, jsMs))
    .toSorted((one, other) => other.totalMs - one.totalMs);
}

/**
 * The systems of the frames `low`..`high` prorated from the samples' per-second systems (a sample
 * covers its `frames` frames up to its `frame`: mean × the frames of it inside the range), the
 * largest total first; undefined when no sample with systems overlaps.
 *
 * @param history - The history.
 * @param low - The first held frame of the range.
 * @param high - The last held frame of the range.
 * @param jsMs - The range's summed JS.
 * @returns The systems, or undefined.
 */
function secondSystems(
  history: PerfHistory,
  low: number,
  high: number,
  jsMs: number
): RangeSystem[] | undefined {
  const sums = new Map<string, SystemSum>();
  for (let index = 0; index < history.sampleCount; index += 1) {
    const sample = history.samples[index];
    if (sample?.systems === null || sample?.systems === undefined) continue;
    const overlap =
      Math.min(sample.frame, high) - Math.max(sample.frame - sample.frames + 1, low) + 1;
    if (overlap <= 0) continue;
    for (const system of sample.systems) {
      const sum = sums.get(system.name) ?? { total: 0, max: 0 };
      sum.total += system.mean * overlap;
      sum.max = Math.max(sum.max, system.max);
      sums.set(system.name, sum);
    }
  }
  if (sums.size === 0) return undefined;
  return [...sums]
    .map(([name, sum]) => rangeSystem(name, sum, jsMs))
    .toSorted((one, other) => other.totalMs - one.totalMs);
}

/**
 * Whether a timeline event lies in a range: its frame inside `[low, high]`, or for an event between
 * frames its time inside the rows' span.
 *
 * @param event - The event.
 * @param low - The first frame.
 * @param high - The last frame.
 * @param span - The rows' span; undefined without rows.
 * @returns Whether it is in the range.
 */
function isInRange(
  event: PerfTimelineEvent,
  low: number,
  high: number,
  span: Span | undefined
): boolean {
  if (event.frame !== null) return event.frame >= low && event.frame <= high;
  return span !== undefined && event.t >= span.start && event.t <= span.end;
}

/**
 * The GCs, rate changes and shader compiles of a range, in event order.
 *
 * @param history - The history.
 * @param low - The first frame.
 * @param high - The last frame.
 * @param span - The rows' span; undefined without rows.
 * @returns The three lists.
 */
function rangeEvents(
  history: PerfHistory,
  low: number,
  high: number,
  span: Span | undefined
): Pick<PerfRangeSummary, "gcs" | "rates" | "compiles"> {
  const gcs: { frame: number | null; t: number; freedMb: number }[] = [];
  const rates: { frame: number | null; from: number; to: number; reason: RateReason }[] = [];
  const compiles: PerfRangeSummary["compiles"][number][] = [];
  for (let index = 0; index < history.eventCount; index += 1) {
    const event = history.events[index];
    if (event === undefined || !isInRange(event, low, high, span)) continue;
    if (event.kind === "gc") gcs.push({ frame: event.frame, t: event.t, freedMb: event.freedMb });
    if (event.kind === "rate") {
      const { frame, from, to, reason } = event;
      rates.push({ frame, from, to, reason });
    }
    if (event.kind === "shader") {
      const { frame, what, label, ms, boot } = event;
      compiles.push({ frame, what, label, ms, boot });
    }
  }
  return { gcs, rates, compiles };
}

/**
 * The passes of pass rows `first`..`end` by kind and view: how often, their GPU ms in total and
 * their share of the range's pass GPU, the heaviest first.
 *
 * @param history - The history.
 * @param first - The first pass row.
 * @param end - The pass row after the last.
 * @returns The passes.
 */
function rangePasses(history: PerfHistory, first: number, end: number): RangePass[] {
  const sums = new Map<number, PassSum>();
  let total = 0;
  for (let pass = first; pass < end; pass += 1) {
    const kind = history.passKind[pass] ?? 0;
    const view = history.passView[pass] ?? 0;
    const key = kind * KIND_STRIDE + view;
    const sum = sums.get(key) ?? { kind, view, count: 0, gpu: 0, measured: false };
    const gpu = history.passGpuMs[pass] ?? Number.NaN;
    sum.count += 1;
    if (Number.isFinite(gpu)) {
      sum.gpu += gpu;
      sum.measured = true;
      total += gpu;
    }
    sums.set(key, sum);
  }
  // eslint-disable-next-line unicorn/no-null -- null is "not measured": no GPU timer
  const none = null;
  return [...sums.values()]
    .map(sum => ({
      kind: PASS_KINDS[sum.kind] ?? "canvas",
      view: history.passNames[sum.view] ?? none,
      count: sum.count,
      gpuMs: sum.measured ? roundTo(sum.gpu, MS_SCALE) : none,
      share: sum.measured && total > 0 ? roundTo(sum.gpu / total, SHARE_SCALE) : none
    }))
    .toSorted((one, other) => (other.gpuMs ?? -1) - (one.gpuMs ?? -1) || other.count - one.count);
}

/**
 * The chain reader of the history's pass rows `first`..`end`.
 *
 * @param history - The history.
 * @param first - The first pass row.
 * @param end - The pass row after the last.
 * @returns The reader (pass 0 is row `first`).
 */
function historyReader(history: PerfHistory, first: number, end: number): ChainReader {
  return {
    count: end - first,
    frame: pass => history.passFrame[first + pass] ?? -1,
    index: pass => history.passIndex[first + pass] ?? -1,
    isFilter: pass => history.passKind[first + pass] === FILTER_KIND,
    owner: pass => history.passOwner[first + pass] ?? 0,
    view: pass => history.passView[first + pass] ?? 0
  };
}

/**
 * The sum of a chain over a range, found or added by owner, view and kinds.
 *
 * @param sums - The range's chains by key.
 * @param owner - The chain's owner; null for none.
 * @param view - Its view.
 * @param kinds - Its filter names in order.
 * @returns The sum.
 */
function chainTotal(
  sums: Map<string, ChainTotal>,
  owner: number | null,
  view: string | null,
  kinds: readonly string[]
): ChainTotal {
  const key = [owner, view, ...kinds].join("\u0000");
  const known = sums.get(key);
  if (known !== undefined) return known;
  const sum: ChainTotal = { owner, view, kinds, applies: 0, gpu: 0, measured: false };
  sums.set(key, sum);
  return sum;
}

/**
 * The range chains of the sums: applies whole, GPU to 0.01 (null when never measured), the heaviest
 * first.
 *
 * @param sums - The chains by key.
 * @returns The chains.
 */
function chainList(sums: Map<string, ChainTotal>): RangeChain[] {
  // eslint-disable-next-line unicorn/no-null -- null is "not measured": no GPU timer
  const none = null;
  return [...sums.values()]
    .map(sum => ({
      owner: sum.owner,
      view: sum.view,
      kinds: sum.kinds,
      applies: Math.round(sum.applies),
      gpuMs: sum.measured ? roundTo(sum.gpu, MS_SCALE) : none
    }))
    .toSorted(
      (one, other) => (other.gpuMs ?? -1) - (one.gpuMs ?? -1) || other.applies - one.applies
    );
}

/**
 * The filter chains of pass rows `first`..`end` (the D5 rule, `walkChains`), summed over the range.
 *
 * @param history - The history.
 * @param first - The first pass row.
 * @param end - The pass row after the last.
 * @returns The chains, the heaviest first.
 */
function rangeChains(history: PerfHistory, first: number, end: number): RangeChain[] {
  const sums = new Map<string, ChainTotal>();
  // eslint-disable-next-line unicorn/no-null -- null is "no view label"
  const name = (id: number): string | null => history.passNames[id] ?? null;
  walkChains(historyReader(history, first, end), (from, to) => {
    const start = first + from;
    const stop = first + to;
    const owner = history.passOwner[start] ?? 0;
    const kinds: string[] = [];
    for (let pass = start; pass < stop; pass += 1) {
      kinds.push(name(history.passFilter[pass] ?? 0) ?? "filter");
    }
    // eslint-disable-next-line unicorn/no-null -- null is "no owner"
    const chainOwner = owner === 0 ? null : owner;
    const sum = chainTotal(sums, chainOwner, name(history.passView[start] ?? 0), kinds);
    sum.applies += stop - start;
    for (let pass = start; pass < stop; pass += 1) {
      const gpu = history.passGpuMs[pass] ?? Number.NaN;
      if (!Number.isFinite(gpu)) continue;
      sum.gpu += gpu;
      sum.measured = true;
    }
  });
  return chainList(sums);
}

/**
 * The per-second summaries overlapping a span and their chains prorated by the overlap (a summary
 * covers the second before its `t`): applies × the part of the second inside, GPU ms as the chain's
 * p50 per frame × its frames (applies / kinds) × that part.
 *
 * @param history - The history.
 * @param span - The rows' span; undefined without rows.
 * @returns The overlapping seconds and the chains.
 */
function secondChains(
  history: PerfHistory,
  span: Span | undefined
): { readonly seconds: number; readonly chains: RangeChain[] } {
  const sums = new Map<string, ChainTotal>();
  let seconds = 0;
  for (let index = 0; span !== undefined && index < history.secondCount; index += 1) {
    const second = history.seconds[index];
    if (second === undefined) continue;
    const inside = Math.min(second.t, span.end) - Math.max(second.t - SECOND_MS, span.start);
    if (inside <= 0) continue;
    seconds += 1;
    const part = inside / SECOND_MS;
    for (const chain of second.chains) {
      const sum = chainTotal(sums, chain.owner, chain.view, chain.kinds);
      sum.applies += chain.applies * part;
      if (chain.gpuMs === null) continue;
      sum.gpu += ((chain.gpuMs.p50 * chain.applies) / Math.max(1, chain.kinds.length)) * part;
      sum.measured = true;
    }
  }
  return { seconds, chains: chainList(sums) };
}

/**
 * The holes inside a range: a hole after frame F is inside when the frames it misses (F + 1 on)
 * start in `[low, high]`.
 *
 * @param history - The history.
 * @param low - The first frame.
 * @param high - The last frame.
 * @returns The hole frames.
 */
function holesIn(history: PerfHistory, low: number, high: number): number[] {
  const holes: number[] = [];
  for (let index = 0; index < history.holeCount; index += 1) {
    const frame = history.holes[index] ?? 0;
    if (frame >= low - 1 && frame < high) holes.push(frame);
  }
  return holes;
}

/**
 * The summary of a range selection (D10; allocates once per selection): its frames, duration,
 * overlapping seconds and worst frame; the systems from the rows' per-frame top 5, else prorated from
 * the samples' per-second systems (`systemsPerSecond`); spikes with their primary cause; the GCs,
 * rate changes and shader compiles of the timeline; passes and filter chains from the pass rows, else
 * the seconds' chains prorated (`passesPerSecond`); demand marks summed; the holes inside.
 *
 * @param history - The history.
 * @param from - The first frame of the range.
 * @param to - The last frame of the range (inclusive; either way round).
 * @returns The summary.
 * @example
 * ```ts
 * const summary = rangeSummary(history, 4810, 4860);
 * summary.systems[0]; // { name: "ward.update", totalMs: 306.7, share: 0.782, maxMs: 9.1 }
 * summary.systemsPerSecond; // false: the rows carried the top 5
 * ```
 */
export function rangeSummary(history: PerfHistory, from: number, to: number): PerfRangeSummary {
  const low = Math.min(from, to);
  const high = Math.max(from, to);
  const { first, last } = rangeRows(history, low, high);
  const span = spanOf(history, first, last);
  const totals = rowTotals(history, first, last);
  const perFrame = frameSystems(history, first, last, totals.jsMs);
  const perSecond =
    perFrame === undefined && first >= 0
      ? secondSystems(history, history.frame[first] ?? 0, history.frame[last] ?? 0, totals.jsMs)
      : undefined;
  const passFirst = lowerBound(history.passFrame, history.passCount, low);
  const passEnd = lowerBound(history.passFrame, history.passCount, high + 1);
  const fromRows = passEnd > passFirst;
  const fromSeconds = secondChains(history, span);
  return {
    from: low,
    to: high,
    frames: first < 0 ? 0 : last - first + 1,
    durationMs: span === undefined ? 0 : roundTo(span.end - span.start, TIME_SCALE),
    seconds: fromSeconds.seconds,
    worstMs: totals.worstMs,
    jsMs: totals.jsMs,
    systems: perFrame ?? perSecond ?? [],
    systemsPerSecond: perSecond !== undefined,
    spikes: totals.spikes,
    ...rangeEvents(history, low, high, span),
    passes: fromRows ? rangePasses(history, passFirst, passEnd) : [],
    chains: fromRows ? rangeChains(history, passFirst, passEnd) : fromSeconds.chains,
    passesPerSecond: !fromRows && fromSeconds.seconds > 0,
    nodes: totals.nodes,
    holes: holesIn(history, low, high)
  };
}

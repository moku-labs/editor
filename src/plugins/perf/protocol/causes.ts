/**
 * @file perf/protocol — the editor's ranking of a spike's causes (R11 answer 11): the cause bits of
 * the window and the wire, the editor's rank, the spike rule, and the small pure readers of the
 * `causes` and `changed` columns. Runtime-free.
 */
import type { PerfCause, PerfChange } from "./engine";

/**
 * The cause bits of the window and the wire, in bit order: index = bit. The engine's `PERF_CAUSES`,
 * kept here engine-free because the tools page and the server's report read the wire and the logs
 * with it; the contract test asserts the two are equal. The agent decodes the ring with
 * `PERF_CAUSES` itself (`perf/ring.ts`), by name into this order.
 */
export const CAUSE_BITS: readonly PerfCause[] = [
  "gap",
  "js",
  "gpu",
  "compile",
  "upload",
  "longFrame",
  "gc?"
];

/**
 * Primary cause codes, by the editor's rank (R11 answer 11): 1 gpu, 2 upload, 3 compile, 4 longFrame,
 * 5 js, 6 gc?, 7 gap; 0 = not a spike. A lower code wins. A long frame names its scripts, so it
 * outranks plain JS; gc? is a hint, so only gap ranks below it.
 */
export const CAUSE_RANK: readonly PerfCause[] = [
  "gpu",
  "upload",
  "compile",
  "longFrame",
  "js",
  "gc?",
  "gap"
];

/**
 * The engine's change bits, in PerfChange order (11:703, 11:1010): index = bit.
 */
const CHANGE_BITS: readonly PerfChange[] = ["resize", "resolution", "scene", "bundle", "restore"];

/**
 * The bit mask of each cause in rank order: `RANK_MASKS[code - 1]` is the bit of `CAUSE_RANK[code - 1]`.
 */
const RANK_MASKS: readonly number[] = CAUSE_RANK.map(cause => 1 << CAUSE_BITS.indexOf(cause));

/**
 * The primary cause code of a frame's cause bits. Allocation-free: a loop over the bit masks in
 * rank order.
 *
 * @param bits - The `causes` column value.
 * @returns 1..7 by CAUSE_RANK, 0 when no bit is set.
 * @example
 * ```ts
 * primaryCause(0b0010010); // 2: upload beats js
 * ```
 */
export function primaryCause(bits: number): number {
  // An indexed loop, as everywhere on the 4 Hz read path: no iterator per frame.
  // eslint-disable-next-line unicorn/no-for-loop -- see above
  for (let index = 0; index < RANK_MASKS.length; index += 1) {
    if ((bits & (RANK_MASKS[index] ?? 0)) !== 0) return index + 1;
  }

  return 0;
}

/**
 * The cause names of a frame, primary first, then by rank. Allocates: for records, not the read loop.
 *
 * @param bits - The `causes` column value.
 * @returns The names; [] for a frame that is not a spike.
 * @example
 * ```ts
 * causesOf(0b0100010); // ["longFrame", "js"]
 * ```
 */
export function causesOf(bits: number): PerfCause[] {
  return CAUSE_RANK.filter(cause => (bits & (1 << CAUSE_BITS.indexOf(cause))) !== 0);
}

/**
 * The name of a primary cause code.
 *
 * @param code - 1..7.
 * @returns The PerfCause; undefined for 0 or out of range.
 * @example
 * ```ts
 * causeName(6); // "gc?"
 * ```
 */
export function causeName(code: number): PerfCause | undefined {
  return CAUSE_RANK[code - 1];
}

/**
 * The change names of a frame's `changed` bits, in PerfChange order.
 *
 * @param bits - The `changed` column value.
 * @returns The names; [] when nothing changed.
 * @example
 * ```ts
 * changesOf(0b01000); // ["bundle"]
 * ```
 */
export function changesOf(bits: number): PerfChange[] {
  return CHANGE_BITS.filter((_change, index) => (bits & (1 << index)) !== 0);
}

/**
 * The bit of a cause in the `causes` column.
 *
 * @param cause - The cause.
 * @returns Its bit.
 * @example
 * ```ts
 * bitOf("js"); // 2
 * ```
 */
function bitOf(cause: PerfCause): number {
  return 1 << CAUSE_BITS.indexOf(cause);
}

/**
 * The `causes` bit of a pause: the gap before the frame was long (the engine's judgement; perf clears
 * it for a gap vsync explains).
 *
 * @example
 * ```ts
 * (window.causes[row] & GAP_BIT) !== 0; // the row's gap counts
 * ```
 */
export const GAP_BIT = bitOf("gap");

/** The causes that are a frame's own work: JS over budget, GPU over budget, a long animation frame (script). */
const WORK_BITS = bitOf("js") | bitOf("gpu") | bitOf("longFrame");

/** What a frame's gap brings: the gap itself and the GC hint read from it. */
const PAUSE_BITS = GAP_BIT | bitOf("gc?");

/** A gap counts as notable past this many frames of the budget or of the display, whichever is longer. */
const NOTABLE_GAP_FRAMES = 1.5;

/** One second, ms: a display's frame is a second over its Hz. */
const SECOND_MS = 1000;

/**
 * Whether a frame's cause bits hold its own work: JS or GPU over budget, or a long animation frame.
 *
 * @param bits - The `causes` column value.
 * @returns Whether the frame worked over budget.
 * @example
 * ```ts
 * hasWork(0b1_0001); // false: a gap and an upload, no work over budget
 * ```
 */
export function hasWork(bits: number): boolean {
  return (bits & WORK_BITS) !== 0;
}

/**
 * Whether a frame's gap is longer than vsync can explain: more than 1.5 frames of its budget or of
 * the display's frame, whichever is longer. A budget from a 120 fps target on a 60 Hz display is not
 * a reason to flag the display's own 16.7 ms between frames.
 *
 * @param gapMs - The gap before the frame, ms; NaN for none.
 * @param budgetMs - The frame's budget, ms.
 * @param displayHz - The display's refresh rate the engine learned; null when unknown.
 * @returns Whether the gap is notable.
 * @example
 * ```ts
 * isNotableGap(16.7, 8.33, 60); // false: one vsync of a 60 Hz display
 * ```
 */
export function isNotableGap(gapMs: number, budgetMs: number, displayHz: number | null): boolean {
  const displayMs = displayHz !== null && displayHz > 0 ? SECOND_MS / displayHz : 0;
  return gapMs > NOTABLE_GAP_FRAMES * Math.max(budgetMs, displayMs);
}

/**
 * The editor's spike decision for a frame (spec 03 delta 2026-10-15): a frame is a spike only for its
 * own work — JS or GPU over budget, or a long animation frame — never for a gap or the GC hint read
 * from it alone. A resting frame (the engine's idle cap, or render on demand that drew nothing) and a
 * break (a gap the browser made, no frame) are never spikes; the wake after a rest keeps its work but
 * not its gap. The primary cause then ranks every bit kept (an upload or a compile names the work).
 * Allocation-free.
 *
 * @param causes - The `causes` column value.
 * @param rest - The frame's rest: 0 awake, 1 resting, 2 the wake after a rest, 3 a break.
 * @returns 1..7 by CAUSE_RANK, 0 when the frame is not a spike.
 * @example
 * ```ts
 * spikeCause(0b1_0001, 0); // 0: a gap and an upload, no work over budget
 * ```
 */
export function spikeCause(causes: number, rest: number): number {
  if (rest === 1 || rest === 3) return 0;
  const bits = rest === 2 ? causes & ~PAUSE_BITS : causes;
  return hasWork(bits) ? primaryCause(bits) : 0;
}

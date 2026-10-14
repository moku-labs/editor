/**
 * @file perf/protocol — the editor's ranking of a spike's causes (R11 answer 11): the engine's cause
 * bits in PerfCause order, the editor's rank, and the small pure readers of the `causes` and
 * `changed` columns. Runtime-free.
 */
import type { PerfCause, PerfChange } from "./engine";

/**
 * The engine's cause bits, in PerfCause order (11:816, 11:1009): index = bit.
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
  let code = 0;
  for (const mask of RANK_MASKS) {
    code += 1;
    if ((bits & mask) !== 0) return code;
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

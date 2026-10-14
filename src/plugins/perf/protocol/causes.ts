/**
 * @file perf/protocol — the editor's ranking of a spike's causes (R11 answer 11): the engine's cause
 * bits in PerfCause order, the editor's rank, and the small pure readers of the `causes` and
 * `changed` columns. Runtime-free.
 */
import type { PerfCause, PerfChange } from "./engine";

/** The message of a skeleton function that unit 03 implements. */
const NOT_IMPLEMENTED = "not implemented";

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
 * The primary cause code of a frame's cause bits. Allocation-free.
 *
 * @param _bits - The `causes` column value.
 * @throws {Error} Always, until unit 03 implements it.
 * @example
 * ```ts
 * primaryCause(0b0010010); // 2: upload beats js
 * ```
 */
export function primaryCause(_bits: number): number {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * The cause names of a frame, primary first, then by rank. Allocates: for records, not the read loop.
 *
 * @param _bits - The `causes` column value.
 * @throws {Error} Always, until unit 03 implements it.
 * @example
 * ```ts
 * causesOf(0b0100010); // ["longFrame", "js"]
 * ```
 */
export function causesOf(_bits: number): PerfCause[] {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * The name of a primary cause code.
 *
 * @param _code - 1..7.
 * @throws {Error} Always, until unit 03 implements it.
 * @example
 * ```ts
 * causeName(6); // "gc?"
 * ```
 */
export function causeName(_code: number): PerfCause | undefined {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * The change names of a frame's `changed` bits, in PerfChange order.
 *
 * @param _bits - The `changed` column value.
 * @throws {Error} Always, until unit 03 implements it.
 * @example
 * ```ts
 * changesOf(0b01000); // ["bundle"]
 * ```
 */
export function changesOf(_bits: number): PerfChange[] {
  throw new Error(NOT_IMPLEMENTED);
}

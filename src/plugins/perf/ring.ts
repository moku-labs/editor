/**
 * @file perf plugin — how the agent decodes the engine's frame ring: with the engine's own lists,
 * `PERF_CAUSES` (the cause bits in bit order) and `DEMAND_REASONS` (the draw reasons in ring order),
 * root exports of the engine since game@0fda201; and the pass ring's `kind` byte in the order of
 * `PASS_KINDS`. The only file of the editor that imports the engine at run time: it runs in the
 * game's page, where the engine is loaded already, and only perf's agent side imports it.
 * perf/protocol and perf/graph stay runtime-free for the tools page and the server
 * (`ring-boundary.test.ts`).
 */
import { DEMAND_REASONS, PERF_CAUSES } from "@moku-labs/game";
import type { PassKind, PerfCause } from "./protocol";
import { CAUSE_BITS, PASS_KINDS } from "./protocol";

/** Every value a byte of the ring's `causes` column can hold. */
const BYTE_VALUES = 256;

/**
 * The table that moves a ring's cause bits to the editor's bit order, by cause name: entry `bits`
 * holds the editor's bits of the causes the ring's `bits` name. A bit whose name the editor does not
 * know, or past the engine's list, is dropped.
 *
 * @param from - The engine's causes in bit order (`PERF_CAUSES`).
 * @param to - The editor's causes in bit order (`CAUSE_BITS`, the wire's).
 * @returns The 256-entry table.
 * @example
 * ```ts
 * causeMap(["js", "gap"], ["gap", "js"])[0b01]; // 0b10: the engine's bit 0 is the editor's js bit
 * ```
 */
export function causeMap(from: readonly string[], to: readonly PerfCause[]): Uint8Array {
  const map = new Uint8Array(BYTE_VALUES);
  for (let bits = 0; bits < BYTE_VALUES; bits += 1) {
    let mapped = 0;
    for (const [bit, name] of from.entries()) {
      const target = (to as readonly string[]).indexOf(name);
      if ((bits & (1 << bit)) !== 0 && target !== -1) mapped |= 1 << target;
    }
    map[bits] = mapped;
  }
  return map;
}

/** The engine's ring cause bits to the editor's, built once. */
const RING_CAUSES = causeMap(PERF_CAUSES, CAUSE_BITS);

/**
 * A ring `causes` value in the editor's bit order. Allocation-free: one table read.
 *
 * @param bits - The ring's `causes` column value.
 * @returns The editor's cause bits.
 * @example
 * ```ts
 * ringCauses(0b1000_0010); // 0b10: js; bit 7 names no cause
 * ```
 */
export function ringCauses(bits: number): number {
  return RING_CAUSES[bits & (BYTE_VALUES - 1)] ?? 0;
}

/**
 * The ring's `reason` of a frame rendered on demand that drew nothing: the index of `"none"` in the
 * engine's `DEMAND_REASONS`.
 */
export const REASON_NONE: number = DEMAND_REASONS.indexOf("none");

/**
 * The pass kind of a pass ring `kind` byte (the engine's `writePass`: 0 canvas, 1 texture, 2
 * filter). The engine exports this order as `PASS_KINDS` from 0.15.1 on; the peer floor (0.15.0)
 * does not, so the editor's runtime-free copy decodes it (a run-time import would fail to link on
 * 0.15.0), and `engine-contract.test.ts` asserts the copy equals the engine's export. A byte past
 * the list reads as a texture pass.
 *
 * @param byte - The ring's `kind` value.
 * @returns The pass kind.
 * @example
 * ```ts
 * passKindOf(2); // "filter"
 * ```
 */
export function passKindOf(byte: number): PassKind {
  return PASS_KINDS[byte] ?? "texture";
}

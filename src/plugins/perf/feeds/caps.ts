/**
 * @file perf feeds — what the page's engine and build measure (spec 03 Delta 2026-10-16 D2): the
 * capabilities computed at the first read after a header (`capsOf`), a capability a stream line
 * proves turned on when the line arrives, and the pass window's 0.15.x columns allocated once the
 * ring has them (never in the read loop).
 */
import type { FrameRing, PerfCaps } from "../protocol";
import { capsOf } from "../protocol";
import type { PassWindow, PerfState } from "../types";

/** A capability a line of the stream proves: a `shader`, `problem`, `gc` or `passes` line came. */
export type SeenCap = "shaderEvents" | "problems" | "gc" | "passesLine";

/**
 * The capabilities with the ones a line proved kept on: those of `was`, and `cap` when given.
 *
 * @param caps - The capabilities.
 * @param was - The capabilities before (their proved ones are kept).
 * @param cap - A capability a line proves now.
 * @returns The capabilities (a fresh object).
 */
function withSeen(caps: PerfCaps, was: PerfCaps, cap?: SeenCap): PerfCaps {
  return {
    ...caps,
    shaderEvents: caps.shaderEvents || was.shaderEvents || cap === "shaderEvents",
    problems: caps.problems || was.problems || cap === "problems",
    gc: caps.gc || was.gc || cap === "gc",
    passesLine: caps.passesLine || was.passesLine || cap === "passesLine"
  };
}

/**
 * Turns on a capability a line proved; nothing when it is on already (one allocation per
 * capability per page).
 *
 * @param state - perf's state.
 * @param cap - The capability.
 */
export function seeCap(state: PerfState, cap: SeenCap): void {
  if (state.caps[cap]) return;
  state.caps = withSeen(state.caps, state.caps, cap);
  state.second = undefined;
}

/**
 * Allocates the pass window's 0.15.x columns the capabilities name, once each.
 *
 * @param passes - The pass window.
 * @param caps - The capabilities.
 */
function addPassColumns(passes: PassWindow, caps: PerfCaps): void {
  const { capacity } = passes;
  if (caps.passOwners && passes.owner === undefined) {
    passes.owner = new Uint32Array(capacity);
    passes.filter = new Uint8Array(capacity);
  }
  if (caps.passDraws) passes.drawsAt ??= new Uint16Array(capacity);
  if (caps.passFormat && passes.format === undefined) {
    // eslint-disable-next-line unicorn/no-null -- null is "no format", as in the engine's ring
    passes.format = Array.from<string | null>({ length: capacity }).fill(null);
    passes.resolution = new Float32Array(capacity);
  }
}

/**
 * Computes the capabilities from the ring, the newest header and the monitor, keeping the ones a
 * line proved, and allocates the pass columns they name. Called by the read when a header arrived
 * since (or at the first read of a run).
 *
 * @param state - perf's state.
 * @param ring - The frame ring.
 */
export function refreshCaps(state: PerfState, ring: FrameRing): void {
  state.caps = withSeen(capsOf(ring, state.header, state.monitor), state.caps);
  state.capsStale = false;
  state.second = undefined;
  addPassColumns(state.passes, state.caps);
}

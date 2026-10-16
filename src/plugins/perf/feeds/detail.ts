/* eslint-disable unicorn/no-null -- null is "no rows" on the wire (spec 03 D8) */
/**
 * @file perf feeds — range detail (spec 03 Delta 2026-10-16 D8): `editor.perf.detail { from, to }`
 * answers the rows of a range from perf's own window, else none ("gone"). At most 2048 frames.
 * Reading the engine's `monitor.detail` (next change, N5) is deferred until the engine ships it
 * (owner 2026-10-16: no conversion code on the phone before then).
 */
import type { PerfDetailWire } from "../protocol";
import type { PerfState } from "../types";
import { rowsWire } from "./frames";
import { cell } from "./wire";

/** The most frames one detail answer carries: the newest of a longer range. */
const MAX_DETAIL_FRAMES = 2048;

/**
 * `editor.perf.detail { from, to }` (D8): the ends swapped when reversed and the range cut to its
 * newest 2048 frames; the window rows of the range with every block perf holds for them (the pass
 * rows read while `feeds.passes` was on), `reason: "no-detail"`; else frames null, "gone".
 * Allocates its answer.
 *
 * @param state - perf's state.
 * @param one - One end of the range (a frame number).
 * @param other - The other end.
 * @returns The detail.
 */
export function detailOf(state: PerfState, one: number, other: number): PerfDetailWire {
  const to = Math.max(one, other);
  const from = Math.max(Math.min(one, other), to - MAX_DETAIL_FRAMES);
  // eslint-disable-next-line sonarjs/todo-tag -- deferred to the engine's next change (owner 2026-10-16)
  // TODO(engine): with `monitor.detail` (N5) shipped, ask it inside the agent span while the ring
  // still holds the range (source "engine"; its control refusal → reason "control", a throw →
  // "failed"), before this window fallback.
  const { window } = state;
  let first = 0;
  while (first < window.count && cell(window.frame, first) < from) first += 1;
  let end = first;
  while (end < window.count && cell(window.frame, end) <= to) end += 1;
  if (end === first)
    return { v: 1, from, to, source: null, reason: "gone", frames: null, nodes: null };
  const frames = rowsWire(state, { first, end, hole: false, passes: state.passes.count > 0 });
  return { v: 1, from, to, source: "agent", reason: "no-detail", frames, nodes: null };
}

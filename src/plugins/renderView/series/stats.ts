/**
 * @file renderView series — the frames header numbers of the view (spec 09 § M12
 * MissionView.stats) over the history's rows: spikes as groups, the worst frame, p90 of the
 * awake frames, rest time clipped to the view, GCs; percentiles over a preallocated scratch.
 * Typed stub of build wave 0 (spec 09 § M17, RV0): the signatures are the contract the other
 * Mission control units build against; build wave 3 (RV1) writes the bodies.
 */
import type { PerfHistory } from "../source/contract";
import { notBuilt } from "../stub";
import type { MissionView } from "../types";

/**
 * The frames header numbers of the frames inside the view.
 *
 * @param _history - The history.
 * @param _startMs - The view's start, source clock.
 * @param _endMs - The view's end, source clock.
 * @returns The numbers.
 * @throws {Error} Until build wave 3: "renderView series/viewStats is not built yet".
 */
export function viewStats(
  _history: PerfHistory,
  _startMs: number,
  _endMs: number
): MissionView["stats"] {
  return notBuilt("series/viewStats", 3);
}

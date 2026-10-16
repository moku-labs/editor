/**
 * @file renderView series — the 1 Hz series of the active source's second (spec 09 § M11):
 * textures MB, the object counters of `sample.counts` and the render targets created, and the
 * local preview's trusted heap. Typed stub of build wave 0 (spec 09 § M17, RV0): the signatures
 * are the contract the other Mission control units build against; build wave 3 (RV1) writes the
 * bodies.
 */
import type { PerfSecond } from "../source/contract";
import { notBuilt } from "../stub";
import type { MissionSeries } from "./types";

/**
 * Adds one second's textures, object counters, targets and (local preview) heap.
 *
 * @param _series - The side series.
 * @param _second - The newest `editor.perf.second`.
 * @param _t - Source-clock ms of the second's sample.
 * @throws {Error} Until build wave 3: "renderView series/addSecond is not built yet".
 */
export function addSecond(_series: MissionSeries, _second: PerfSecond, _t: number): void {
  notBuilt("series/addSecond", 3);
}

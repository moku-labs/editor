/**
 * @file renderView series — the overview's 500 ms buckets (spec 09 § M11), updated from the
 * rows each appendFrames added, never recomputed per paint. Typed stub of build wave 0 (spec 09
 * § M17, RV0): the signatures are the contract the other Mission control units build against;
 * build wave 3 (RV1) writes the bodies.
 */
import type { PerfHistory } from "../source/contract";
import { notBuilt } from "../stub";
import type { MissionSeries } from "./types";

/**
 * Folds the new rows into the overview's buckets: each bucket keeps its worst frame, its
 * primary spike cause, the GC and rate-change flags, and whether it only rested.
 *
 * @param _series - The side series.
 * @param _history - The history the rows were appended to.
 * @param _first - The first new row (the history's count before the append).
 * @throws {Error} Until build wave 3: "renderView series/noteRows is not built yet".
 */
export function noteRows(_series: MissionSeries, _history: PerfHistory, _first: number): void {
  notBuilt("series/noteRows", 3);
}

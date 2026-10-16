/**
 * @file renderView series — spike groups (spec 09 § M11): consecutive frames of one primary
 * cause form one group; a different cause starts a new one. Typed stub of build wave 0 (spec 09
 * § M17, RV0): the signatures are the contract the other Mission control units build against;
 * build wave 3 (RV1) writes the bodies.
 */
import type { PerfHistory } from "../source/contract";
import { notBuilt } from "../stub";
import type { FrameRange } from "../view/types";

/**
 * The spike group a row belongs to.
 *
 * @param _history - The history.
 * @param _row - A row of a spike frame.
 * @returns Its frames; undefined when the row is not a spike.
 * @throws {Error} Until build wave 3: "renderView series/spikeGroupAt is not built yet".
 */
export function spikeGroupAt(_history: PerfHistory, _row: number): FrameRange | undefined {
  return notBuilt("series/spikeGroupAt", 3);
}

/**
 * The spike groups between two rows, oldest first.
 *
 * @param _history - The history.
 * @param _first - The first row.
 * @param _last - The last row (inclusive).
 * @returns The groups.
 * @throws {Error} Until build wave 3: "renderView series/spikeGroups is not built yet".
 */
export function spikeGroups(_history: PerfHistory, _first: number, _last: number): FrameRange[] {
  return notBuilt("series/spikeGroups", 3);
}

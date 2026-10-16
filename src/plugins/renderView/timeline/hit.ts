/**
 * @file renderView timeline — hit tests of the timeline, the lane and the overview (spec 09 §
 * M11): the frame under a pointer, a flag, the viewport's grab. Typed stub of build wave 0
 * (spec 09 § M17, RV0): the signatures are the contract the other Mission control units build
 * against; build wave 3 (RV2) writes the bodies.
 */
import type { PerfHistory } from "../source/contract";
import { notBuilt } from "../stub";
import type { TimelineLayout } from "./layout";

/**
 * The frame under a pointer's x.
 *
 * @param _history - The history.
 * @param _layout - The canvas's geometry.
 * @param _x - Pointer x, CSS px.
 * @param _startMs - The view's start, source clock.
 * @param _endMs - The view's end, source clock.
 * @returns The frame; undefined outside the plot or over no data.
 * @throws {Error} Until build wave 3: "renderView timeline/frameAt is not built yet".
 */
export function frameAt(
  _history: PerfHistory,
  _layout: TimelineLayout,
  _x: number,
  _startMs: number,
  _endMs: number
): number | undefined {
  return notBuilt("timeline/frameAt", 3);
}

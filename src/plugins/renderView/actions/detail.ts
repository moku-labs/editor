/**
 * @file renderView actions — the detail read of a selection (spec 09 § M10): one
 * `editor.perf.detail` read DETAIL_DELAY_MS after a selection settles, merged into the history;
 * a late answer for a replaced selection is dropped. Typed stub of build wave 0 (spec 09 § M17,
 * RV0): the signatures are the contract the other Mission control units build against; build
 * wave 3 (RV4) writes the bodies.
 */
import { notBuilt } from "../stub";
import type { MissionState, RenderViewCtx } from "../types";
import type { FrameRange } from "../view/types";

/** The settle time before a detail read, ms (spec 09 § M12). */
export const DETAIL_DELAY_MS = 150;

/**
 * Schedules the detail read of a selection (a newer selection replaces it).
 *
 * @param _ctx - Domain context of renderView.
 * @param _range - The settled selection.
 * @throws {Error} Until build wave 3: "renderView actions/readDetail is not built yet".
 */
export function readDetail(_ctx: RenderViewCtx, _range: FrameRange): void {
  notBuilt("actions/readDetail", 3);
}

/**
 * Drops a scheduled or running detail read (a source switch, onStop).
 *
 * @param _mission - Mission control's state.
 * @throws {Error} Until build wave 3: "renderView actions/cancelDetail is not built yet".
 */
export function cancelDetail(_mission: MissionState): void {
  notBuilt("actions/cancelDetail", 3);
}

/**
 * @file renderView source — the poll (spec 09 § M2 rule 2): while Render is shown and the
 * source is live, one timer every POLL_MS reads `editor.perf.frames { after }` and then
 * `editor.perf.events { after }`; a read in flight is never doubled; each frames answer feeds
 * the display clock. Typed stub of build wave 0 (spec 09 § M17, RV0): the signatures are the
 * contract the other Mission control units build against; build wave 3 (RV4) writes the bodies.
 */
import { notBuilt } from "../stub";
import type { MissionState, RenderViewCtx } from "../types";

/** The poll's period, ms (spec 09 § M12). */
export const POLL_MS = 1000;

/**
 * Starts the poll of the active source (idempotent).
 *
 * @param _ctx - Domain context of renderView.
 * @throws {Error} Until build wave 3: "renderView source/startPoll is not built yet".
 */
export function startPoll(_ctx: RenderViewCtx): void {
  notBuilt("source/startPoll", 3);
}

/**
 * Stops the poll; a read in flight is dropped when it answers.
 *
 * @param _mission - Mission control's state.
 * @throws {Error} Until build wave 3: "renderView source/stopPoll is not built yet".
 */
export function stopPoll(_mission: MissionState): void {
  notBuilt("source/stopPoll", 3);
}

/**
 * One tick: the frames read, then the events read; appends both to the history and notes the
 * arrival on the clock.
 *
 * @param _ctx - Domain context of renderView.
 * @returns When both reads settled (never rejects).
 * @throws {Error} Until build wave 3: "renderView source/pollOnce is not built yet".
 */
export function pollOnce(_ctx: RenderViewCtx): Promise<void> {
  return notBuilt("source/pollOnce", 3);
}

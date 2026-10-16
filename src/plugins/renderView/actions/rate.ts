/**
 * @file renderView actions — the rate switch (spec 09 § M9): runs `game.frameRate { fps }` or
 * `{}` on the active source, one in flight, a late answer after a source switch dropped. Typed
 * stub of build wave 0 (spec 09 § M17, RV0): the signatures are the contract the other Mission
 * control units build against; build wave 3 (RV4) writes the bodies.
 */
import { notBuilt } from "../stub";
import type { RateAnswer, RateChoice, RenderViewCtx } from "../types";

/**
 * Runs the switch; never rejects.
 *
 * @param _ctx - Domain context of renderView.
 * @param _choice - 60, 120 or "adaptive".
 * @returns The answer.
 * @throws {Error} Until build wave 3: "renderView actions/runRate is not built yet".
 */
export function runRate(_ctx: RenderViewCtx, _choice: RateChoice): Promise<RateAnswer> {
  return notBuilt("actions/runRate", 3);
}

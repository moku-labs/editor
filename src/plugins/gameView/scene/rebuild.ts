/**
 * @file gameView plugin — one build of the scene from the stored sources (the shared
 * `buildScene`, R8) and the frame a link status reports. The watches and the calibration both
 * rebuild through here.
 */
import { buildScene } from "../../panels/shared/scene";
import type { LinkStatus } from "../../registry/protocol";
import { notify } from "../state";
import type { GameViewCtx } from "../types";

/**
 * The frame a link status reports, or a fallback.
 *
 * @param status - The link status.
 * @param fallback - Used while connecting or empty.
 * @returns The frame.
 * @example
 * ```ts
 * frameOf({ kind: "paused", frame: 2000 }, 0); // 2000
 * ```
 */
export function frameOf(status: LinkStatus, fallback: number): number {
  if (status.kind === "live" || status.kind === "paused") return status.frame;
  if (status.kind === "silent" || status.kind === "lost") return status.lastFrame;
  return fallback;
}

/**
 * Builds the scene from the stored sources (all three needed); a shape error keeps the last
 * scene and warns.
 *
 * @param ctx - Domain context of gameView.
 * @param frame - The frame of the values.
 */
export function rebuildScene(ctx: GameViewCtx, frame: number): void {
  const { state } = ctx;
  const { ui, entities, projections } = state.sources;
  if (ui === undefined || entities === undefined || projections === undefined) return;

  const built = buildScene({ ui, entities, projections, frame, calibration: state.calibration });
  if ("error" in built) {
    ctx.log.warn("gameView: scene shape", built);
    return;
  }
  state.scene = built;
  notify(state);
}

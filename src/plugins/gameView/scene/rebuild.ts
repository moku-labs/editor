/**
 * @file gameView plugin — one build of the scene from the stored sources (the shared
 * `buildScene`, R8), the frame a link status reports, and the one place a new scene snapshot is
 * stored (`storeScene`: the pending style edits resolve against it, U8). The watches and the
 * calibration both rebuild through here.
 */
import type { SceneSnapshot } from "../../panels/shared/scene";
import { buildScene } from "../../panels/shared/scene";
import type { LinkStatus } from "../../registry/protocol";
import { resolveEdits } from "../element/edit-style";
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
 * Stores a new scene snapshot: it becomes `state.scene`, the pending style edits it shows are
 * dropped (U8) and the views re-render.
 *
 * @param ctx - Domain context of gameView.
 * @param scene - The scene just built.
 */
export function storeScene(ctx: GameViewCtx, scene: SceneSnapshot): void {
  ctx.state.scene = scene;
  resolveEdits(ctx, scene);
  notify(ctx.state);
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
  storeScene(ctx, built);
}

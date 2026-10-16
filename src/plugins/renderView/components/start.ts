/**
 * @file renderView components — starts an action from an event handler (spec 09 § M7–M10): the api's
 * commands never reject, the Connect panel's actions catch their own errors; anything else that
 * rejects is logged, never thrown into the handler.
 */
import type { RenderViewCtx } from "../types";

/**
 * Starts a task from an event handler; a rejection is logged as `renderView:action-failed`.
 *
 * @param ctx - Domain context of renderView.
 * @param task - The started task.
 * @example
 * ```ts
 * <button onClick={() => start(ctx, api.setRate(120))}>120</button>
 * ```
 */
export function start(ctx: RenderViewCtx, task: Promise<unknown>): void {
  task.catch((error: unknown) => {
    ctx.log.warn("renderView:action-failed", { error: String(error) });
  });
}

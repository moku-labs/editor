/**
 * @file gameView plugin — the game reloads gameView starts (toolbar Reload, style save): workspace
 * runs the D-07 reload; gameView only marks "Reloading game" on the stage while it runs.
 */
import { workspacePlugin } from "../../workspace";
import { messageOf } from "../report";
import { notify } from "../state";
import type { GameViewCtx } from "../types";

/**
 * Reloads the game frame through workspace and marks the stage badge while it runs.
 *
 * @param ctx - Domain context of gameView.
 * @param restore - true after a style save (bookmark → reload → restore), false for Reload.
 * @returns Resolves when the reload settled (never rejects).
 * @example
 * ```ts
 * await reloadGame(ctx, true); // "Game reloaded · state restored" toast comes from workspace
 * ```
 */
export async function reloadGame(ctx: GameViewCtx, restore: boolean): Promise<void> {
  const { state } = ctx;
  state.reloading = true;
  notify(state);
  try {
    await ctx.require(workspacePlugin).gameFrame().reload({ restore });
  } catch (error) {
    ctx.log.warn("gameView: reload failed", { message: messageOf(error) });
  } finally {
    state.reloading = false;
    notify(state);
  }
}

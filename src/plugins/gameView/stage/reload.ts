/**
 * @file gameView plugin — the game reloads gameView starts (toolbar Reload, style save): workspace
 * runs the D-07 reload and shows its spinner on the frame (U9); gameView only logs a failure.
 */
import { workspacePlugin } from "../../workspace";
import { messageOf } from "../report";
import type { GameViewCtx } from "../types";

/**
 * Reloads the game frame through workspace; a failed reload is logged as a warning.
 *
 * @param ctx - Domain context of gameView.
 * @param restore - true after a style save (bookmark → reload → restore), false for Reload.
 * @returns Resolves when the reload settled (never rejects).
 */
export async function reloadGame(ctx: GameViewCtx, restore: boolean): Promise<void> {
  try {
    await ctx.require(workspacePlugin).gameFrame().reload({ restore });
  } catch (error) {
    ctx.log.warn("gameView: reload failed", { message: messageOf(error) });
  }
}

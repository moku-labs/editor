/**
 * @file gameView plugin — the game reloads gameView starts (toolbar Reload, style save): workspace
 * runs the D-07 reload and shows its spinner on the frame (U9); gameView only logs a failure. The
 * toolbar Reload is busy while one runs or the link reports an expected reload (U11).
 */
import { workspacePlugin } from "../../workspace";
import { messageOf } from "../report";
import { notify } from "../state";
import type { GameViewCtx, GameViewState } from "../types";

/**
 * True while a gameView reload runs or the link reports an expected reload from another trigger.
 *
 * @param state - gameView state.
 * @returns Whether the toolbar Reload is busy.
 * @example
 * ```ts
 * // A style save is reloading the game: the toolbar shows "…" and ignores a click.
 * isReloadBusy(state); // true
 * ```
 */
export function isReloadBusy(state: GameViewState): boolean {
  return state.reloads > 0 || state.link.reloading;
}

/**
 * Reloads the game frame through workspace; a failed reload is logged as a warning. The toolbar
 * Reload is busy until the reload settles.
 *
 * @param ctx - Domain context of gameView.
 * @param restore - true after a style save (bookmark → reload → restore), false for Reload.
 * @returns Resolves when the reload settled (never rejects).
 */
export async function reloadGame(ctx: GameViewCtx, restore: boolean): Promise<void> {
  const { state } = ctx;
  state.reloads += 1;
  notify(state);
  try {
    await ctx.require(workspacePlugin).gameFrame().reload({ restore });
  } catch (error) {
    ctx.log.warn("gameView: reload failed", { message: messageOf(error) });
  } finally {
    state.reloads -= 1;
    notify(state);
  }
}

/**
 * The toolbar Reload: reloads without restore, nothing while a reload is already busy.
 *
 * @param ctx - Domain context of gameView.
 * @returns Resolves when the reload settled, at once when busy.
 */
export async function reloadFromToolbar(ctx: GameViewCtx): Promise<void> {
  if (isReloadBusy(ctx.state)) return;
  await reloadGame(ctx, false);
}

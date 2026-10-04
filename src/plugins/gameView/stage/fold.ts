/**
 * @file gameView plugin — Fold / Unfold of a foldable preset (round 2 R4): workspace switches the
 * frame between the cover and the inner screen live (`setDevice({ folded })`, no reload; the game
 * sees a resize); gameView's device listener then calibrates the picker again.
 */
import { workspacePlugin } from "../../workspace";
import type { GameViewCtx } from "../types";

/**
 * Folds or unfolds the current preset; toggles without an argument. A preset without `fold`, or
 * the screen already shown, changes nothing.
 *
 * @param ctx - Domain context of gameView.
 * @param inner - true for the inner screen, false for the cover; omitted toggles.
 */
export function foldDevice(ctx: GameViewCtx, inner?: boolean): void {
  const workspace = ctx.require(workspacePlugin);
  const choice = workspace.device();
  if (choice.preset.fold === undefined) return;

  const folded = inner === undefined ? !choice.folded : !inner;
  if (folded !== choice.folded) workspace.setDevice({ folded });
}

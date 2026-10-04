/**
 * @file gameView plugin — the Sound switch (round 2b R11): `game.mute { muted }` through
 * panels.run (R9) when the game's manifest lists it, the flag kept in workspace's preferences
 * (`muted()`, `setMuted()`), and the flag applied again to every game that connects while the
 * viewer has the sound off (a hot reload connects a new page too).
 */
import { linkPlugin } from "../link";
import { panelsPlugin } from "../panels";
import { isWireError, type Manifest } from "../registry/protocol";
import { workspacePlugin } from "../workspace";
import { hasCommand } from "./commands";
import { messageOf, reportFailure } from "./report";
import { notify } from "./state";
import type { GameViewCtx } from "./types";

/**
 * The control command of the game's master mute (`@moku-labs/game` brief §7).
 */
export const MUTE_COMMAND = "game.mute";

/**
 * The tooltip of the Sound switch when the game has no `game.mute`.
 */
export const NO_MUTE_TEXT = "Needs @moku-labs/game with game.mute";

/**
 * True when the attached game lists `game.mute`.
 *
 * @param ctx - Domain context of gameView.
 * @returns Whether the Sound switch can work.
 */
export function canMute(ctx: GameViewCtx): boolean {
  return hasCommand(ctx.require(linkPlugin).manifest(), MUTE_COMMAND);
}

/**
 * The Sound switch and key M: runs `game.mute` with the wanted flag (toggled without one), then
 * keeps the flag in workspace's preferences. A game without `game.mute` changes nothing; a
 * refusal keeps the flag and is toasted.
 *
 * @param ctx - Domain context of gameView.
 * @param muted - True to mute, false for sound; omitted toggles.
 * @returns True when the game took the flag.
 */
export async function setSound(ctx: GameViewCtx, muted?: boolean): Promise<boolean> {
  if (!canMute(ctx)) return false;
  const workspace = ctx.require(workspacePlugin);
  const next = muted ?? !workspace.muted();

  try {
    await ctx.require(panelsPlugin).run(MUTE_COMMAND, { muted: next });
  } catch (error) {
    reportFailure(ctx, "Sound switch failed", "gameView: mute failed", error);
    return false;
  }
  workspace.setMuted(next);
  notify(ctx.state);
  return true;
}

/**
 * The manifest listener: a game that connects while the viewer has the sound off is muted
 * again. A refusal is only logged: nobody pressed anything.
 *
 * @param ctx - Domain context of gameView.
 * @param manifest - The new manifest, undefined when the session was lost.
 */
export function reapplyMute(ctx: GameViewCtx, manifest: Manifest | undefined): void {
  const muted = ctx.require(workspacePlugin).muted();
  if (!muted || !hasCommand(manifest, MUTE_COMMAND)) return;

  ctx
    .require(panelsPlugin)
    .run(MUTE_COMMAND, { muted })
    .catch((error: unknown) => {
      ctx.log.warn("gameView: mute failed", {
        code: isWireError(error) ? error.code : undefined,
        message: messageOf(error)
      });
    });
}

/**
 * @file workspace plugin — the overlay-in-game switch (R4): workspace owns the flag; the B1
 * switch, the O key, the palette and gameView C8 call `setOverlayInGame`, which runs
 * `editor.overlay` through `runCommand` and toasts; `reapplyOverlay` (the manifest listener of
 * onStart) turns it on again for every new session while the flag is on.
 */
import { linkPlugin } from "../link";
import type { Manifest } from "../registry/protocol";
import { bareMessage, toWireError } from "../registry/protocol";
import { runCommand } from "./commands";
import { showToast } from "./toasts";
import type { RunOrigin, WorkspaceCtx } from "./types";

/**
 * The registry command of the in-game overlay (overlay plugin, agent core).
 */
const OVERLAY_COMMAND = "editor.overlay";

/**
 * The log event of an overlay run that failed.
 */
const OVERLAY_FAILED = "workspace:overlay-failed";

/**
 * True when the manifest lists `editor.overlay`.
 *
 * @param manifest - The manifest of the chosen session.
 * @returns Whether the command exists.
 * @example
 * ```ts
 * listsOverlay(link.manifest());
 * ```
 */
function listsOverlay(manifest: Manifest | undefined): boolean {
  return manifest?.commands.some(command => command.id === OVERLAY_COMMAND) ?? false;
}

/**
 * True when the switch can act now: the link is live or paused and the game has the command.
 *
 * @param ctx - Domain context of workspace.
 * @returns Whether `editor.overlay` can run.
 */
export function overlayAvailable(ctx: Pick<WorkspaceCtx, "state" | "require">): boolean {
  const { kind } = ctx.state.link;
  return (kind === "live" || kind === "paused") && listsOverlay(ctx.require(linkPlugin).manifest());
}

/**
 * Sets the overlay-in-game flag and, when the game is connected, runs `editor.overlay { on }`.
 * Success toasts "Overlay in game on/off"; a failure puts the flag back, toasts and warns. Not
 * connected: the flag stays and the next session gets it.
 *
 * @param ctx - Domain context of workspace.
 * @param on - The new flag.
 * @param origin - What flipped it (topbar, key, palette, panel).
 * @returns Resolves when the run settled (never rejects).
 */
export async function setOverlayInGame(
  ctx: WorkspaceCtx,
  on: boolean,
  origin: RunOrigin
): Promise<void> {
  const { state } = ctx;
  const previous = state.overlayInGame;
  state.overlayInGame = on;
  state.ui.bump();
  if (!overlayAvailable(ctx)) return;

  try {
    await runCommand(ctx, OVERLAY_COMMAND, { on }, origin);
    showToast(ctx, on ? "Overlay in game on" : "Overlay in game off");
  } catch (error) {
    const wire = toWireError(error);
    state.overlayInGame = previous;
    state.ui.bump();
    showToast(ctx, `Overlay in game failed · ${bareMessage(wire.message)}`);
    ctx.log.warn(OVERLAY_FAILED, { code: wire.code });
  }
}

/**
 * The manifest listener part: while the flag is on, runs `editor.overlay { on: true }` on every
 * new session directly through link (not a user run: no toast, no `workspace:ran`; a failure is a
 * warn). The overlay in the game page starts off after every reload.
 *
 * @param ctx - Domain context of workspace.
 * @param manifest - The new manifest, undefined when the session was lost.
 */
export function reapplyOverlay(ctx: WorkspaceCtx, manifest: Manifest | undefined): void {
  if (!ctx.state.overlayInGame || !listsOverlay(manifest)) return;

  ctx
    .require(linkPlugin)
    .run(OVERLAY_COMMAND, { on: true })
    .catch((error: unknown) => {
      ctx.log.warn(OVERLAY_FAILED, { code: toWireError(error).code });
    });
}

/**
 * @file workspace plugin — shell actions shared by the api, the keys, the palette and the top
 * bar: show a workspace, rail badges, the preview toggle (G), step and pause/resume, popovers.
 */
import { ERROR_PREFIX } from "../registry/protocol";
import { runCommand } from "./commands";
import { syncFrame } from "./frame/frame";
import { patchPreview } from "./prefs/apply";
import type { Badge, RunOrigin, WorkspaceCtx, WorkspaceId, WorkspaceState } from "./types";
import { isPreviewWorkspace, isWorkspaceId } from "./workspaces";

/**
 * A top-bar popover.
 */
export type PopoverId = NonNullable<WorkspaceState["popover"]>;

/**
 * Writes `#<ws>` into the URL with replaceState (no history entry).
 *
 * @param ws - The shown workspace.
 * @example
 * ```ts
 * writeHash("game");
 * ```
 */
function writeHash(ws: WorkspaceId): void {
  const { history } = globalThis;
  if (history === undefined) return;
  history.replaceState(history.state, "", `#${ws}`);
}

/**
 * Shows a workspace; emits `workspace:changed` only when it changes.
 *
 * @param ctx - Domain context of workspace.
 * @param ws - The workspace.
 * @throws {Error} `[moku-editor] Unknown workspace "<ws>".` for another id.
 * @example
 * ```ts
 * showWorkspace(ctx, "game");
 * ```
 */
export function showWorkspace(ctx: WorkspaceCtx, ws: WorkspaceId): void {
  if (!isWorkspaceId(ws)) {
    throw new Error(
      `${ERROR_PREFIX}Unknown workspace "${String(ws)}".\n  Use flow, game, render, state, files or console.`
    );
  }
  const { state } = ctx;
  if (state.active === ws) return;

  state.active = ws;
  writeHash(ws);
  ctx.emit("workspace:changed", { ws });
  state.ui.bump();
  syncFrame(ctx);
}

/**
 * Sets or clears the rail badge of a workspace.
 *
 * @param state - Workspace state.
 * @param ws - The workspace.
 * @param badge - The badge, undefined to clear.
 * @example
 * ```ts
 * setBadge(ctx.state, "console", { count: 3, tone: "error", label: "2 warn · 1 error" });
 * ```
 */
export function setBadge(state: WorkspaceState, ws: WorkspaceId, badge: Badge | undefined): void {
  if (badge === undefined) delete state.badges[ws];
  else state.badges[ws] = { ...badge };
  state.ui.bump();
}

/**
 * Shows or hides the preview of the current workspace (G); a no-op in Game.
 *
 * @param ctx - Domain context of workspace.
 * @example
 * ```ts
 * togglePreview(ctx);
 * ```
 */
export function togglePreview(ctx: WorkspaceCtx): void {
  const { active } = ctx.state;
  if (!isPreviewWorkspace(active)) return;
  patchPreview(ctx, active, { visible: !ctx.state.previews[active].visible });
}

/**
 * Steps one frame while paused; does nothing otherwise (button, key and palette alike).
 *
 * @param ctx - Domain context of workspace.
 * @param origin - What asked for it.
 * @example
 * ```ts
 * stepOnce(ctx, "key");
 * ```
 */
export function stepOnce(ctx: WorkspaceCtx, origin: RunOrigin): void {
  if (ctx.state.link.kind !== "paused") return;
  runCommand(ctx, "game.step", { frames: 1 }, origin).catch((error: unknown) => {
    ctx.log.debug("workspace:step-failed", { error: String(error) });
  });
}

/**
 * Pauses a live game or resumes a paused one; does nothing otherwise.
 *
 * @param ctx - Domain context of workspace.
 * @param origin - What asked for it.
 * @example
 * ```ts
 * togglePause(ctx, "topbar");
 * ```
 */
export function togglePause(ctx: WorkspaceCtx, origin: RunOrigin): void {
  const { kind } = ctx.state.link;
  if (kind !== "live" && kind !== "paused") return;
  const id = kind === "live" ? "game.pause" : "game.resume";
  runCommand(ctx, id, undefined, origin).catch((error: unknown) => {
    ctx.log.debug("workspace:pause-failed", { error: String(error) });
  });
}

/**
 * Opens a top-bar popover (one at a time).
 *
 * @param state - Workspace state.
 * @param popover - Which one.
 * @example
 * ```ts
 * openPopover(ctx.state, "registry");
 * ```
 */
export function openPopover(state: WorkspaceState, popover: PopoverId): void {
  state.popover = popover;
  state.ui.bump();
}

/**
 * Closes a popover when it is the open one.
 *
 * @param state - Workspace state.
 * @param popover - Which one.
 * @returns True when it was open (an Esc layer consumed the press).
 * @example
 * ```ts
 * addEscapeLayer(ctx, "registry", () => closePopover(ctx.state, "registry"));
 * ```
 */
export function closePopover(state: WorkspaceState, popover: PopoverId): boolean {
  if (state.popover !== popover) return false;
  state.popover = undefined;
  state.ui.bump();
  return true;
}

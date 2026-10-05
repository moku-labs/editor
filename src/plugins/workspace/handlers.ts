/**
 * @file workspace plugin — hooks: link:status drives the pill, the stale bar, the F4 cards and
 * the frame spinner of an expected reload.
 */
import type { ToolsEvents } from "../../config";
import { syncSpinner } from "./frame/frame";
import type { WorkspaceCtx, WorkspaceHooks, WorkspaceState } from "./types";

/**
 * The ticker period while the link is silent or lost (the pill counts seconds).
 */
const TICK_MS = 1000;

/**
 * The workspace's hooks factory (`hooks: createHandlers`).
 *
 * @param ctx - Domain context of workspace.
 * @returns The hooks.
 */
export function createHandlers(ctx: WorkspaceCtx): WorkspaceHooks {
  return { "link:status": handleLinkStatus(ctx) };
}

/**
 * Stops the 1 s ticker.
 *
 * @param state - Workspace state.
 */
export function stopTicker(state: WorkspaceState): void {
  clearInterval(state.ticker);
  state.ticker = undefined;
}

/**
 * Stores the status, sets everLive, runs the 1 s ticker while silent or lost, shows the frame
 * spinner while the link reloads (U9 B6), closes a stale step popover, bumps the UI.
 *
 * @param ctx - Domain context of workspace.
 * @returns The `link:status` handler.
 */
export function handleLinkStatus(
  ctx: Pick<WorkspaceCtx, "state">
): (payload: ToolsEvents["link:status"]) => void {
  return ({ status }) => {
    const { state } = ctx;
    state.link = status;
    const running = status.kind === "live" || status.kind === "paused";
    if (running) state.everLive = true;

    if (status.kind === "silent" || status.kind === "lost") {
      state.ticker ??= setInterval(() => {
        state.ui.bump();
      }, TICK_MS);
    } else stopTicker(state);
    syncSpinner(state);

    if (!running && state.popover === "step") state.popover = undefined;
    state.ui.bump();
  };
}

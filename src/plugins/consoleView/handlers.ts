/**
 * @file consoleView plugin — hooks of the global tools events: link:status (notify) and
 * workspace:ran (command error lines, R4).
 */
import type { ToolsEvents } from "../../config";
import type { ConsoleCtx, ConsoleHooks } from "./types";

/**
 * consoleView's hooks factory (`hooks: createHandlers`).
 *
 * @param _ctx - Domain context of consoleView.
 * @example
 * ```ts
 * createToolsPlugin("consoleView", { hooks: createHandlers });
 * ```
 */
export function createHandlers(_ctx: ConsoleCtx): ConsoleHooks {
  throw new Error("not implemented");
}

/**
 * Notifies the view (the empty-state text depends on the status); reads nothing.
 *
 * @param _ctx - Domain context of consoleView.
 * @example
 * ```ts
 * onLinkStatus(ctx)({ status: { kind: "empty" } });
 * ```
 */
export function onLinkStatus(_ctx: ConsoleCtx): (payload: ToolsEvents["link:status"]) => void {
  throw new Error("not implemented");
}

/**
 * ok: false → appends the command error line (bareMessage, R7) and pushes the badge.
 *
 * @param _ctx - Domain context of consoleView.
 * @example
 * ```ts
 * onCommandRan(ctx)(ranEvent);
 * ```
 */
export function onCommandRan(_ctx: ConsoleCtx): (payload: ToolsEvents["workspace:ran"]) => void {
  throw new Error("not implemented");
}

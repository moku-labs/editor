/**
 * @file gameView plugin — one failure path for every capture, series, sheet, note and style
 * write: a toast with the bare message (R7: no `[moku-editor]` prefix in the UI) and a log entry
 * that keeps the full message and the wire code.
 */

import { bareMessage, errorCode, isWireError } from "../registry/protocol";
import { workspacePlugin } from "../workspace";
import type { GameViewCtx } from "./types";

/**
 * The message of anything thrown.
 *
 * @param error - An Error, a WireError or anything else.
 * @returns The message text.
 * @example
 * ```ts
 * messageOf(new Error("[moku-editor] offline")); // "[moku-editor] offline"
 * ```
 */
export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (isWireError(error)) return error.message;
  return String(error);
}

/**
 * The first line of a message without the `[moku-editor]` prefix, for the UI.
 *
 * @param error - Anything thrown.
 * @returns One line of bare text.
 * @example
 * ```ts
 * uiMessage(new Error("[moku-editor] A is invalid.\n  Use B.")); // "A is invalid."
 * ```
 */
export function uiMessage(error: unknown): string {
  return bareMessage(messageOf(error)).split("\n")[0] ?? "";
}

/**
 * True for a version-conflict rejection (-32005).
 *
 * @param error - A rejection of the files client.
 * @returns Whether the file changed since it was read.
 * @example
 * ```ts
 * isConflict({ code: -32_005, message: "[moku-editor] changed" }); // true
 * ```
 */
export function isConflict(error: unknown): boolean {
  return isWireError(error) && error.code === errorCode.versionConflict;
}

/**
 * Toasts `<what> · <bare message>` and logs the event with the code and the full message.
 *
 * @param ctx - Domain context of gameView.
 * @param what - The first words of the toast, e.g. "Screenshot failed".
 * @param event - The log event, e.g. "gameView: capture failed".
 * @param error - What was thrown.
 * @example
 * ```ts
 * reportFailure(ctx, "Screenshot failed", "gameView: capture failed", error); // toast "Screenshot failed · timeout"
 * ```
 */
export function reportFailure(ctx: GameViewCtx, what: string, event: string, error: unknown): void {
  ctx.require(workspacePlugin).toast(`${what} · ${uiMessage(error)}`);
  ctx.log.warn(event, {
    code: isWireError(error) ? error.code : undefined,
    message: messageOf(error)
  });
}

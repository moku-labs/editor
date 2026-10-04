/**
 * @file gameView plugin — one failure path for every capture, series, sheet and style
 * write: a toast with the bare message (R7: no `[moku-editor]` prefix in the UI) and a log entry
 * that keeps the full message and the wire code.
 */

import { bareMessage, isWireError } from "../registry/protocol";
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
 * Toasts `<what> · <bare message>` and logs the event with the code and the full message.
 *
 * @param ctx - Domain context of gameView.
 * @param what - The first words of the toast, e.g. "Screenshot failed".
 * @param event - The log event, e.g. "gameView: capture failed".
 * @param error - What was thrown.
 */
export function reportFailure(ctx: GameViewCtx, what: string, event: string, error: unknown): void {
  ctx.require(workspacePlugin).toast(`${what} · ${uiMessage(error)}`);
  ctx.log.warn(event, {
    code: isWireError(error) ? error.code : undefined,
    message: messageOf(error)
  });
}

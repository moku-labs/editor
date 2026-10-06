/**
 * @file gameView plugin — one failure path for every capture, series, sheet and style
 * write: a toast with the bare message (R7: no `[moku-editor]` prefix in the UI) and a log entry
 * that keeps the full message and the wire code; and the log level of a read that failed because
 * the link or the game page went away (U11), or failed inside an expected reload.
 */

import { linkPlugin } from "../link";
import { bareMessage, type ErrorReason, isReloading, isWireError } from "../registry/protocol";
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
 * The reasons a read fails when the link or the game page went away: a restart of the editor
 * server or a game reload. Both heal on their own, so they are not warnings (U11).
 */
const LOST_REASONS: ReadonlySet<ErrorReason> = new Set(["link_closed", "game_reloaded"]);

/**
 * True when a read failed because the link closed or the game page reloaded.
 *
 * @param error - Anything thrown.
 * @returns Whether its wire reason is `link_closed` or `game_reloaded`.
 * @example
 * ```ts
 * isLinkLoss(wireError(errorCode.timeout, "The link closed.", { reason: "link_closed" })); // true
 * isLinkLoss(new Error("no value")); // false
 * ```
 */
export function isLinkLoss(error: unknown): boolean {
  if (!isWireError(error)) return false;
  const reason = error.data?.reason;
  return reason !== undefined && LOST_REASONS.has(reason);
}

/**
 * Logs a failed read with its message: at debug when the link or the game page went away
 * (`isLinkLoss`) or the link is inside an expected reload (`isReloading`: the Hot reload switch,
 * a server restart; a read there fails with any reason, e.g. -32003 before the game is back), at
 * warn otherwise.
 *
 * @param ctx - Domain context of gameView.
 * @param event - The log event, e.g. "gameView: calibration failed".
 * @param error - What was thrown.
 * @param fields - More log fields, e.g. the key read.
 */
export function logReadFailure(
  ctx: Pick<GameViewCtx, "log" | "require">,
  event: string,
  error: unknown,
  fields: Readonly<Record<string, string>> = {}
): void {
  const data = { ...fields, message: messageOf(error) };
  const isExpected = isLinkLoss(error) || isReloading(ctx.require(linkPlugin).status());
  if (isExpected) ctx.log.debug(event, data);
  else ctx.log.warn(event, data);
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

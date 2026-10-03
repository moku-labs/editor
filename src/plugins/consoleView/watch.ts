/**
 * @file consoleView plugin — the data path (R6): one link.watch("game.log") for the session; each
 * delivered value is ingested with the frame of link.status(). readOnce is the manual refresh.
 * No timer, no heartbeat-driven read.
 */
import { linkPlugin } from "../link";
import type { Json } from "../registry/protocol";
import { pushBadge } from "./badge";
import { ingestTrace } from "./ingest";
import { statusFrame } from "./lines";
import { notify } from "./state";
import type { ConsoleCtx } from "./types";

/**
 * Ingests one game.log value: warns on a value of the wrong shape, pushes the badge when the
 * lines changed, marks the console connected and notifies the view.
 *
 * @param ctx - Domain context of consoleView.
 * @param value - The game.log value.
 * @example
 * ```ts
 * accept(ctx, designLog); // 8 lines, badge "2 warn"
 * ```
 */
function accept(ctx: ConsoleCtx, value: Json): void {
  const { state, config } = ctx;
  const frame = statusFrame(ctx.require(linkPlugin).status());
  const result = ingestTrace(state, value, frame, config);
  if (result.invalid === true) {
    ctx.log.warn("consoleView:unexpected-log", { type: typeof value });
    return;
  }

  state.everConnected = true;
  if (result.changed) pushBadge(ctx);
  notify(state);
}

/**
 * The JSON-RPC code of a thrown value, if it has one.
 *
 * @param error - Anything thrown.
 * @returns The code, or undefined.
 * @example
 * ```ts
 * codeOf(new ProtocolError(-32001, "[moku-editor] no session")); // -32001
 * ```
 */
function codeOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "number" ? error.code : undefined;
}

/**
 * Watches game.log for the session. link keeps the watch while disconnected and re-sends it
 * after every reconnect and session change (R4), so a new game's trace arrives on its own.
 *
 * @param ctx - Domain context of consoleView.
 * @returns The unsubscribe.
 * @example
 * ```ts
 * ctx.state.stopLog = startLogWatch(ctx); // one game.log watch for the session
 * ```
 */
export function startLogWatch(ctx: ConsoleCtx): () => void {
  return ctx.require(linkPlugin).watch("game.log", undefined, value => accept(ctx, value));
}

/**
 * Reads game.log once and ingests it (refresh). A failed read logs
 * `consoleView:read-failed` at debug level: a missing session is normal between games.
 *
 * @param ctx - Domain context of consoleView.
 * @returns Resolves when the read settled; never rejects.
 * @example
 * ```ts
 * await readOnce(ctx); // ingest is idempotent: no line is added twice
 * ```
 */
export async function readOnce(ctx: ConsoleCtx): Promise<void> {
  try {
    accept(ctx, await ctx.require(linkPlugin).read("game.log"));
  } catch (error) {
    ctx.log.debug("consoleView:read-failed", { code: codeOf(error) });
  }
}

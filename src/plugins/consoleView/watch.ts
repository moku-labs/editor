/**
 * @file consoleView plugin — the data path (R6): one link.watch("game.log") for the session; each
 * delivered value is ingested with the frame of link.status(). readOnce is the manual refresh.
 * No timer, no heartbeat-driven read. Each entry point resolves link once and passes it down.
 */
import { linkPlugin } from "../link";
import type { LinkApi } from "../link/types";
import type { Json } from "../registry/protocol";
import { pushBadge } from "./badge";
import { ingestTrace } from "./ingest";
import { statusFrame } from "./lines";
import { notify } from "./state";
import type { ConsoleCtx } from "./types";

/**
 * Ingests one game.log value with the frame of `link.status()` and the session of
 * `link.session()` (the one source of the session): warns on a value of the wrong shape, pushes the badge when the
 * lines changed, marks the console connected and notifies the view.
 *
 * @param ctx - Domain context of consoleView.
 * @param link - The link API, resolved once by the caller.
 * @param value - The game.log value.
 */
function accept(ctx: ConsoleCtx, link: LinkApi, value: Json): void {
  const { state, config } = ctx;
  const result = ingestTrace(state, value, statusFrame(link.status()), config, link.session());
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
 */
export function startLogWatch(ctx: ConsoleCtx): () => void {
  const link = ctx.require(linkPlugin);
  return link.watch("game.log", undefined, value => accept(ctx, link, value));
}

/**
 * Reads game.log once and ingests it (refresh). A failed read logs
 * `consoleView:read-failed` at debug level: a missing session is normal between games.
 *
 * @param ctx - Domain context of consoleView.
 * @returns Resolves when the read settled; never rejects.
 */
export async function readOnce(ctx: ConsoleCtx): Promise<void> {
  try {
    const link = ctx.require(linkPlugin);
    accept(ctx, link, await link.read("game.log"));
  } catch (error) {
    ctx.log.debug("consoleView:read-failed", { code: codeOf(error) });
  }
}

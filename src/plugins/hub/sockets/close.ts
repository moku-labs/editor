/**
 * @file hub plugin — closeAll: closes every open socket with one code and reason while the hub
 * keeps running (the bin's restart, U11). The token stays; the websocket handler's close forgets
 * each connection when Bun reports it, so sessions and subscriptions end as on any close.
 */
import type { HubCtx } from "../types";

/** The longest wait for Bun to report the closes, in ms: a client that never answers is dropped. */
export const CLOSE_WAIT_MS = 500;

/** How often the wait looks at the open connections, in ms. */
const POLL_MS = 10;

/**
 * Closes every agent and tools socket with `code` and `reason`, logged at info, then waits until
 * Bun reported each close (the connection is forgotten) or `waitMs` passed. A server stopped
 * before that drops the close frame, and the client sees 1006 instead of the code. The sockets
 * are read first: a close callback that runs at once cannot change the walk.
 *
 * @param ctx - Domain context of the hub.
 * @param code - The close code, e.g. 1012 (service restart).
 * @param reason - The close reason the clients see.
 * @param waitMs - The longest wait for the closes.
 * @returns When every socket closed, or the wait ran out.
 * @example
 * ```ts
 * await closeAll(ctx, 1012, "editor restarting"); // then the server may stop
 * ```
 */
export async function closeAll(
  ctx: HubCtx,
  code: number,
  reason: string,
  waitMs = CLOSE_WAIT_MS
): Promise<void> {
  const conns = [...ctx.state.conns.entries()];
  ctx.log.info("hub:close-all", { code, reason, sockets: conns.length });
  for (const [, conn] of conns) conn.socket.close(code, reason);

  // Wait for Bun's close of each socket: the handler deletes its connection.
  const deadline = Date.now() + waitMs;
  const isOpen = (): boolean => conns.some(([id]) => ctx.state.conns.has(id));
  while (isOpen() && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
  }
}

/**
 * @file hub plugin — closeAll: closes every open socket with one code and reason while the hub
 * keeps running (the bin's restart, U11). The token stays; the websocket handler's close forgets
 * each connection when Bun reports it, so sessions and subscriptions end as on any close.
 */
import type { HubCtx } from "../types";

/**
 * Closes every agent and tools socket with `code` and `reason`, logged at info. The sockets are
 * read first: a close callback that runs at once cannot change the walk.
 *
 * @param ctx - Domain context of the hub.
 * @param code - The close code, e.g. 1012 (service restart).
 * @param reason - The close reason the clients see.
 */
export function closeAll(ctx: HubCtx, code: number, reason: string): void {
  const sockets = [...ctx.state.conns.values()].map(conn => conn.socket);
  ctx.log.info("hub:close-all", { code, reason, sockets: sockets.length });

  for (const socket of sockets) socket.close(code, reason);
}

/**
 * @file link plugin — api factory: composes the remote channel, sessions, boot and files client.
 */
import type { LinkApi, LinkCtx } from "./types";

/**
 * Creates the link api.
 *
 * @param _ctx - Domain context of link.
 * @example
 * ```ts
 * const link = createLinkApi(ctx);
 * link.watch("game.history", { last: 20 }, history => draw(history));
 * ```
 */
export function createLinkApi(_ctx: LinkCtx): LinkApi {
  throw new Error("not implemented");
}

/**
 * @file hub plugin — server state pushed to the tools pages: `publish` sends an editor-channel
 * notification to every tools connection and keeps the last value per method; a tools connection
 * that opens later gets every kept value right after its `sessions {list}` (R6).
 */
import type { HotReload, Json } from "../../registry/protocol";
import { notification } from "../../registry/protocol";
import { sendJson, toolsConns } from "../sockets/send";
import type { HubCtx, HubState, PublishMethod, ToolsConn } from "../types";

/**
 * The params of a published `hotReload`: a fresh plain copy of the two fields.
 *
 * @param state - The hot reload state.
 * @returns The Json params.
 * @example
 * ```ts
 * hotReloadParams({ hmr: true, owner: "bin" }); // { hmr: true, owner: "bin" }
 * ```
 */
function hotReloadParams(state: HotReload): Json {
  return { hmr: state.hmr, owner: state.owner };
}

/**
 * Keeps the value of a method and sends `editor.<method>` to every open tools connection. A
 * state notification is never dropped: it goes out congested or not.
 *
 * @param ctx - Domain context of the hub.
 * @param method - The published method.
 * @param params - Its value.
 */
export function publish(ctx: HubCtx, method: PublishMethod, params: HotReload): void {
  const value = hotReloadParams(params);
  ctx.state.published.set(method, value);

  const note = notification("editor", method, value);
  for (const conn of toolsConns(ctx.state)) sendJson(conn, note);
  ctx.log.debug("hub:published", { method });
}

/**
 * Sends every kept value to one tools connection, in the order they were first published.
 *
 * @param state - Hub state.
 * @param conn - The tools connection that just opened.
 */
export function replayPublished(state: HubState, conn: ToolsConn): void {
  for (const [method, value] of state.published) {
    sendJson(conn, notification("editor", method, value));
  }
}

/**
 * @file hub plugin — server state pushed to the tools pages: `publish` sends an editor-channel
 * notification to every tools connection and keeps the last value per method; a tools connection
 * that opens later gets every kept value right after its `sessions {list}` (R6). Values are kept
 * through `toWireValue` (A5). A `null` value (nothing selected) goes out without params, since the
 * wire refuses null params.
 */
import type { Json, Notification, PublishParams } from "../../registry/protocol";
import { notification, toWireValue } from "../../registry/protocol";
import { sendJson, toolsConns } from "../sockets/send";
import type { HubCtx, HubState, PublishMethod, ToolsConn } from "../types";

/**
 * The editor-channel notification of a kept value; `null` is sent without params.
 *
 * @param method - The published method.
 * @param value - Its kept value.
 * @returns The notification.
 * @example
 * ```ts
 * publishedNote("selection", null); // { jsonrpc: "2.0", channel: "editor", method: "selection" }
 * ```
 */
function publishedNote(method: PublishMethod, value: Json): Notification {
  return value === null ? notification("editor", method) : notification("editor", method, value);
}

/**
 * Keeps the value of a method and sends `editor.<method>` to every open tools connection. A
 * state notification is never dropped: it goes out congested or not.
 *
 * @param ctx - Domain context of the hub.
 * @param method - The published method.
 * @param params - Its value.
 */
export function publish<M extends PublishMethod>(
  ctx: HubCtx,
  method: M,
  params: PublishParams[M]
): void {
  const value = toWireValue(params);
  ctx.state.published.set(method, value);

  const note = publishedNote(method, value);
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
  for (const [method, value] of state.published) sendJson(conn, publishedNote(method, value));
}

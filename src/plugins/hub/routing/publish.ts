/**
 * @file hub plugin — server state pushed to the tools pages: `publish` sends an editor-channel
 * notification to every tools connection and keeps the last value per method; a tools connection
 * that opens later gets every kept value right after its `sessions {list}` (R6). Values are kept
 * through `toWireValue` (A5). A `null` value (nothing selected) goes out without params, since the
 * wire refuses null params.
 */
import type { Json, Notification, PublishParams } from "../../registry/protocol";
import { encode, notification, toWireValue } from "../../registry/protocol";
import { sendJson, toolsConns } from "../sockets/send";
import type { HubCtx, HubState, PublishMethod, ToolsConn } from "../types";

/**
 * UTF-8 encoder of the frame size the `project` debug line reports.
 */
const ENCODER = new TextEncoder();

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
 * state notification is never dropped: it goes out congested or not. The debug line of a
 * `project` state also names its frame size and how many tools connections got it: the project
 * state is the largest value the hub publishes.
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
  const conns = toolsConns(ctx.state);
  for (const conn of conns) sendJson(conn, note);

  if (method !== "project") {
    ctx.log.debug("hub:published", { method });
    return;
  }
  const bytes = ENCODER.encode(encode(note)).byteLength;
  ctx.log.debug("hub:published", { method, bytes, conns: conns.length });
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

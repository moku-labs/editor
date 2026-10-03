/**
 * @file hub plugin — sending to sockets with backpressure: `send` returning -1 marks a tools conn
 * congested; while congested, values coalesce to the latest per sub, heartbeats are dropped, and
 * responses and session notifications are still sent. `drain` flushes the backlog in order.
 */
import type { Json, Message, SubId } from "../../registry/protocol";
import { encode, notification } from "../../registry/protocol";
import type { Conn, HubState, ToolsConn } from "../types";

/**
 * What `socket.send` returns under backpressure.
 */
const BACKPRESSURE = -1;

/**
 * Strikes before a connection is closed for invalid messages (undecodable or malformed).
 */
const MAX_INVALID = 10;

/**
 * The JSON null (an empty result, no input, no heartbeat yet).
 */
// eslint-disable-next-line unicorn/no-null -- null is the JSON value the wire carries
export const JSON_NULL = null;

/**
 * Sends a message; a tools conn under backpressure becomes congested. A 0 (socket closing) is
 * ignored.
 *
 * @param conn - The connection.
 * @param message - The wire message.
 */
export function sendJson(conn: Conn, message: Message): void {
  const sent = conn.socket.send(encode(message));
  if (sent === BACKPRESSURE && conn.kind === "tools") conn.congested = true;
}

/**
 * Sends a message that may be lost (a heartbeat): dropped while the conn is congested.
 *
 * @param conn - The tools connection.
 * @param message - The wire message.
 */
export function sendDroppable(conn: ToolsConn, message: Message): void {
  if (!conn.congested) sendJson(conn, message);
}

/**
 * Sends a `value` notification of a tools sub; while congested only the latest value per sub is
 * kept in the backlog.
 *
 * @param conn - The tools connection.
 * @param sub - The tools sub id.
 * @param session - The session the value comes from.
 * @param value - The value.
 */
export function sendValue(conn: ToolsConn, sub: SubId, session: string, value: Json): void {
  if (conn.congested) {
    conn.backlog.set(sub, { session, value });
    return;
  }
  sendJson(conn, notification("game", "value", { sub, value }, session));
}

/**
 * The `drain` step: clears congestion and sends the backlog in insertion order; a value that hits
 * backpressure again keeps the rest in the backlog.
 *
 * @param conn - The tools connection.
 */
export function flushBacklog(conn: ToolsConn): void {
  conn.congested = false;
  const entries = [...conn.backlog];
  conn.backlog.clear();

  for (const [sub, { session, value }] of entries) sendValue(conn, sub, session, value);
}

/**
 * Every open tools connection.
 *
 * @param state - Hub state.
 * @returns The tools conns, in connection order.
 */
export function toolsConns(state: HubState): ToolsConn[] {
  return [...state.conns.values()].filter(conn => conn.kind === "tools");
}

/**
 * The open tools connection with a number, or undefined.
 *
 * @param state - Hub state.
 * @param conn - Connection number.
 * @returns The tools conn.
 */
export function toolsConn(state: HubState, conn: number): ToolsConn | undefined {
  const found = state.conns.get(conn);
  return found?.kind === "tools" ? found : undefined;
}

/**
 * Counts one invalid message of a connection; the tenth closes it with 1008.
 *
 * @param conn - The connection.
 */
export function strike(conn: Conn): void {
  conn.invalid += 1;
  if (conn.invalid >= MAX_INVALID) conn.socket.close(1008, "too many invalid messages");
}

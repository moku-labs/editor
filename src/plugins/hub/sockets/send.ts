/**
 * @file hub plugin — sockets/send.ts (skeleton stubs, implemented in its wave).
 */
import type { Json, Message, SubId } from "../../registry/protocol";
import type { Conn, ToolsConn } from "../types";

/**
 * Skeleton stub for `sendJson`; implemented in its wave.
 *
 * @param _conn - The conn.
 * @param _message - The message.
 * @example
 * ```ts
 * sendJson();
 * ```
 */
export function sendJson(_conn: Conn, _message: Message): void {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `sendValue`; implemented in its wave.
 *
 * @param _conn - The conn.
 * @param _sub - The sub.
 * @param _session - The session.
 * @param _value - The value.
 * @example
 * ```ts
 * sendValue();
 * ```
 */
export function sendValue(_conn: ToolsConn, _sub: SubId, _session: string, _value: Json): void {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `flushBacklog`; implemented in its wave.
 *
 * @param _conn - The conn.
 * @example
 * ```ts
 * flushBacklog();
 * ```
 */
export function flushBacklog(_conn: ToolsConn): void {
  throw new Error("not implemented");
}

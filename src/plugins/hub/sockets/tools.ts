/**
 * @file hub plugin — sockets/tools.ts (skeleton stubs, implemented in its wave).
 */

import type { Message } from "../../registry/protocol";
import type { HubCtx, ToolsConn } from "../types";

/**
 * Skeleton stub for `onToolsMessage`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _conn - The conn.
 * @param _message - The message.
 * @example
 * ```ts
 * onToolsMessage();
 * ```
 */
export function onToolsMessage(_ctx: HubCtx, _conn: ToolsConn, _message: Message): void {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `onToolsClose`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _conn - The conn.
 * @example
 * ```ts
 * onToolsClose();
 * ```
 */
export function onToolsClose(_ctx: HubCtx, _conn: ToolsConn): void {
  throw new Error("not implemented");
}

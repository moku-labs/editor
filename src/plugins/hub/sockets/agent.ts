/**
 * @file hub plugin — sockets/agent.ts (skeleton stubs, implemented in its wave).
 */

import type { Message } from "../../registry/protocol";
import type { AgentConn, HubCtx } from "../types";

/**
 * Skeleton stub for `onAgentMessage`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _conn - The conn.
 * @param _message - The message.
 * @example
 * ```ts
 * onAgentMessage();
 * ```
 */
export function onAgentMessage(_ctx: HubCtx, _conn: AgentConn, _message: Message): void {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `onAgentClose`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _conn - The conn.
 * @example
 * ```ts
 * onAgentClose();
 * ```
 */
export function onAgentClose(_ctx: HubCtx, _conn: AgentConn): void {
  throw new Error("not implemented");
}

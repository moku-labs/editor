/**
 * @file hub plugin — routing/subscriptions.ts (skeleton stubs, implemented in its wave).
 */

import type { Json, SubId, WatchParams } from "../../registry/protocol";
import type { HubCtx, Session, ToolsConn } from "../types";

/**
 * Skeleton stub for `watch`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _conn - The conn.
 * @param _toolsId - The toolsId.
 * @param _session - The session.
 * @param _params - The params.
 * @example
 * ```ts
 * watch();
 * ```
 */
export function watch(
  _ctx: HubCtx,
  _conn: ToolsConn,
  _toolsId: number,
  _session: Session,
  _params: WatchParams
): void {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `unwatch`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _conn - The conn.
 * @param _sub - The sub.
 * @example
 * ```ts
 * unwatch();
 * ```
 */
export function unwatch(_ctx: HubCtx, _conn: ToolsConn, _sub: SubId): void {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `onAgentValue`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _session - The session.
 * @param _agentSub - The agentSub.
 * @param _value - The value.
 * @example
 * ```ts
 * onAgentValue();
 * ```
 */
export function onAgentValue(
  _ctx: HubCtx,
  _session: Session,
  _agentSub: SubId,
  _value: Json
): void {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `dropToolsConn`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _conn - The conn.
 * @example
 * ```ts
 * dropToolsConn();
 * ```
 */
export function dropToolsConn(_ctx: HubCtx, _conn: ToolsConn): void {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `dropSession`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _session - The session.
 * @example
 * ```ts
 * dropSession();
 * ```
 */
export function dropSession(_ctx: HubCtx, _session: Session): void {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `subKey`; implemented in its wave.
 *
 * @param _session - The session.
 * @param _sourceId - The sourceId.
 * @param _input - The input.
 * @example
 * ```ts
 * subKey();
 * ```
 */
export function subKey(_session: string, _sourceId: string, _input: Json | null): string {
  throw new Error("not implemented");
}

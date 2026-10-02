/**
 * @file link plugin — rpc/calls.ts (skeleton stubs, implemented in its wave).
 */

import type { Channel, Json, Response as RpcResponse, WireError } from "../../registry/protocol";
import type { LinkCtx } from "../types";

/**
 * Skeleton stub for `request`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _channel - The channel.
 * @param _method - The method.
 * @param _params - The params.
 * @param _session - The session.
 * @example
 * ```ts
 * request();
 * ```
 */
export function request(
  _ctx: LinkCtx,
  _channel: Channel,
  _method: string,
  _params: Json | undefined,
  _session?: string
): Promise<Json> {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `settle`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _response - The response.
 * @example
 * ```ts
 * settle();
 * ```
 */
export function settle(_ctx: LinkCtx, _response: RpcResponse): void {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `failAll`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _error - The error.
 * @example
 * ```ts
 * failAll();
 * ```
 */
export function failAll(_ctx: LinkCtx, _error: Error & WireError): void {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `timeoutFor`; implemented in its wave.
 *
 * @param _method - The method.
 * @param _params - The params.
 * @example
 * ```ts
 * timeoutFor();
 * ```
 */
export function timeoutFor(_method: string, _params: Json | undefined): number {
  throw new Error("not implemented");
}

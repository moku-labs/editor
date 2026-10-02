/**
 * @file hub plugin — routing/calls.ts (skeleton stubs, implemented in its wave).
 */
import type { Json, Response as RpcResponse } from "../../registry/protocol";
import type { HubCtx, Reply, Session } from "../types";

/**
 * Skeleton stub for `forward`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _session - The session.
 * @param _method - The method.
 * @param _params - The params.
 * @param _reply - The reply.
 * @example
 * ```ts
 * forward();
 * ```
 */
export function forward(
  _ctx: HubCtx,
  _session: Session,
  _method: string,
  _params: Json | undefined,
  _reply: Reply
): void {
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
export function settle(_ctx: HubCtx, _response: RpcResponse): void {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `failSession`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _id - The id.
 * @example
 * ```ts
 * failSession();
 * ```
 */
export function failSession(_ctx: HubCtx, _id: string): void {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `deadlineFor`; implemented in its wave.
 *
 * @param _method - The method.
 * @param _params - The params.
 * @param _callTimeoutMs - The callTimeoutMs.
 * @example
 * ```ts
 * deadlineFor();
 * ```
 */
export function deadlineFor(
  _method: string,
  _params: Json | undefined,
  _callTimeoutMs: number
): number {
  throw new Error("not implemented");
}

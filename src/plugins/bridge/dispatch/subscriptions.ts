/**
 * @file bridge plugin — dispatch/subscriptions.ts (skeleton stubs, implemented in its wave).
 */

import type { Json, Request as RpcRequest, SubId, WatchParams } from "../../registry/protocol";
import type { BridgeDeps } from "../types";

/**
 * Skeleton stub for `subscribe`; implemented in its wave.
 *
 * @param _deps - The deps.
 * @param _request - The request.
 * @param _params - The params.
 * @example
 * ```ts
 * subscribe();
 * ```
 */
export function subscribe(
  _deps: BridgeDeps,
  _request: RpcRequest,
  _params: WatchParams
): Promise<void> {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `unsubscribe`; implemented in its wave.
 *
 * @param _deps - The deps.
 * @param _sub - The sub.
 * @example
 * ```ts
 * unsubscribe();
 * ```
 */
export function unsubscribe(_deps: BridgeDeps, _sub: SubId): void {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `dropAll`; implemented in its wave.
 *
 * @param _deps - The deps.
 * @example
 * ```ts
 * dropAll();
 * ```
 */
export function dropAll(_deps: BridgeDeps): void {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `sampleFrames`; implemented in its wave.
 *
 * @param _deps - The deps.
 * @example
 * ```ts
 * sampleFrames();
 * ```
 */
export function sampleFrames(_deps: BridgeDeps): void {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `refreshAll`; implemented in its wave.
 *
 * @param _deps - The deps.
 * @example
 * ```ts
 * refreshAll();
 * ```
 */
export function refreshAll(_deps: BridgeDeps): void {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `pushValue`; implemented in its wave.
 *
 * @param _deps - The deps.
 * @param _sub - The sub.
 * @param _value - The value.
 * @example
 * ```ts
 * pushValue();
 * ```
 */
export function pushValue(_deps: BridgeDeps, _sub: SubId, _value: Json): void {
  throw new Error("not implemented");
}

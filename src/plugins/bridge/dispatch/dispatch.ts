/**
 * @file bridge plugin — dispatch/dispatch.ts (skeleton stubs, implemented in its wave).
 */

import type { Request as RpcRequest } from "../../registry/protocol";
import type { BridgeDeps } from "../types";

/**
 * Skeleton stub for `handleText`; implemented in its wave.
 *
 * @param _deps - The deps.
 * @param _data - The data.
 * @example
 * ```ts
 * handleText();
 * ```
 */
export function handleText(_deps: BridgeDeps, _data: unknown): void {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `handleRequest`; implemented in its wave.
 *
 * @param _deps - The deps.
 * @param _request - The request.
 * @example
 * ```ts
 * handleRequest();
 * ```
 */
export function handleRequest(_deps: BridgeDeps, _request: RpcRequest): Promise<void> {
  throw new Error("not implemented");
}

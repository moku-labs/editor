/**
 * @file bridge plugin — status.ts (skeleton stubs, implemented in its wave).
 */
import type { LinkStatus } from "../registry/protocol";
import type { BridgeDeps } from "./types";

/**
 * Skeleton stub for `currentStatus`; implemented in its wave.
 *
 * @param _deps - The deps.
 * @example
 * ```ts
 * currentStatus();
 * ```
 */
export function currentStatus(_deps: BridgeDeps): LinkStatus {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `setStatus`; implemented in its wave.
 *
 * @param _deps - The deps.
 * @param _next - The next.
 * @example
 * ```ts
 * setStatus();
 * ```
 */
export function setStatus(_deps: BridgeDeps, _next: LinkStatus): void {
  throw new Error("not implemented");
}

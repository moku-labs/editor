/**
 * @file bridge plugin — connection/loop.ts (skeleton stubs, implemented in its wave).
 */
import type { BridgeDeps } from "../types";

/**
 * Skeleton stub for `connect`; implemented in its wave.
 *
 * @param _deps - The deps.
 * @example
 * ```ts
 * connect();
 * ```
 */
export function connect(_deps: BridgeDeps): Promise<void> {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `onOpen`; implemented in its wave.
 *
 * @param _deps - The deps.
 * @example
 * ```ts
 * onOpen();
 * ```
 */
export function onOpen(_deps: BridgeDeps): void {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `onClose`; implemented in its wave.
 *
 * @param _deps - The deps.
 * @param _code - The code.
 * @param _reason - The reason.
 * @example
 * ```ts
 * onClose();
 * ```
 */
export function onClose(_deps: BridgeDeps, _code: number, _reason: string): void {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `fail`; implemented in its wave.
 *
 * @param _deps - The deps.
 * @param _reason - The reason.
 * @param _retry - The retry.
 * @example
 * ```ts
 * fail();
 * ```
 */
export function fail(_deps: BridgeDeps, _reason: string, _retry: boolean): void {
  throw new Error("not implemented");
}

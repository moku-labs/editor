/**
 * @file stateView plugin — model.ts (skeleton stubs, implemented in its wave).
 */
import type { LinkStatus } from "../registry/protocol";
import type { ModelSnapshot } from "./types";

/**
 * Skeleton stub for `isModelSnapshot`; implemented in its wave.
 *
 * @param _value - The value.
 * @example
 * ```ts
 * isModelSnapshot();
 * ```
 */
export function isModelSnapshot(_value: unknown): _value is ModelSnapshot {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `frameOf`; implemented in its wave.
 *
 * @param _status - The status.
 * @example
 * ```ts
 * frameOf();
 * ```
 */
export function frameOf(_status: LinkStatus): number | undefined {
  throw new Error("not implemented");
}

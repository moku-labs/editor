/**
 * @file capture plugin — shot.ts (skeleton stubs, implemented in its wave).
 */
import type { RunState } from "../registry/protocol";
import type { CaptureRegistry } from "./types";

/**
 * Skeleton stub for `takeShot`; implemented in its wave.
 *
 * @param _registry - The registry.
 * @example
 * ```ts
 * takeShot();
 * ```
 */
export function takeShot(_registry: CaptureRegistry): Promise<{ image: string; state: RunState }> {
  throw new Error("not implemented");
}

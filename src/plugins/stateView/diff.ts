/**
 * @file stateView plugin — diff.ts (skeleton stubs, implemented in its wave).
 */
import type { Json } from "../registry/protocol";
import type { StatePatch } from "./types";

/**
 * Skeleton stub for `diffJson`; implemented in its wave.
 *
 * @param _previous - The previous.
 * @param _next - The next.
 * @param _root - The root.
 * @param _max - The max.
 * @example
 * ```ts
 * diffJson();
 * ```
 */
export function diffJson(
  _previous: Json,
  _next: Json,
  _root: "player" | "session",
  _max: number
): { patches: StatePatch[]; truncated: number } {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `pointerOf`; implemented in its wave.
 *
 * @param _root - The root.
 * @param _path - The path.
 * @example
 * ```ts
 * pointerOf();
 * ```
 */
export function pointerOf(
  _root: "player" | "session",
  _path: readonly (string | number)[]
): string {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `deepEqual`; implemented in its wave.
 *
 * @param _a - The a.
 * @param _b - The b.
 * @example
 * ```ts
 * deepEqual();
 * ```
 */
export function deepEqual(_a: Json | undefined, _b: Json | undefined): boolean {
  throw new Error("not implemented");
}

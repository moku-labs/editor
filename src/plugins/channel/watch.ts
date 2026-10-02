/**
 * @file channel plugin — watch.ts (skeleton stubs, implemented in its wave).
 */
import type { Json } from "../registry/protocol";
import type { ChannelDeps } from "./types";

/**
 * Skeleton stub for `openWatch`; implemented in its wave.
 *
 * @param _deps - The deps.
 * @param _id - The id.
 * @param _input - The input.
 * @param _onValue - The onValue.
 * @example
 * ```ts
 * openWatch();
 * ```
 */
export function openWatch(
  _deps: ChannelDeps,
  _id: string,
  _input: Json | undefined,
  _onValue: (value: Json) => void
): () => void {
  throw new Error("not implemented");
}

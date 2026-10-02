/**
 * @file link plugin — subscriptions/watch.ts (skeleton stubs, implemented in its wave).
 */

import type { Json, SubId } from "../../registry/protocol";
import type { LinkCtx } from "../types";

/**
 * Skeleton stub for `addWatch`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _id - The id.
 * @param _input - The input.
 * @param _onValue - The onValue.
 * @example
 * ```ts
 * addWatch();
 * ```
 */
export function addWatch(
  _ctx: LinkCtx,
  _id: string,
  _input: Json | undefined,
  _onValue: (value: Json) => void
): () => void {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `resubscribeAll`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @example
 * ```ts
 * resubscribeAll();
 * ```
 */
export function resubscribeAll(_ctx: LinkCtx): void {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `detachAll`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @example
 * ```ts
 * detachAll();
 * ```
 */
export function detachAll(_ctx: LinkCtx): void {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `deliver`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _sub - The sub.
 * @param _value - The value.
 * @example
 * ```ts
 * deliver();
 * ```
 */
export function deliver(_ctx: LinkCtx, _sub: SubId, _value: Json): void {
  throw new Error("not implemented");
}

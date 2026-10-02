/**
 * @file stateView plugin — tracker.ts (skeleton stubs, implemented in its wave).
 */
import type { Json } from "../registry/protocol";
import type { StateViewCtx, StateViewState } from "./types";

/**
 * Skeleton stub for `acceptModel`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _value - The value.
 * @example
 * ```ts
 * acceptModel();
 * ```
 */
export function acceptModel(_ctx: StateViewCtx, _value: Json): void {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `acceptTainted`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _value - The value.
 * @example
 * ```ts
 * acceptTainted();
 * ```
 */
export function acceptTainted(_ctx: StateViewCtx, _value: Json): void {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `resetTracker`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _reason - The reason.
 * @example
 * ```ts
 * resetTracker();
 * ```
 */
export function resetTracker(_ctx: StateViewCtx, _reason: "waiting" | "reloaded"): void {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `loadGraph`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @example
 * ```ts
 * loadGraph();
 * ```
 */
export function loadGraph(_ctx: StateViewCtx): Promise<void> {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `notify`; implemented in its wave.
 *
 * @param _state - The state.
 * @example
 * ```ts
 * notify();
 * ```
 */
export function notify(_state: StateViewState): void {
  throw new Error("not implemented");
}

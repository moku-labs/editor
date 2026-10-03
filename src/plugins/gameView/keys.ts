/**
 * @file gameView plugin — keys.ts (skeleton stubs, implemented in its wave).
 */
import type { EscLayer, KeyBinding } from "../workspace/types";
import type { GameViewCtx } from "./types";

/**
 * Skeleton stub for `keyBindings`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @example
 * ```ts
 * keyBindings();
 * ```
 */
export function keyBindings(_ctx: GameViewCtx): readonly KeyBinding[] {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `escapeClosers`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @example
 * ```ts
 * escapeClosers();
 * ```
 */
export function escapeClosers(
  _ctx: GameViewCtx
): readonly { readonly layer: EscLayer; readonly close: () => boolean }[] {
  throw new Error("not implemented");
}

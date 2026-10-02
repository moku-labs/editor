/**
 * @file workspace plugin — keys/keymap.ts (skeleton stubs, implemented in its wave).
 */
import type { KeyBinding, ParsedCombo, WorkspaceCtx } from "../types";

/**
 * Skeleton stub for `parseCombo`; implemented in its wave.
 *
 * @param _combo - The combo.
 * @example
 * ```ts
 * parseCombo();
 * ```
 */
export function parseCombo(_combo: string): ParsedCombo {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `bindKey`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _binding - The binding.
 * @example
 * ```ts
 * bindKey();
 * ```
 */
export function bindKey(_ctx: WorkspaceCtx, _binding: KeyBinding): () => void {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `dispatchKey`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _event - The event.
 * @example
 * ```ts
 * dispatchKey();
 * ```
 */
export function dispatchKey(_ctx: WorkspaceCtx, _event: KeyboardEvent): boolean {
  throw new Error("not implemented");
}

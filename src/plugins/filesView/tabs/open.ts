/**
 * @file filesView plugin — tabs/open.ts (skeleton stubs, implemented in its wave).
 */
import type { FilesViewCtx } from "../types";

/**
 * Skeleton stub for `openTab`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _path - The path.
 * @param _options - The options.
 * @param _options.line - The line.
 * @param _options.edit - The edit.
 * @example
 * ```ts
 * openTab();
 * ```
 */
export function openTab(
  _ctx: FilesViewCtx,
  _path: string,
  _options: { readonly line?: number; readonly edit?: boolean }
): Promise<void> {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `closeTab`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _path - The path.
 * @param _discard - The discard.
 * @example
 * ```ts
 * closeTab();
 * ```
 */
export function closeTab(_ctx: FilesViewCtx, _path: string, _discard: boolean): boolean {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `activateTab`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _path - The path.
 * @example
 * ```ts
 * activateTab();
 * ```
 */
export function activateTab(_ctx: FilesViewCtx, _path: string): void {
  throw new Error("not implemented");
}

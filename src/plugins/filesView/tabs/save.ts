/**
 * @file filesView plugin — tabs/save.ts (skeleton stubs, implemented in its wave).
 */
import type { Config, FilesViewCtx, SaveResult } from "../types";

/**
 * Skeleton stub for `saveTab`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _path - The path.
 * @example
 * ```ts
 * saveTab();
 * ```
 */
export function saveTab(_ctx: FilesViewCtx, _path: string): Promise<SaveResult> {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `resolveConflict`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _path - The path.
 * @param _choice - The choice.
 * @example
 * ```ts
 * resolveConflict();
 * ```
 */
export function resolveConflict(
  _ctx: FilesViewCtx,
  _path: string,
  _choice: "reload" | "overwrite"
): Promise<SaveResult> {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `shouldReload`; implemented in its wave.
 *
 * @param _path - The path.
 * @param _config - The config.
 * @example
 * ```ts
 * shouldReload();
 * ```
 */
export function shouldReload(_path: string, _config: Readonly<Config>): boolean {
  throw new Error("not implemented");
}

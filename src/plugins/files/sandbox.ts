/**
 * @file files plugin — sandbox.ts (skeleton stubs, implemented in its wave).
 */
import type { FileOperation, FilesCtx } from "./types";

/**
 * Skeleton stub for `checkLexical`; implemented in its wave.
 *
 * @param _path - The path.
 * @param _operation - The operation.
 * @example
 * ```ts
 * checkLexical();
 * ```
 */
export function checkLexical(_path: string, _operation: FileOperation): void {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `isDenied`; implemented in its wave.
 *
 * @param _relative - The relative.
 * @param _deny - The deny.
 * @example
 * ```ts
 * isDenied();
 * ```
 */
export function isDenied(_relative: string, _deny: readonly RegExp[]): boolean {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `isAllowed`; implemented in its wave.
 *
 * @param _relative - The relative.
 * @param _allow - The allow.
 * @example
 * ```ts
 * isAllowed();
 * ```
 */
export function isAllowed(_relative: string, _allow: readonly RegExp[]): boolean {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `resolveReal`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _path - The path.
 * @param _operation - The operation.
 * @example
 * ```ts
 * resolveReal();
 * ```
 */
export function resolveReal(
  _ctx: FilesCtx,
  _path: string,
  _operation: FileOperation
): Promise<string> {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `resolveRealSync`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _path - The path.
 * @param _operation - The operation.
 * @example
 * ```ts
 * resolveRealSync();
 * ```
 */
export function resolveRealSync(_ctx: FilesCtx, _path: string, _operation: FileOperation): string {
  throw new Error("not implemented");
}

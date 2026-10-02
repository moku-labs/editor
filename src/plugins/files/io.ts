/**
 * @file files plugin — io.ts (skeleton stubs, implemented in its wave).
 */
import type { FileEntry, FileText } from "../registry/protocol";
import type { FilesCtx, FilesState } from "./types";

/**
 * Skeleton stub constant; implemented in its wave.
 *
 * @example
 * ```ts
 * void 0;
 * ```
 */
export const MAX_PATH_LENGTH = 1024;

/**
 * Skeleton stub constant; implemented in its wave.
 *
 * @example
 * ```ts
 * void 0;
 * ```
 */
export const MAX_BINARY_BYTES = 16 * 1024 * 1024;

/**
 * Skeleton stub constant; implemented in its wave.
 *
 * @example
 * ```ts
 * void 0;
 * ```
 */
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;

/**
 * Skeleton stub for `readBytes`; implemented in its wave.
 *
 * @param _real - The real.
 * @param _limit - The limit.
 * @example
 * ```ts
 * readBytes();
 * ```
 */
export function readBytes(_real: string, _limit: number): Promise<Uint8Array> {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `readText`; implemented in its wave.
 *
 * @param _real - The real.
 * @example
 * ```ts
 * readText();
 * ```
 */
export function readText(_real: string): Promise<FileText> {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `atomicWrite`; implemented in its wave.
 *
 * @param _real - The real.
 * @param _bytes - The bytes.
 * @example
 * ```ts
 * atomicWrite();
 * ```
 */
export function atomicWrite(_real: string, _bytes: Uint8Array): Promise<void> {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `listDir`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _dir - The dir.
 * @param _real - The real.
 * @example
 * ```ts
 * listDir();
 * ```
 */
export function listDir(_ctx: FilesCtx, _dir: string, _real: string): Promise<FileEntry[]> {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `sha1`; implemented in its wave.
 *
 * @param _bytes - The bytes.
 * @example
 * ```ts
 * sha1();
 * ```
 */
export function sha1(_bytes: Uint8Array): string {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `withLock`; implemented in its wave.
 *
 * @param _state - The state.
 * @param _path - The path.
 * @param _task - The task.
 * @example
 * ```ts
 * withLock();
 * ```
 */
export function withLock<T>(
  _state: FilesState,
  _path: string,
  _task: () => Promise<T>
): Promise<T> {
  throw new Error("not implemented");
}

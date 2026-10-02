/**
 * @file files plugin — errors.ts (skeleton stubs, implemented in its wave).
 */
import type { WireError } from "../registry/protocol";

/**
 * Skeleton stub for `forbidden`; implemented in its wave.
 *
 * @param _path - The path.
 * @example
 * ```ts
 * forbidden();
 * ```
 */
export function forbidden(_path: string): Error & WireError {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `notFound`; implemented in its wave.
 *
 * @param _path - The path.
 * @example
 * ```ts
 * notFound();
 * ```
 */
export function notFound(_path: string): Error & WireError {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `conflict`; implemented in its wave.
 *
 * @param _path - The path.
 * @example
 * ```ts
 * conflict();
 * ```
 */
export function conflict(_path: string): Error & WireError {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `invalid`; implemented in its wave.
 *
 * @param _field - The field.
 * @param _message - The message.
 * @example
 * ```ts
 * invalid();
 * ```
 */
export function invalid(_field: "text" | "data", _message: string): Error & WireError {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `tooLarge`; implemented in its wave.
 *
 * @param _path - The path.
 * @example
 * ```ts
 * tooLarge();
 * ```
 */
export function tooLarge(_path: string): Error & WireError {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `ioFailed`; implemented in its wave.
 *
 * @param _message - The message.
 * @example
 * ```ts
 * ioFailed();
 * ```
 */
export function ioFailed(_message: string): Error & WireError {
  throw new Error("not implemented");
}

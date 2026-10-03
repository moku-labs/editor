/**
 * @file files plugin — the error factories. Each returns the protocol's `wireError(...)`
 * (`Error & WireError`, R1); there is no own error class. Messages name the requested relative
 * path only, never the absolute root.
 */
import type { WireError } from "../registry/protocol";
import { errorCode, wireError } from "../registry/protocol";

/**
 * A path that fails any sandbox rule: -32004 `forbidden_path`.
 *
 * @param path - The requested path, as given.
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * throw forbidden("../x.ts"); // "[moku-editor] forbidden path: ../x.ts"
 * ```
 */
export function forbidden(path: string): Error & WireError {
  return wireError(errorCode.forbiddenPath, `forbidden path: ${path}`, {
    reason: "forbidden_path",
    retryable: false,
    id: path
  });
}

/**
 * A file or folder that does not exist: -32601 `unknown_id`.
 *
 * @param path - The requested path.
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * throw notFound("src/missing.ts");
 * ```
 */
export function notFound(path: string): Error & WireError {
  return wireError(errorCode.unknownMethod, `not found: ${path}`, {
    reason: "unknown_id",
    retryable: false,
    id: path
  });
}

/**
 * A stale `version`, or a version given for a missing file: -32005 `version_conflict`.
 *
 * @param path - The requested path.
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * conflict("src/a.ts").code; // -32005, message "[moku-editor] version conflict: src/a.ts"
 * ```
 */
export function conflict(path: string): Error & WireError {
  return wireError(errorCode.versionConflict, `version conflict: ${path}`, {
    reason: "version_conflict",
    retryable: false,
    id: path
  });
}

/**
 * An input that cannot be written (text or data too large, bad data URL): -32602 `invalid_input`.
 *
 * @param field - The offending field of the files-channel params.
 * @param message - What is wrong, naming the relative path.
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * throw invalid("text", "write: text over 2 MiB: src/a.ts");
 * ```
 */
export function invalid(field: "text" | "data", message: string): Error & WireError {
  return wireError(errorCode.invalidInput, message, {
    reason: "invalid_input",
    retryable: false,
    field
  });
}

/**
 * A file too large to read back (text over 2 MiB, image over 16 MiB): -32000 `command_failed`.
 *
 * @param path - The requested path.
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * tooLarge("src/a.ts").code; // -32000
 * ```
 */
export function tooLarge(path: string): Error & WireError {
  return wireError(errorCode.commandFailed, `file too large: ${path}`, {
    reason: "command_failed",
    retryable: false
  });
}

/**
 * Any other IO failure: -32000 `command_failed`.
 *
 * @param message - What failed, naming the relative path and the errno code only.
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * throw ioFailed("write failed: src/a.ts (EACCES)");
 * ```
 */
export function ioFailed(message: string): Error & WireError {
  return wireError(errorCode.commandFailed, message, {
    reason: "command_failed",
    retryable: false
  });
}

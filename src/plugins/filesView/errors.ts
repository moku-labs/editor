/**
 * @file filesView plugin — reading what link rejected with: an `Error & WireError` (R1
 * `isWireError`) or anything else; UI texts drop the `[moku-editor]` prefix (R7 `bareMessage`).
 */
import type { ErrorReason } from "../registry/protocol";
import { bareMessage, isWireError } from "../registry/protocol";

/**
 * The JSON-RPC code of a rejection.
 *
 * @param error - Anything thrown.
 * @returns The code, or undefined when it is no wire error.
 * @example
 * ```ts
 * codeOf(wireError(-32_005, "version conflict: a.ts")); // -32005
 * ```
 */
export function codeOf(error: unknown): number | undefined {
  return isWireError(error) ? error.code : undefined;
}

/**
 * The wire reason of a rejection.
 *
 * @param error - Anything thrown.
 * @returns `data.reason`, or undefined.
 * @example
 * ```ts
 * reasonOf(wireError(-32_004, "forbidden path: x", { reason: "forbidden_path" })); // "forbidden_path"
 * ```
 */
export function reasonOf(error: unknown): ErrorReason | undefined {
  return isWireError(error) ? error.data?.reason : undefined;
}

/**
 * The text of a rejection for the UI, without the prefix.
 *
 * @param error - Anything thrown.
 * @returns The bare message; "Unknown error" for a thrown non-error.
 * @example
 * ```ts
 * messageOf(new Error("[moku-editor] link closed")); // "link closed"
 * ```
 */
export function messageOf(error: unknown): string {
  if (isWireError(error) || error instanceof Error) return bareMessage(error.message);
  return "Unknown error";
}

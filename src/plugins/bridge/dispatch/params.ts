/**
 * @file bridge plugin — dispatch/params.ts (skeleton stubs, implemented in its wave).
 */
import type { InputOf, InputSchema, Json } from "../../registry/protocol";

/**
 * Skeleton stub constant; implemented in its wave.
 *
 * @example
 * ```ts
 * void 0;
 * ```
 */
export const PARAMS = {
  manifest: {},
  read: { id: "string", input: "json?" },
  watch: { sub: "number", id: "string", input: "json?" },
  unwatch: { sub: "number" },
  run: { id: "string", input: "json?" }
} as const satisfies Record<string, InputSchema>;

/**
 * Skeleton stub for `checkParams`; implemented in its wave.
 *
 * @param _method - The method.
 * @param _params - The params.
 * @example
 * ```ts
 * checkParams();
 * ```
 */
export function checkParams<M extends keyof typeof PARAMS>(
  _method: M,
  _params: Json | undefined
): InputOf<(typeof PARAMS)[M]> {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `deadlineFor`; implemented in its wave.
 *
 * @param _method - The method.
 * @param _params - The params.
 * @param _callTimeoutMs - The callTimeoutMs.
 * @example
 * ```ts
 * deadlineFor();
 * ```
 */
export function deadlineFor(
  _method: string,
  _params: Json | undefined,
  _callTimeoutMs: number
): number {
  throw new Error("not implemented");
}

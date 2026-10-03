/**
 * @file pages plugin — static.ts (skeleton stubs, implemented in its wave).
 */
import type { GuardMode, HubServer } from "../hub/types";

/**
 * Skeleton stub for `createStaticFetch`; implemented in its wave.
 *
 * @param _root - The root.
 * @param _guard - The guard.
 * @example
 * ```ts
 * createStaticFetch();
 * ```
 */
export function createStaticFetch(
  _root: string,
  _guard: (req: Request, server: HubServer, mode: GuardMode) => Response | undefined
): (req: Request, server: HubServer) => Promise<Response> {
  throw new Error("not implemented");
}

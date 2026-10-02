/**
 * @file gameView plugin — element/source.ts (skeleton stubs, implemented in its wave).
 */

import type { StyleBlockRef } from "../../panels/shared/style-edit";
import type { GameViewCtx } from "../types";

/**
 * Skeleton stub for `findStyleSource`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @param _key - The key.
 * @example
 * ```ts
 * findStyleSource();
 * ```
 */
export function findStyleSource(
  _ctx: GameViewCtx,
  _key: string
): Promise<{ path: string; ref: StyleBlockRef } | undefined> {
  throw new Error("not implemented");
}

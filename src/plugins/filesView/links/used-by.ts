/**
 * @file filesView plugin — links/used-by.ts (skeleton stubs, implemented in its wave).
 */

import type { Json, SourceOverrides } from "../../registry/protocol";
import type { FilesViewCtx, UsedBy } from "../types";

/**
 * Skeleton stub for `buildUsedBy`; implemented in its wave.
 *
 * @param _graph - The graph.
 * @param _exists - The exists.
 * @param _overrides - The overrides.
 * @example
 * ```ts
 * buildUsedBy();
 * ```
 */
export function buildUsedBy(
  _graph: Json | undefined,
  _exists: (path: string) => boolean,
  _overrides: SourceOverrides
): Map<string, UsedBy> {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `loadOverrides`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @example
 * ```ts
 * loadOverrides();
 * ```
 */
export function loadOverrides(_ctx: FilesViewCtx): Promise<SourceOverrides> {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `loadGraph`; implemented in its wave.
 *
 * @param _ctx - The ctx.
 * @example
 * ```ts
 * loadGraph();
 * ```
 */
export function loadGraph(_ctx: FilesViewCtx): Promise<void> {
  throw new Error("not implemented");
}

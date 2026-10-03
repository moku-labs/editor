/**
 * @file renderView plugin — components/MetricTile.tsx (skeleton stubs, implemented in its wave).
 */

import type { VNode } from "preact";
import type { MetricTiles } from "../types";

/**
 * Props of `MetricTile`.
 *
 * @example
 * ```ts
 * const props = {} as never as MetricTileProps;
 * ```
 */
export type MetricTileProps = {
  readonly label: string;
  readonly tile: MetricTiles[keyof MetricTiles];
};

/**
 * Skeleton stub for `MetricTile`; implemented in its wave.
 *
 * @param _props - The props.
 * @example
 * ```ts
 * MetricTile();
 * ```
 */
export function MetricTile(_props: MetricTileProps): VNode {
  throw new Error("not implemented");
}

/**
 * @file stateView plugin — view/RunnerCard.tsx (skeleton stubs, implemented in its wave).
 */

import type { VNode } from "preact";
import type { Json, LinkStatus } from "../../registry/protocol";
import type { StateViewCtx } from "../types";

/**
 * Props of `RunnerCard`.
 *
 * @example
 * ```ts
 * const props = {} as never as RunnerCardProps;
 * ```
 */
export type RunnerCardProps = {
  readonly ctx: StateViewCtx;
  readonly position: Json;
  readonly history: Json;
  readonly status: LinkStatus;
};

/**
 * Skeleton stub for `RunnerCard`; implemented in its wave.
 *
 * @param _props - The props.
 * @example
 * ```ts
 * RunnerCard();
 * ```
 */
export function RunnerCard(_props: RunnerCardProps): VNode {
  throw new Error("not implemented");
}

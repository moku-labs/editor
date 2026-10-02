/**
 * @file stateView plugin — view/StateView.tsx (skeleton stubs, implemented in its wave).
 */

import type { VNode } from "preact";
import type { PanelTools } from "../../panels/types";
import type { Json } from "../../registry/protocol";
import type { StateViewCtx } from "../types";

/**
 * Props of `StateView`.
 *
 * @example
 * ```ts
 * const props = {} as never as StateViewProps;
 * ```
 */
export type StateViewProps = {
  readonly ctx: StateViewCtx;
  readonly values: Readonly<Record<string, Json>>;
  readonly tools: PanelTools<Readonly<Record<never, string>>>;
};

/**
 * Skeleton stub for `StateView`; implemented in its wave.
 *
 * @param _props - The props.
 * @example
 * ```ts
 * StateView();
 * ```
 */
export function StateView(_props: StateViewProps): VNode {
  throw new Error("not implemented");
}

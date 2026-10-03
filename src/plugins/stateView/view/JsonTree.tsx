/**
 * @file stateView plugin — view/JsonTree.tsx (skeleton stubs, implemented in its wave).
 */

import type { VNode } from "preact";
import type { Json } from "../../registry/protocol";
import type { StateViewCtx } from "../types";

/**
 * Props of `JsonTree`.
 *
 * @example
 * ```ts
 * const props = {} as never as JsonTreeProps;
 * ```
 */
export type JsonTreeProps = {
  readonly ctx: StateViewCtx;
  readonly value: Json;
  readonly pointer: string;
};

/**
 * Skeleton stub for `JsonTree`; implemented in its wave.
 *
 * @param _props - The props.
 * @example
 * ```ts
 * JsonTree();
 * ```
 */
export function JsonTree(_props: JsonTreeProps): VNode {
  throw new Error("not implemented");
}

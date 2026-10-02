/**
 * @file flowView plugin — render/Stub.tsx (skeleton stubs, implemented in its wave).
 */

import type { VNode } from "preact";
import type { FlowCtx, Item } from "../types";

/**
 * Props of `Stub`.
 *
 * @example
 * ```ts
 * const props = {} as never as StubProps;
 * ```
 */
export type StubProps = { readonly ctx: FlowCtx; readonly item: Item };

/**
 * Skeleton stub for `Stub`; implemented in its wave.
 *
 * @param _props - The props.
 * @example
 * ```ts
 * Stub();
 * ```
 */
export function Stub(_props: StubProps): VNode {
  throw new Error("not implemented");
}

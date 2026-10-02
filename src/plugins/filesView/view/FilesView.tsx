/**
 * @file filesView plugin — view/FilesView.tsx (skeleton stubs, implemented in its wave).
 */

import type { VNode } from "preact";
import type { LinkStatus } from "../../registry/protocol";
import type { FilesViewCtx } from "../types";

/**
 * Props of `FilesView`.
 *
 * @example
 * ```ts
 * const props = {} as never as FilesViewProps;
 * ```
 */
export type FilesViewProps = { readonly ctx: FilesViewCtx; readonly status: LinkStatus };

/**
 * Skeleton stub for `FilesView`; implemented in its wave.
 *
 * @param _props - The props.
 * @example
 * ```ts
 * FilesView();
 * ```
 */
export function FilesView(_props: FilesViewProps): VNode {
  throw new Error("not implemented");
}

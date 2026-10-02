/**
 * @file consoleView plugin — view/ConsoleView.tsx (skeleton stubs, implemented in its wave).
 */

import type { VNode } from "preact";
import type { LinkStatus } from "../../registry/protocol";
import type { ConsoleCtx } from "../types";

/**
 * Props of `ConsoleView`.
 *
 * @example
 * ```ts
 * const props = {} as never as ConsoleViewProps;
 * ```
 */
export type ConsoleViewProps = { readonly ctx: ConsoleCtx; readonly status: LinkStatus };

/**
 * Skeleton stub for `ConsoleView`; implemented in its wave.
 *
 * @param _props - The props.
 * @example
 * ```ts
 * ConsoleView();
 * ```
 */
export function ConsoleView(_props: ConsoleViewProps): VNode {
  throw new Error("not implemented");
}

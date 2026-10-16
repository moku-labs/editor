/**
 * @file renderView components (inspector) — The inspector's range view of a selection. Typed
 * stub of build wave 0 (spec 09 § M17, RV0): the signatures are the contract the other Mission
 * control units build against; build wave 4 (RV6) writes the bodies.
 */
import type { JSX } from "preact";
import { notBuilt } from "../../stub";
import type { RenderViewCtx } from "../../types";

/**
 * Props of `RangeView`.
 */
export type RangeViewProps = { readonly ctx: RenderViewCtx };

/**
 * The inspector's range view of a selection.
 *
 * @param _props - ctx.
 * @returns The element.
 * @throws {Error} Until build wave 4: "renderView components/RangeView is not built yet".
 */
export function RangeView(_props: RangeViewProps): JSX.Element {
  return notBuilt("components/RangeView", 4);
}

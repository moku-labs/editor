/**
 * @file renderView components (inspector) — The inspector: the summary of the view or the range
 * view of the selection (spec 09 § M10). Typed stub of build wave 0 (spec 09 § M17, RV0): the
 * signatures are the contract the other Mission control units build against; build wave 4 (RV6)
 * writes the bodies.
 */
import type { JSX } from "preact";
import { notBuilt } from "../../stub";
import type { RenderViewCtx } from "../../types";

/**
 * Props of `Inspector`.
 */
export type InspectorProps = { readonly ctx: RenderViewCtx };

/**
 * The inspector: the summary of the view or the range view of the selection (spec 09 § M10).
 *
 * @param _props - ctx.
 * @returns The element.
 * @throws {Error} Until build wave 4: "renderView components/Inspector is not built yet".
 */
export function Inspector(_props: InspectorProps): JSX.Element {
  return notBuilt("components/Inspector", 4);
}

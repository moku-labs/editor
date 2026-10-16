/**
 * @file renderView components (inspector) — The rows of an inspector list. Typed stub of build
 * wave 0 (spec 09 § M17, RV0): the signatures are the contract the other Mission control units
 * build against; build wave 4 (RV6) writes the bodies.
 */
import type { JSX } from "preact";
import { notBuilt } from "../../stub";
import type { RenderViewCtx } from "../../types";

/**
 * Props of `Rows`.
 */
export type RowsProps = { readonly ctx: RenderViewCtx };

/**
 * The rows of an inspector list.
 *
 * @param _props - ctx.
 * @returns The element.
 * @throws {Error} Until build wave 4: "renderView components/Rows is not built yet".
 */
export function Rows(_props: RowsProps): JSX.Element {
  return notBuilt("components/Rows", 4);
}

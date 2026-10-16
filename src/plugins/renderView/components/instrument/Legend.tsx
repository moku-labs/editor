/**
 * @file renderView components (instrument) — The legend of causes and marks. Typed stub of
 * build wave 0 (spec 09 § M17, RV0): the signatures are the contract the other Mission control
 * units build against; build wave 4 (RV6) writes the bodies.
 */
import type { JSX } from "preact";
import { notBuilt } from "../../stub";
import type { RenderViewCtx } from "../../types";

/**
 * Props of `Legend`.
 */
export type LegendProps = { readonly ctx: RenderViewCtx };

/**
 * The legend of causes and marks.
 *
 * @param _props - ctx.
 * @returns The element.
 * @throws {Error} Until build wave 4: "renderView components/Legend is not built yet".
 */
export function Legend(_props: LegendProps): JSX.Element {
  return notBuilt("components/Legend", 4);
}

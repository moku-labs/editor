/**
 * @file renderView components (connection) — The facts row: OS, browser, build, display, rate
 * now, dpr or address. Typed stub of build wave 0 (spec 09 § M17, RV0): the signatures are the
 * contract the other Mission control units build against; build wave 4 (RV5) writes the bodies.
 */
import type { JSX } from "preact";
import { notBuilt } from "../../stub";
import type { RenderViewCtx } from "../../types";

/**
 * Props of `Facts`.
 */
export type FactsProps = { readonly ctx: RenderViewCtx };

/**
 * The facts row: OS, browser, build, display, rate now, dpr or address.
 *
 * @param _props - ctx.
 * @returns The element.
 * @throws {Error} Until build wave 4: "renderView components/Facts is not built yet".
 */
export function Facts(_props: FactsProps): JSX.Element {
  return notBuilt("components/Facts", 4);
}

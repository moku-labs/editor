/**
 * @file renderView components (cards) — The static facts row: scene, bundles, pools, dpr and
 * the one-source line. Typed stub of build wave 0 (spec 09 § M17, RV0): the signatures are the
 * contract the other Mission control units build against; build wave 4 (RV6) writes the bodies.
 */
import type { JSX } from "preact";
import { notBuilt } from "../../stub";
import type { RenderViewCtx } from "../../types";

/**
 * Props of `StaticFacts`.
 */
export type StaticFactsProps = { readonly ctx: RenderViewCtx };

/**
 * The static facts row: scene, bundles, pools, dpr and the one-source line.
 *
 * @param _props - ctx.
 * @returns The element.
 * @throws {Error} Until build wave 4: "renderView components/StaticFacts is not built yet".
 */
export function StaticFacts(_props: StaticFactsProps): JSX.Element {
  return notBuilt("components/StaticFacts", 4);
}

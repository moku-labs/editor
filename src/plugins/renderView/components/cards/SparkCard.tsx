/**
 * @file renderView components (cards) — One sparkline card on the shared axis: title, headline,
 * tag and sparkline. Typed stub of build wave 0 (spec 09 § M17, RV0): the signatures are the
 * contract the other Mission control units build against; build wave 4 (RV6) writes the bodies.
 */
import type { JSX } from "preact";
import { notBuilt } from "../../stub";
import type { RenderViewCtx } from "../../types";

/**
 * Props of `SparkCard`.
 */
export type SparkCardProps = { readonly ctx: RenderViewCtx };

/**
 * One sparkline card on the shared axis: title, headline, tag and sparkline.
 *
 * @param _props - ctx.
 * @returns The element.
 * @throws {Error} Until build wave 4: "renderView components/SparkCard is not built yet".
 */
export function SparkCard(_props: SparkCardProps): JSX.Element {
  return notBuilt("components/SparkCard", 4);
}

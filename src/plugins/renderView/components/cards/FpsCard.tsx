/**
 * @file renderView components (cards) — The FPS card with the rate switch in its footer. Typed
 * stub of build wave 0 (spec 09 § M17, RV0): the signatures are the contract the other Mission
 * control units build against; build wave 4 (RV6) writes the bodies.
 */
import type { JSX } from "preact";
import { notBuilt } from "../../stub";
import type { RenderViewCtx } from "../../types";

/**
 * Props of `FpsCard`.
 */
export type FpsCardProps = { readonly ctx: RenderViewCtx };

/**
 * The FPS card with the rate switch in its footer.
 *
 * @param _props - ctx.
 * @returns The element.
 * @throws {Error} Until build wave 4: "renderView components/FpsCard is not built yet".
 */
export function FpsCard(_props: FpsCardProps): JSX.Element {
  return notBuilt("components/FpsCard", 4);
}

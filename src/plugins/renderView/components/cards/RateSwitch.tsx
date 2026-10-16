/**
 * @file renderView components (cards) — The rate switch: a radiogroup 60, 120, Adaptive with
 * roving tabindex, the pending and answer lines. Typed stub of build wave 0 (spec 09 § M17,
 * RV0): the signatures are the contract the other Mission control units build against; build
 * wave 4 (RV6) writes the bodies.
 */
import type { JSX } from "preact";
import { notBuilt } from "../../stub";
import type { RenderViewCtx } from "../../types";

/**
 * Props of `RateSwitch`.
 */
export type RateSwitchProps = { readonly ctx: RenderViewCtx };

/**
 * The rate switch: a radiogroup 60, 120, Adaptive with roving tabindex, the pending and answer
 * lines.
 *
 * @param _props - ctx.
 * @returns The element.
 * @throws {Error} Until build wave 4: "renderView components/RateSwitch is not built yet".
 */
export function RateSwitch(_props: RateSwitchProps): JSX.Element {
  return notBuilt("components/RateSwitch", 4);
}

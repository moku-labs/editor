/**
 * @file renderView components (instrument) — The tooltip of the frame under the pointer. Typed
 * stub of build wave 0 (spec 09 § M17, RV0): the signatures are the contract the other Mission
 * control units build against; build wave 4 (RV6) writes the bodies.
 */
import type { JSX } from "preact";
import { notBuilt } from "../../stub";
import type { RenderViewCtx } from "../../types";

/**
 * Props of `Tooltip`.
 */
export type TooltipProps = { readonly ctx: RenderViewCtx };

/**
 * The tooltip of the frame under the pointer.
 *
 * @param _props - ctx.
 * @returns The element.
 * @throws {Error} Until build wave 4: "renderView components/Tooltip is not built yet".
 */
export function Tooltip(_props: TooltipProps): JSX.Element {
  return notBuilt("components/Tooltip", 4);
}

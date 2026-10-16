/**
 * @file renderView components (instrument) — The timeline canvas with its pointer selection and
 * tooltip. Typed stub of build wave 0 (spec 09 § M17, RV0): the signatures are the contract the
 * other Mission control units build against; build wave 4 (RV6) writes the bodies.
 */
import type { JSX } from "preact";
import { notBuilt } from "../../stub";
import type { RenderViewCtx } from "../../types";

/**
 * Props of `TimelineCanvas`.
 */
export type TimelineCanvasProps = { readonly ctx: RenderViewCtx };

/**
 * The timeline canvas with its pointer selection and tooltip.
 *
 * @param _props - ctx.
 * @returns The element.
 * @throws {Error} Until build wave 4: "renderView components/TimelineCanvas is not built yet".
 */
export function TimelineCanvas(_props: TimelineCanvasProps): JSX.Element {
  return notBuilt("components/TimelineCanvas", 4);
}

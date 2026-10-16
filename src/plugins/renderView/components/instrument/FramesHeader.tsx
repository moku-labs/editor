/**
 * @file renderView components (instrument) — The frames header: frames, spikes, worst, p90,
 * rest and GCs of the view. Typed stub of build wave 0 (spec 09 § M17, RV0): the signatures are
 * the contract the other Mission control units build against; build wave 4 (RV6) writes the
 * bodies.
 */
import type { JSX } from "preact";
import { notBuilt } from "../../stub";
import type { RenderViewCtx } from "../../types";

/**
 * Props of `FramesHeader`.
 */
export type FramesHeaderProps = { readonly ctx: RenderViewCtx };

/**
 * The frames header: frames, spikes, worst, p90, rest and GCs of the view.
 *
 * @param _props - ctx.
 * @returns The element.
 * @throws {Error} Until build wave 4: "renderView components/FramesHeader is not built yet".
 */
export function FramesHeader(_props: FramesHeaderProps): JSX.Element {
  return notBuilt("components/FramesHeader", 4);
}

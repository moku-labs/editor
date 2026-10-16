/**
 * @file renderView components (instrument) — The frames card: header, timeline, lane, overview,
 * transport and legend (spec 09 § M8). Typed stub of build wave 0 (spec 09 § M17, RV0): the
 * signatures are the contract the other Mission control units build against; build wave 4 (RV6)
 * writes the bodies.
 */
import type { JSX } from "preact";
import { notBuilt } from "../../stub";
import type { RenderViewCtx } from "../../types";

/**
 * Props of `FramesCard`.
 */
export type FramesCardProps = { readonly ctx: RenderViewCtx };

/**
 * The frames card: header, timeline, lane, overview, transport and legend (spec 09 § M8).
 *
 * @param _props - ctx.
 * @returns The element.
 * @throws {Error} Until build wave 4: "renderView components/FramesCard is not built yet".
 */
export function FramesCard(_props: FramesCardProps): JSX.Element {
  return notBuilt("components/FramesCard", 4);
}

/**
 * @file renderView components (instrument) — What a graph shows instead of data: not started,
 * waiting, no monitor, a section off. Typed stub of build wave 0 (spec 09 § M17, RV0): the
 * signatures are the contract the other Mission control units build against; build wave 4 (RV6)
 * writes the bodies.
 */
import type { JSX } from "preact";
import { notBuilt } from "../../stub";
import type { RenderViewCtx } from "../../types";

/**
 * Props of `EmptyOverlay`.
 */
export type EmptyOverlayProps = { readonly ctx: RenderViewCtx };

/**
 * What a graph shows instead of data: not started, waiting, no monitor, a section off.
 *
 * @param _props - ctx.
 * @returns The element.
 * @throws {Error} Until build wave 4: "renderView components/EmptyOverlay is not built yet".
 */
export function EmptyOverlay(_props: EmptyOverlayProps): JSX.Element {
  return notBuilt("components/EmptyOverlay", 4);
}

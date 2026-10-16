/**
 * @file renderView components (instrument) — The Shaders & passes lane canvas. Typed stub of
 * build wave 0 (spec 09 § M17, RV0): the signatures are the contract the other Mission control
 * units build against; build wave 4 (RV6) writes the bodies.
 */
import type { JSX } from "preact";
import { notBuilt } from "../../stub";
import type { RenderViewCtx } from "../../types";

/**
 * Props of `LaneCanvas`.
 */
export type LaneCanvasProps = { readonly ctx: RenderViewCtx };

/**
 * The Shaders & passes lane canvas.
 *
 * @param _props - ctx.
 * @returns The element.
 * @throws {Error} Until build wave 4: "renderView components/LaneCanvas is not built yet".
 */
export function LaneCanvas(_props: LaneCanvasProps): JSX.Element {
  return notBuilt("components/LaneCanvas", 4);
}

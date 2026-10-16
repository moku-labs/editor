/**
 * @file renderView components (instrument) — The 2-minute overview canvas with its viewport
 * drag. Typed stub of build wave 0 (spec 09 § M17, RV0): the signatures are the contract the
 * other Mission control units build against; build wave 4 (RV6) writes the bodies.
 */
import type { JSX } from "preact";
import { notBuilt } from "../../stub";
import type { RenderViewCtx } from "../../types";

/**
 * Props of `OverviewCanvas`.
 */
export type OverviewCanvasProps = { readonly ctx: RenderViewCtx };

/**
 * The 2-minute overview canvas with its viewport drag.
 *
 * @param _props - ctx.
 * @returns The element.
 * @throws {Error} Until build wave 4: "renderView components/OverviewCanvas is not built yet".
 */
export function OverviewCanvas(_props: OverviewCanvasProps): JSX.Element {
  return notBuilt("components/OverviewCanvas", 4);
}

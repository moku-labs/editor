/**
 * @file renderView components (connection) — The bar's actions: Monitoring, Record, the Connect
 * split button, Use local preview. Typed stub of build wave 0 (spec 09 § M17, RV0): the
 * signatures are the contract the other Mission control units build against; build wave 4 (RV5)
 * writes the bodies.
 */
import type { JSX } from "preact";
import { notBuilt } from "../../stub";
import type { RenderViewCtx } from "../../types";

/**
 * Props of `Actions`.
 */
export type ActionsProps = { readonly ctx: RenderViewCtx };

/**
 * The bar's actions: Monitoring, Record, the Connect split button, Use local preview.
 *
 * @param _props - ctx.
 * @returns The element.
 * @throws {Error} Until build wave 4: "renderView components/Actions is not built yet".
 */
export function Actions(_props: ActionsProps): JSX.Element {
  return notBuilt("components/Actions", 4);
}

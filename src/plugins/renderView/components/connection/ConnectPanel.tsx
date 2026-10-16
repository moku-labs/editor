/**
 * @file renderView components (connection) — The Connect panel: By wire and On the network
 * tabs, asking and linked rows. Typed stub of build wave 0 (spec 09 § M17, RV0): the signatures
 * are the contract the other Mission control units build against; build wave 4 (RV5) writes the
 * bodies.
 */
import type { JSX } from "preact";
import { notBuilt } from "../../stub";
import type { RenderViewCtx } from "../../types";

/**
 * Props of `ConnectPanel`.
 */
export type ConnectPanelProps = { readonly ctx: RenderViewCtx };

/**
 * The Connect panel: By wire and On the network tabs, asking and linked rows.
 *
 * @param _props - ctx.
 * @returns The element.
 * @throws {Error} Until build wave 4: "renderView components/ConnectPanel is not built yet".
 */
export function ConnectPanel(_props: ConnectPanelProps): JSX.Element {
  return notBuilt("components/ConnectPanel", 4);
}

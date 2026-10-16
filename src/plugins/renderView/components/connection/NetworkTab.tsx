/**
 * @file renderView components (connection) — The On the network tab: Listen on the network, the
 * address, waiting for a phone to dial. Typed stub of build wave 0 (spec 09 § M17, RV0): the
 * signatures are the contract the other Mission control units build against; build wave 4 (RV5)
 * writes the bodies.
 */
import type { JSX } from "preact";
import { notBuilt } from "../../stub";
import type { RenderViewCtx } from "../../types";

/**
 * Props of `NetworkTab`.
 */
export type NetworkTabProps = { readonly ctx: RenderViewCtx };

/**
 * The On the network tab: Listen on the network, the address, waiting for a phone to dial.
 *
 * @param _props - ctx.
 * @returns The element.
 * @throws {Error} Until build wave 4: "renderView components/NetworkTab is not built yet".
 */
export function NetworkTab(_props: NetworkTabProps): JSX.Element {
  return notBuilt("components/NetworkTab", 4);
}

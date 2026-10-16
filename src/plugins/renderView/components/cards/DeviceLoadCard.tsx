/**
 * @file renderView components (cards) — The Device load card: CPU per process stacked, GPU busy
 * and clock. Typed stub of build wave 0 (spec 09 § M17, RV0): the signatures are the contract
 * the other Mission control units build against; build wave 4 (RV6) writes the bodies.
 */
import type { JSX } from "preact";
import { notBuilt } from "../../stub";
import type { RenderViewCtx } from "../../types";

/**
 * Props of `DeviceLoadCard`.
 */
export type DeviceLoadCardProps = { readonly ctx: RenderViewCtx };

/**
 * The Device load card: CPU per process stacked, GPU busy and clock.
 *
 * @param _props - ctx.
 * @returns The element.
 * @throws {Error} Until build wave 4: "renderView components/DeviceLoadCard is not built yet".
 */
export function DeviceLoadCard(_props: DeviceLoadCardProps): JSX.Element {
  return notBuilt("components/DeviceLoadCard", 4);
}

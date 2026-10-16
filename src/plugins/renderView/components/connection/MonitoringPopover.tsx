/**
 * @file renderView components (connection) — The Monitoring popover: one row per section with
 * its switch and cost. Typed stub of build wave 0 (spec 09 § M17, RV0): the signatures are the
 * contract the other Mission control units build against; build wave 4 (RV5) writes the bodies.
 */
import type { JSX } from "preact";
import { notBuilt } from "../../stub";
import type { RenderViewCtx } from "../../types";

/**
 * Props of `MonitoringPopover`.
 */
export type MonitoringPopoverProps = { readonly ctx: RenderViewCtx };

/**
 * The Monitoring popover: one row per section with its switch and cost.
 *
 * @param _props - ctx.
 * @returns The element.
 * @throws {Error} Until build wave 4: "renderView components/MonitoringPopover is not built yet".
 */
export function MonitoringPopover(_props: MonitoringPopoverProps): JSX.Element {
  return notBuilt("components/MonitoringPopover", 4);
}

/**
 * @file renderView components (connection) — The recording popover: the log file, who started
 * it, marks, Mark. Typed stub of build wave 0 (spec 09 § M17, RV0): the signatures are the
 * contract the other Mission control units build against; build wave 4 (RV5) writes the bodies.
 */
import type { JSX } from "preact";
import { notBuilt } from "../../stub";
import type { RenderViewCtx } from "../../types";

/**
 * Props of `RecordPopover`.
 */
export type RecordPopoverProps = { readonly ctx: RenderViewCtx };

/**
 * The recording popover: the log file, who started it, marks, Mark.
 *
 * @param _props - ctx.
 * @returns The element.
 * @throws {Error} Until build wave 4: "renderView components/RecordPopover is not built yet".
 */
export function RecordPopover(_props: RecordPopoverProps): JSX.Element {
  return notBuilt("components/RecordPopover", 4);
}

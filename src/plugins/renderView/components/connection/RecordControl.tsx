/**
 * @file renderView components (connection) — The Record button and pill: Record, Stop, who
 * started it. Typed stub of build wave 0 (spec 09 § M17, RV0): the signatures are the contract
 * the other Mission control units build against; build wave 4 (RV5) writes the bodies.
 */
import type { JSX } from "preact";
import { notBuilt } from "../../stub";
import type { RenderViewCtx } from "../../types";

/**
 * Props of `RecordControl`.
 */
export type RecordControlProps = { readonly ctx: RenderViewCtx };

/**
 * The Record button and pill: Record, Stop, who started it.
 *
 * @param _props - ctx.
 * @returns The element.
 * @throws {Error} Until build wave 4: "renderView components/RecordControl is not built yet".
 */
export function RecordControl(_props: RecordControlProps): JSX.Element {
  return notBuilt("components/RecordControl", 4);
}

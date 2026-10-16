/**
 * @file renderView components (connection) — The health line: pulse dot, the latency sparkline,
 * ms and the transport words. Typed stub of build wave 0 (spec 09 § M17, RV0): the signatures
 * are the contract the other Mission control units build against; build wave 4 (RV5) writes the
 * bodies.
 */
import type { JSX } from "preact";
import { notBuilt } from "../../stub";
import type { RenderViewCtx } from "../../types";

/**
 * Props of `HealthLine`.
 */
export type HealthLineProps = { readonly ctx: RenderViewCtx };

/**
 * The health line: pulse dot, the latency sparkline, ms and the transport words.
 *
 * @param _props - ctx.
 * @returns The element.
 * @throws {Error} Until build wave 4: "renderView components/HealthLine is not built yet".
 */
export function HealthLine(_props: HealthLineProps): JSX.Element {
  return notBuilt("components/HealthLine", 4);
}

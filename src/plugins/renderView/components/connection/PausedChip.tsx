/**
 * @file renderView components (connection) — The paused chip of a device source: the local
 * preview's pause state. Typed stub of build wave 0 (spec 09 § M17, RV0): the signatures are
 * the contract the other Mission control units build against; build wave 4 (RV5) writes the
 * bodies.
 */
import type { JSX } from "preact";
import { notBuilt } from "../../stub";
import type { RenderViewCtx } from "../../types";

/**
 * Props of `PausedChip`.
 */
export type PausedChipProps = { readonly ctx: RenderViewCtx };

/**
 * The paused chip of a device source: the local preview's pause state.
 *
 * @param _props - ctx.
 * @returns The element.
 * @throws {Error} Until build wave 4: "renderView components/PausedChip is not built yet".
 */
export function PausedChip(_props: PausedChipProps): JSX.Element {
  return notBuilt("components/PausedChip", 4);
}

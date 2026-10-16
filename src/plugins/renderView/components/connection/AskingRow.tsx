/**
 * @file renderView components (connection) — An asking-to-link row: model, address, the 4-digit
 * code input, Link and Refuse. Typed stub of build wave 0 (spec 09 § M17, RV0): the signatures
 * are the contract the other Mission control units build against; build wave 4 (RV5) writes the
 * bodies.
 */
import type { JSX } from "preact";
import { notBuilt } from "../../stub";
import type { RenderViewCtx } from "../../types";

/**
 * Props of `AskingRow`.
 */
export type AskingRowProps = { readonly ctx: RenderViewCtx };

/**
 * An asking-to-link row: model, address, the 4-digit code input, Link and Refuse.
 *
 * @param _props - ctx.
 * @returns The element.
 * @throws {Error} Until build wave 4: "renderView components/AskingRow is not built yet".
 */
export function AskingRow(_props: AskingRowProps): JSX.Element {
  return notBuilt("components/AskingRow", 4);
}

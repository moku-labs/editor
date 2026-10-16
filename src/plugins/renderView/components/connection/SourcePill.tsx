/**
 * @file renderView components (connection) — The source pill: icon, name, status tag and sub
 * line. Typed stub of build wave 0 (spec 09 § M17, RV0): the signatures are the contract the
 * other Mission control units build against; build wave 4 (RV5) writes the bodies.
 */
import type { JSX } from "preact";
import { notBuilt } from "../../stub";
import type { RenderViewCtx } from "../../types";

/**
 * Props of `SourcePill`.
 */
export type SourcePillProps = { readonly ctx: RenderViewCtx };

/**
 * The source pill: icon, name, status tag and sub line.
 *
 * @param _props - ctx.
 * @returns The element.
 * @throws {Error} Until build wave 4: "renderView components/SourcePill is not built yet".
 */
export function SourcePill(_props: SourcePillProps): JSX.Element {
  return notBuilt("components/SourcePill", 4);
}

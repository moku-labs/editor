/**
 * @file renderView components (cards) — The note that every card reads the same time axis and
 * selection. Typed stub of build wave 0 (spec 09 § M17, RV0): the signatures are the contract
 * the other Mission control units build against; build wave 4 (RV6) writes the bodies.
 */
import type { JSX } from "preact";
import { notBuilt } from "../../stub";
import type { RenderViewCtx } from "../../types";

/**
 * Props of `SyncNote`.
 */
export type SyncNoteProps = { readonly ctx: RenderViewCtx };

/**
 * The note that every card reads the same time axis and selection.
 *
 * @param _props - ctx.
 * @returns The element.
 * @throws {Error} Until build wave 4: "renderView components/SyncNote is not built yet".
 */
export function SyncNote(_props: SyncNoteProps): JSX.Element {
  return notBuilt("components/SyncNote", 4);
}

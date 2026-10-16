/**
 * @file renderView components (cards) — The Memory card: heap from its source, GCs, baseline,
 * Leak?, process memory and objects. Typed stub of build wave 0 (spec 09 § M17, RV0): the
 * signatures are the contract the other Mission control units build against; build wave 4 (RV6)
 * writes the bodies.
 */
import type { JSX } from "preact";
import { notBuilt } from "../../stub";
import type { RenderViewCtx } from "../../types";

/**
 * Props of `MemoryCard`.
 */
export type MemoryCardProps = { readonly ctx: RenderViewCtx };

/**
 * The Memory card: heap from its source, GCs, baseline, Leak?, process memory and objects.
 *
 * @param _props - ctx.
 * @returns The element.
 * @throws {Error} Until build wave 4: "renderView components/MemoryCard is not built yet".
 */
export function MemoryCard(_props: MemoryCardProps): JSX.Element {
  return notBuilt("components/MemoryCard", 4);
}

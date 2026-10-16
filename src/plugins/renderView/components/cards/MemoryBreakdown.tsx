/**
 * @file renderView components (cards) — The memory breakdown popover: PSS parts per process.
 * Typed stub of build wave 0 (spec 09 § M17, RV0): the signatures are the contract the other
 * Mission control units build against; build wave 4 (RV6) writes the bodies.
 */
import type { JSX } from "preact";
import { notBuilt } from "../../stub";
import type { RenderViewCtx } from "../../types";

/**
 * Props of `MemoryBreakdown`.
 */
export type MemoryBreakdownProps = { readonly ctx: RenderViewCtx };

/**
 * The memory breakdown popover: PSS parts per process.
 *
 * @param _props - ctx.
 * @returns The element.
 * @throws {Error} Until build wave 4: "renderView components/MemoryBreakdown is not built yet".
 */
export function MemoryBreakdown(_props: MemoryBreakdownProps): JSX.Element {
  return notBuilt("components/MemoryBreakdown", 4);
}

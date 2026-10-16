/**
 * @file renderView components (connection) — The linked devices: model, link, Use or In use,
 * away. Typed stub of build wave 0 (spec 09 § M17, RV0): the signatures are the contract the
 * other Mission control units build against; build wave 4 (RV5) writes the bodies.
 */
import type { JSX } from "preact";
import { notBuilt } from "../../stub";
import type { RenderViewCtx } from "../../types";

/**
 * Props of `LinkedList`.
 */
export type LinkedListProps = { readonly ctx: RenderViewCtx };

/**
 * The linked devices: model, link, Use or In use, away.
 *
 * @param _props - ctx.
 * @returns The element.
 * @throws {Error} Until build wave 4: "renderView components/LinkedList is not built yet".
 */
export function LinkedList(_props: LinkedListProps): JSX.Element {
  return notBuilt("components/LinkedList", 4);
}

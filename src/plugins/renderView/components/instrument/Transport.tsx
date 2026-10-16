/**
 * @file renderView components (instrument) — The transport: pause, Back to live, span, step and
 * jump. Typed stub of build wave 0 (spec 09 § M17, RV0): the signatures are the contract the
 * other Mission control units build against; build wave 4 (RV6) writes the bodies.
 */
import type { JSX } from "preact";
import { notBuilt } from "../../stub";
import type { RenderViewCtx } from "../../types";

/**
 * Props of `Transport`.
 */
export type TransportProps = { readonly ctx: RenderViewCtx };

/**
 * The transport: pause, Back to live, span, step and jump.
 *
 * @param _props - ctx.
 * @returns The element.
 * @throws {Error} Until build wave 4: "renderView components/Transport is not built yet".
 */
export function Transport(_props: TransportProps): JSX.Element {
  return notBuilt("components/Transport", 4);
}

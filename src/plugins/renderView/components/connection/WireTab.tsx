/**
 * @file renderView components (connection) — The By wire tab: phones adb lists, the iPhone
 * line, adb missing. Typed stub of build wave 0 (spec 09 § M17, RV0): the signatures are the
 * contract the other Mission control units build against; build wave 4 (RV5) writes the bodies.
 */
import type { JSX } from "preact";
import { notBuilt } from "../../stub";
import type { RenderViewCtx } from "../../types";

/**
 * Props of `WireTab`.
 */
export type WireTabProps = { readonly ctx: RenderViewCtx };

/**
 * The By wire tab: phones adb lists, the iPhone line, adb missing.
 *
 * @param _props - ctx.
 * @returns The element.
 * @throws {Error} Until build wave 4: "renderView components/WireTab is not built yet".
 */
export function WireTab(_props: WireTabProps): JSX.Element {
  return notBuilt("components/WireTab", 4);
}

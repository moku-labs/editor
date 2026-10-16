/**
 * @file renderView components (passes) — The Shaders & passes panel: chains, the heaviest
 * frame's passes, problems and compiles. Typed stub of build wave 0 (spec 09 § M17, RV0): the
 * signatures are the contract the other Mission control units build against; build wave 4 (RV6)
 * writes the bodies.
 */
import type { JSX } from "preact";
import { notBuilt } from "../../stub";
import type { RenderViewCtx } from "../../types";

/**
 * Props of `PassesPanel`.
 */
export type PassesPanelProps = { readonly ctx: RenderViewCtx };

/**
 * The Shaders & passes panel: chains, the heaviest frame's passes, problems and compiles.
 *
 * @param _props - ctx.
 * @returns The element.
 * @throws {Error} Until build wave 4: "renderView components/PassesPanel is not built yet".
 */
export function PassesPanel(_props: PassesPanelProps): JSX.Element {
  return notBuilt("components/PassesPanel", 4);
}

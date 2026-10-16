/**
 * @file renderView components (scene) — The collapsible "Scene details" section around the
 * scene cards, collapsed by default. Typed stub of build wave 0 (spec 09 § M17, RV0): the
 * signatures are the contract the other Mission control units build against; build wave 4 (RV6)
 * writes the bodies.
 */
import type { JSX } from "preact";
import { notBuilt } from "../../stub";
import type { RenderViewCtx } from "../../types";

/**
 * Props of `SceneDetails`.
 */
export type SceneDetailsProps = { readonly ctx: RenderViewCtx };

/**
 * The collapsible "Scene details" section around the scene cards, collapsed by default.
 *
 * @param _props - ctx.
 * @returns The element.
 * @throws {Error} Until build wave 4: "renderView components/SceneDetails is not built yet".
 */
export function SceneDetails(_props: SceneDetailsProps): JSX.Element {
  return notBuilt("components/SceneDetails", 4);
}

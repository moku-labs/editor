/**
 * @file renderView plugin — the Render panel: no sources (the plugin owns its watches: the tracker
 * for the session, the scene only while Render is shown).
 */
import type { PanelSpec } from "../panels/types";
import type { RenderViewCtx } from "./types";

/**
 * The Render panel: `definePanel({ id: "render", title: "Render", workspace: "render", sources: {}, view })`.
 *
 * @param _ctx - Domain context of renderView.
 * @example
 * ```ts
 * ctx.require(panelsPlugin).register(createRenderPanel(ctx));
 * ```
 */
export function createRenderPanel(_ctx: RenderViewCtx): PanelSpec {
  throw new Error("not implemented");
}

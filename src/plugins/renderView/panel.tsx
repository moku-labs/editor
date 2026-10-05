/**
 * @file renderView plugin — the Render panel: no sources (the plugin owns its watches: the tracker
 * for the session, the scene only while Render is shown; panel sources would keep the large scene
 * watches alive while the panel stays mounted and hidden).
 */
import { definePanel } from "../panels/shared/define";
import type { PanelElement, PanelSpec, PanelTools, PanelValues } from "../panels/types";
import { RenderWorkspace } from "./components/RenderWorkspace";
import type { RenderViewCtx } from "./types";

/**
 * The view of the Render panel: the workspace with this render's link status.
 *
 * @param ctx - Domain context of renderView.
 * @returns The panel view.
 */
function viewOf(
  ctx: RenderViewCtx
): (
  values: PanelValues<Readonly<Record<never, never>>>,
  tools: Pick<PanelTools<Readonly<Record<never, string>>>, "status" | "workspace">
) => PanelElement {
  return (_values, tools) => (
    <RenderWorkspace ctx={ctx} status={tools.status} workspace={tools.workspace} />
  );
}

/**
 * The Render panel: `definePanel({ id: "render", title: "Render", workspace: "render", sources: {}, view })`.
 *
 * @param ctx - Domain context of renderView.
 * @returns The frozen panel spec.
 */
export function createRenderPanel(ctx: RenderViewCtx): PanelSpec {
  return definePanel({
    id: "render",
    title: "Render",
    workspace: "render",
    sources: {},
    view: viewOf(ctx)
  });
}

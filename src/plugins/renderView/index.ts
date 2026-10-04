/**
 * Standard tier — the Render workspace: metric tiles, render tree, textures, bundles, pools and
 * the release log, from watched frame sources (R6). Emits the global `workspace:inspect` (R9);
 * hooks `workspace:changed`, `link:status`, `workspace:reveal`.
 *
 * @see README.md
 */
import { createToolsPlugin } from "../../config";
import { linkPlugin } from "../link";
import { panelsPlugin } from "../panels";
import { DEFAULT_MANIFEST_PATHS } from "../panels/shared/manifest-paths";
import { workspacePlugin } from "../workspace";
import { createRenderViewApi } from "./api";
import { createHandlers } from "./handlers";
import { initRenderView, startRenderView, stopRenderView } from "./lifecycle";
import { createRenderViewState } from "./state";
import type { RenderViewConfig } from "./types";

const defaultConfig: RenderViewConfig = {
  fpsSamples: 60,
  releaseLogMax: 50,
  manifestPaths: DEFAULT_MANIFEST_PATHS
};

/**
 * The Render workspace plugin.
 *
 * @example
 * ```ts
 * app.workspace.show("render");
 * app.renderView.snapshot().tiles.drawCalls; // { kind: "absent" } in a production build
 * ```
 */
export const renderViewPlugin = createToolsPlugin("renderView", {
  depends: [linkPlugin, workspacePlugin, panelsPlugin],
  config: defaultConfig,
  createState: createRenderViewState,
  api: createRenderViewApi,
  hooks: createHandlers,
  onInit: initRenderView,
  // @no-resource-check — onStart opens the link watches; onStop drops them and the overlay root
  onStart: startRenderView,
  onStop: stopRenderView
});

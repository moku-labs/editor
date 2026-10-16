/**
 * Complex tier — the Render workspace, "Mission control" (spec 09 § Delta 2026-10-16): one active
 * source named in a connection bar (from activeSource), a live frame timeline over a 2-minute
 * history with pause, rewind, step and range selection, an inspector, sparkline cards on the shared
 * time axis, a Shaders & passes panel, and the scene cards (render tree, textures, bundles, pools,
 * release log) in "Scene details". Sub-domains `source/`, `series/`, `view/`, `timeline/`,
 * `derive/`, `actions/`, `components/` share one root state. Emits the global `workspace:inspect`
 * and `workspace:open-file`; hooks `workspace:changed`, `link:status`, `link:project`,
 * `workspace:reveal` and activeSource's `activeSource:changed` and `activeSource:connect-requested`.
 * Build wave 3 (RV1–RV4) built the data, the painters, the words and the wiring; Mission control's
 * components and the paint loop are typed stubs until build wave 4.
 *
 * @see README.md
 */
import { createToolsPlugin } from "../../config";
import { activeSourcePlugin } from "../activeSource";
import { linkPlugin } from "../link";
import { panelsPlugin } from "../panels";
import { workspacePlugin } from "../workspace";
import { createRenderViewApi } from "./api";
import { createHandlers } from "./handlers";
import { initRenderView, startRenderView, stopRenderView } from "./lifecycle";
import { createRenderViewState } from "./state";
import type { RenderViewConfig } from "./types";

const defaultConfig: RenderViewConfig = {
  releaseLogMax: 50
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
  depends: [linkPlugin, workspacePlugin, panelsPlugin, activeSourcePlugin],
  config: defaultConfig,
  createState: createRenderViewState,
  api: createRenderViewApi,
  hooks: createHandlers,
  onInit: initRenderView,
  // @no-resource-check — onStart opens the link watches; onStop drops them, Mission control's listeners and the overlay root
  onStart: startRenderView,
  onStop: stopRenderView
});

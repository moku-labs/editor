/**
 * VeryComplex tier — the Flow workspace: canvas, hub-lane layout, focus, notes, Inspector.
 * Declares no events; emits the global `workspace:open-file` (its commands run through
 * panels.run). Hooks `link:status`, `workspace:changed`, `workspace:select-node`,
 * `workspace:focus-frame`, `workspace:new-note`.
 *
 * @see README.md
 */
import { createToolsPlugin } from "../../config";
import { linkPlugin } from "../link";
import { panelsPlugin } from "../panels";
import { workspacePlugin } from "../workspace";
import { createFlowViewApi } from "./api";
import { createHandlers } from "./handlers";
import { initFlowView, stopFlowView } from "./lifecycle";
import { createFlowViewState } from "./state";
import type { FlowViewConfig } from "./types";

const defaultConfig: FlowViewConfig = {
  historyLast: 20,
  trailLength: 6,
  rejectedOutcomes: ["rejected"],
  hubMinOutcomes: 6,
  hubMinReturns: 4,
  layoutFile: ".moku/editor/layout.json",
  notesDir: ".moku/notes",
  stylesFile: "features/ui/styles.ts",
  layoutWorker: true,
  layoutSaveDelayMs: 400,
  styleSaveDelayMs: 600,
  minZoom: 0.08,
  maxZoom: 3,
  defaultMinZoom: 0.8
};

/**
 * Flow workspace plugin (tools core): `app.flowView.camera | focus | flows | layout | notes`.
 *
 * @example
 * ```ts
 * const app = createApp({});
 * await app.start();
 * app.flowView.focus.select("board/merge");
 * ```
 */
export const flowViewPlugin = createToolsPlugin("flowView", {
  depends: [linkPlugin, workspacePlugin, panelsPlugin],
  config: defaultConfig,
  createState: createFlowViewState,
  api: createFlowViewApi,
  hooks: createHandlers,
  onInit: initFlowView,
  // @no-resource-check — onStop terminates the ELK worker, clears timers and rAF, runs the removers
  onStop: stopFlowView
});

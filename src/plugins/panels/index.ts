/**
 * Standard tier — hosts definePanel panels in the tools page: owns their source watches through
 * link, waits for first values, renders views, marks stale data, tears everything down. Emits
 * the global `workspace:ran` for runs made through tools.run; hooks `link:status` and
 * `workspace:changed`. Pure view modules live in ./shared/.
 *
 * @see README.md
 */
import { createToolsPlugin } from "../../config";
import { linkPlugin } from "../link";
import { workspacePlugin } from "../workspace";
import { createPanelsApi } from "./api";
import { createHandlers } from "./handlers";
import { startPanels, stopPanels } from "./lifecycle";
import { createPanelsState } from "./state";
import type { PanelsConfig } from "./types";

const defaultConfig: PanelsConfig = {};

/**
 * Panels plugin: the panel host of the tools page.
 *
 * @example
 * ```ts
 * app.panels.list().length; // 6: one panel per workspace
 * ```
 */
export const panelsPlugin = createToolsPlugin("panels", {
  depends: [linkPlugin, workspacePlugin],
  config: defaultConfig,
  createState: createPanelsState,
  api: createPanelsApi,
  hooks: createHandlers,
  // @no-resource-check — onStart subscribes watches and renders DOM; onStop unsubscribes and unmounts
  onStart: startPanels,
  onStop: stopPanels
});

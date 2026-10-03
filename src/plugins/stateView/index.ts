/**
 * Standard tier — the State workspace: player and session trees, the last commit derived by
 * diffing game.model snapshots (R4), and the runner card. Emits nothing; hooks the global
 * `link:status` and `workspace:ran`.
 *
 * @see README.md
 */
import { createToolsPlugin } from "../../config";
import { linkPlugin } from "../link";
import { panelsPlugin } from "../panels";
import { createStateViewApi } from "./api";
import { createHandlers } from "./handlers";
import { registerStatePanel, startStateView, stopStateView } from "./lifecycle";
import { createStateViewState } from "./state";
import type { Config } from "./types";

const defaultConfig: Config = { expandDepth: 2, maxPatches: 200, pageSize: 100 };

/**
 * The stateView plugin: the State workspace of the tools page.
 *
 * @example
 * ```ts
 * const app = createApp({});
 * await app.start();
 * app.stateView.lastCommit()?.patches.length; // 4 after the tap at frame 1503
 * ```
 */
export const stateViewPlugin = createToolsPlugin("stateView", {
  depends: [linkPlugin, panelsPlugin],
  config: defaultConfig,
  createState: createStateViewState,
  api: createStateViewApi,
  hooks: createHandlers,
  onInit: registerStatePanel,
  // @no-resource-check — onStart opens the link watches and the manifest listener; onStop drops them
  onStart: startStateView,
  onStop: stopStateView
});

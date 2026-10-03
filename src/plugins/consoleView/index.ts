/**
 * Standard tier — the Console workspace: the game log watched for the session (R6), level filter,
 * search, clear, preserve log, command errors and the rail badge. Declares no events; emits the
 * global `workspace:focus-frame`, hooks `link:status` and `workspace:ran`.
 *
 * @see README.md
 */
import { createToolsPlugin } from "../../config";
import { linkPlugin } from "../link";
import { panelsPlugin } from "../panels";
import { workspacePlugin } from "../workspace";
import { createConsoleApi } from "./api";
import { createHandlers } from "./handlers";
import { registerConsolePanel, startConsole, stopConsole } from "./lifecycle";
import { createConsoleState } from "./state";
import type { Config } from "./types";

const defaultConfig: Config = {
  maxLines: 5000,
  preserveLog: false,
  freshMs: 1200,
  summaryChars: 160
};

/**
 * The consoleView plugin: the Console workspace of the tools page.
 *
 * @example
 * ```ts
 * const app = createApp({});
 * await app.start();
 * app.consoleView.setFilter({ level: "warn" });
 * ```
 */
export const consoleViewPlugin = createToolsPlugin("consoleView", {
  depends: [linkPlugin, workspacePlugin, panelsPlugin],
  config: defaultConfig,
  createState: createConsoleState,
  api: createConsoleApi,
  hooks: createHandlers,
  onInit: registerConsolePanel,
  // @no-resource-check — onStart opens the game.log watch; onStop drops it and the palette items
  onStart: startConsole,
  onStop: stopConsole
});

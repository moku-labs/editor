/**
 * Complex tier — the Files workspace: project tree, tabs, viewer and editor with syntax colour,
 * save with version conflicts, Used by, previews and the D-07 reload after a game source save.
 * Used by, the node and flow files and the tabs that follow moved files come from the project
 * index (`link.project()`). Declares no events; emits the global `workspace:select-node` and
 * `workspace:open-sheet`, hooks `link:status`, `link:project`, `workspace:changed`,
 * `workspace:open-file` (R4).
 *
 * @see README.md
 */
import { createToolsPlugin } from "../../config";
import { linkPlugin } from "../link";
import { panelsPlugin } from "../panels";
import { workspacePlugin } from "../workspace";
import { createFilesViewApi } from "./api";
import { createHandlers } from "./handlers";
import { initFilesView, startFilesView, stopFilesView } from "./lifecycle";
import { createFilesViewState } from "./state";
import type { Config } from "./types";

const defaultConfig: Config = {
  maxFiles: 5000,
  maxHighlightChars: 512_000,
  reloadExtensions: [".ts", ".tsx", ".css", ".json"],
  revalidateMs: 2000
};

/**
 * The filesView plugin: the Files workspace of the tools page.
 *
 * @example
 * ```ts
 * const app = createApp();
 * await app.start();
 * await app.filesView.open("nodes/merge.ts", { line: 12 });
 * app.filesView.usedBy("nodes/merge.ts").nodes; // [{ flow: "board", node: "merge" }]
 * ```
 */
export const filesViewPlugin = createToolsPlugin("filesView", {
  depends: [linkPlugin, workspacePlugin, panelsPlugin],
  config: defaultConfig,
  createState: createFilesViewState,
  api: createFilesViewApi,
  hooks: createHandlers,
  onInit: initFilesView,
  // @no-resource-check — onStart adds the beforeunload and manifest listeners; onStop removes them
  onStart: startFilesView,
  onStop: stopFilesView
});

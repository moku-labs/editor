/**
 * Complex tier — the tools shell: top bar, rail, pinned preview, palette, toasts, stale bars,
 * keyboard, preferences, the single game iframe and the D-07 reload. Emits the global tools
 * events `workspace:changed` and `workspace:ran`; hooks `link:status`.
 *
 * @see README.md
 */
import { createToolsPlugin } from "../../config";
import { linkPlugin } from "../link";
import { createWorkspaceApi } from "./api";
import { createHandlers } from "./handlers";
import { initWorkspace, startWorkspace, stopWorkspace } from "./lifecycle";
import { createWorkspaceState } from "./state";
import type { WorkspaceConfig } from "./types";

const defaultConfig: WorkspaceConfig = {
  defaultWorkspace: "flow",
  storageKey: "moku-editor",
  reloadTimeoutMs: 15_000,
  toastMs: 2600
};

/**
 * Workspace plugin: the tools shell and the single game frame. The tools page entry mounts it
 * after start: `await editor.start(); editor.workspace.mount(root)` (R3).
 *
 * @example
 * ```ts
 * app.workspace.show("game");
 * ```
 */
export const workspacePlugin = createToolsPlugin("workspace", {
  depends: [linkPlugin],
  config: defaultConfig,
  createState: createWorkspaceState,
  api: createWorkspaceApi,
  hooks: createHandlers,
  onInit: initWorkspace,
  // @no-resource-check — onStart adds window and manifest listeners; mount() adds the shell and the iframe; onStop removes them
  onStart: startWorkspace,
  onStop: stopWorkspace
});

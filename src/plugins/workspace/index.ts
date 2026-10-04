/**
 * Complex tier — the tools shell: top bar (with the ⋯ menu below 900 px), rail, pinned preview,
 * palette, toasts, stale bars, keyboard, preferences (theme, density, preview, device and fold,
 * taps), Reference mode, the Hot reload switch, tap ripples, the single game iframe and the D-07
 * reload (which leaves the reload to Bun after a save when hot reload is on). Emits the global tools events `workspace:changed`,
 * `workspace:ran`, `workspace:density` and `workspace:reference`; hooks `link:status`.
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
  defaultWorkspace: "game",
  storageKey: "moku-editor",
  reloadTimeoutMs: 15_000,
  hotReloadWaitMs: 1500,
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
  // @no-resource-check — onStart adds window, manifest, tap and hot reload listeners; mount() adds the shell and the iframe; onStop removes them
  onStart: startWorkspace,
  onStop: stopWorkspace
});

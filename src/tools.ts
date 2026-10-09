// biome-ignore-all assist/source/organizeImports: sectioned entry (Framework API → Plugins → Types) is house style
/**
 * The `@moku-labs/editor/tools` entry: the tools core for the tools page. Default plugins: link
 * (the websocket to the hub), workspace (the shell and the one game frame), panels (the panel
 * host) and the six workspaces flowView, gameView, renderView, stateView, filesView, consoleView.
 * The prebuilt tools page composes it in `src/plugins/pages/page/main.tsx` (D-06).
 *
 * Plugin options and their defaults, set through `pluginConfigs`:
 *
 * | Plugin | Option | Default |
 * |---|---|---|
 * | link | retryMs | 1000 |
 * | link | boot | "#moku-editor-boot" |
 * | link | role | "page" |
 * | link | reloadGraceMs | 8000 |
 * | workspace | defaultWorkspace | "game" |
 * | workspace | storageKey | "moku-editor" |
 * | workspace | reloadTimeoutMs | 15000 |
 * | workspace | hotReloadWaitMs | 1500 |
 * | workspace | toastMs | 2600 |
 * | flowView | historyLast | 20 |
 * | flowView | trailLength | 6 |
 * | flowView | rejectedOutcomes | ["rejected"] |
 * | flowView | styleSaveDelayMs | 600 |
 * | flowView | layout | { file: ".moku/editor/layout.json", worker: true, saveDelayMs: 400 } |
 * | flowView | zoom | { min: 0.08, max: 3, defaultMin: 0.8 } |
 * | flowView | hub | { minOutcomes: 6, minReturns: 4 } |
 * | gameView | capturesDir | ".moku/captures" |
 * | gameView | captureCardMs | 10000 |
 * | gameView | seriesDurationsMs | [1000, 2000, 5000, 10000, 20000] |
 * | gameView | seriesIntervalsMs | [16, 50, 100, 250, 500, 1000] |
 * | gameView | seriesWarnShots | 200 |
 * | renderView | fpsSamples | 60 |
 * | renderView | releaseLogMax | 50 |
 * | stateView | expandDepth | 2 |
 * | stateView | maxPatches | 200 |
 * | stateView | pageSize | 100 |
 * | filesView | maxFiles | 5000 |
 * | filesView | maxHighlightChars | 512000 |
 * | filesView | reloadExtensions | [".ts", ".tsx", ".css", ".json"] |
 * | filesView | revalidateMs | 2000 |
 * | consoleView | maxLines | 5000 |
 * | consoleView | preserveLog | false |
 * | consoleView | freshMs | 1200 |
 * | consoleView | summaryChars | 160 |
 *
 * An object option (flowView `layout`, `zoom`, `hub`) replaces its default as a whole. Where the
 * game's code, text styles and asset manifest live is not an option: the files plugin's project
 * index answers it (`link.project()`, `link.files.find`).
 *
 * @file The tools page entry: the tools core and its plugins.
 * @example
 * ```ts
 * const tools = createApp({});
 * await tools.start();
 * tools.workspace.mount(document.querySelector<HTMLElement>("[data-editor-root]")!);
 * ```
 */
import { createToolsCore, toolsCoreConfig } from "./config";
import { consoleViewPlugin } from "./plugins/consoleView";
import { filesViewPlugin } from "./plugins/filesView";
import { flowViewPlugin } from "./plugins/flowView";
import { gameViewPlugin } from "./plugins/gameView";
import { linkPlugin } from "./plugins/link";
import { panelsPlugin } from "./plugins/panels";
import { renderViewPlugin } from "./plugins/renderView";
import { stateViewPlugin } from "./plugins/stateView";
import { workspacePlugin } from "./plugins/workspace";

const framework = createToolsCore(toolsCoreConfig, {
  // Dependency order: workspace requires link; panels requires link and workspace; every view
  // requires link and panels (all but stateView also workspace). No view depends on another view.
  plugins: [
    linkPlugin,
    workspacePlugin,
    panelsPlugin,
    flowViewPlugin,
    gameViewPlugin,
    renderViewPlugin,
    stateViewPlugin,
    filesViewPlugin,
    consoleViewPlugin
  ]
});

// ─── Framework API ────────────────────────────────────────────
/**
 * Creates the tools page app. The tools page entry starts it, then mounts the workspace (R3).
 *
 * @example
 * ```ts
 * const tools = createApp({});
 * await tools.start();
 * tools.workspace.mount(root);
 * ```
 */
export const createApp = framework.createApp;

/**
 * Creates a plugin for the tools core, e.g. a test plugin that hooks `workspace:ran`.
 *
 * @example
 * ```ts
 * export const ranLogPlugin = createPlugin("ranLog", { hooks: createRanLogHooks });
 * ```
 */
export const createPlugin = framework.createPlugin;

// ─── Plugins ──────────────────────────────────────────────────
export { consoleViewPlugin } from "./plugins/consoleView";
export { filesViewPlugin } from "./plugins/filesView";
export { flowViewPlugin } from "./plugins/flowView";
export { gameViewPlugin } from "./plugins/gameView";
export { linkPlugin } from "./plugins/link";
export { panelsPlugin } from "./plugins/panels";
export { renderViewPlugin } from "./plugins/renderView";
export { stateViewPlugin } from "./plugins/stateView";
export { workspacePlugin } from "./plugins/workspace";

// ─── Plugin Types (namespace re-exports) ──────────────────────
export * as ConsoleView from "./plugins/consoleView/types";
export * as FilesView from "./plugins/filesView/types";
export * as FlowView from "./plugins/flowView/types";
export * as GameView from "./plugins/gameView/types";
export * as Link from "./plugins/link/types";
export * as Panels from "./plugins/panels/types";
export * as RenderView from "./plugins/renderView/types";
export * as StateView from "./plugins/stateView/types";
export * as Workspace from "./plugins/workspace/types";

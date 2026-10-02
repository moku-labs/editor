// biome-ignore-all assist/source/organizeImports: two-section barrel layout (instances → type namespaces) is house style
/**
 * @file Plugin barrel — every plugin instance and its namespaced types, across the three cores.
 * No entry imports this file: it spans three runtimes (D-01), and each entry imports the plugins
 * of its own core by folder. Helpers are not here: the protocol helpers and definePanel are
 * exported from src/index.ts.
 */

// ─── Plugin Instances ────────────────────────────────────────
export { bridgePlugin } from "./bridge";
export { capturePlugin } from "./capture";
export { channelPlugin } from "./channel";
export { consoleViewPlugin } from "./consoleView";
export { filesPlugin } from "./files";
export { filesViewPlugin } from "./filesView";
export { flowViewPlugin } from "./flowView";
export { gameViewPlugin } from "./gameView";
export { hubPlugin } from "./hub";
export { linkPlugin } from "./link";
export { overlayPlugin } from "./overlay";
export { pagesPlugin } from "./pages";
export { panelsPlugin } from "./panels";
export { registryPlugin } from "./registry";
export { renderViewPlugin } from "./renderView";
export { stateViewPlugin } from "./stateView";
export { workspacePlugin } from "./workspace";

// ─── Plugin Types (namespace re-exports) ─────────────────────
// Consumers access types as Registry.RegistryApi, Link.LinkApi, Workspace.WorkspaceId, …
export * as Bridge from "./bridge/types";
export * as Capture from "./capture/types";
export * as Channel from "./channel/types";
export * as ConsoleView from "./consoleView/types";
export * as Files from "./files/types";
export * as FilesView from "./filesView/types";
export * as FlowView from "./flowView/types";
export * as GameView from "./gameView/types";
export * as Hub from "./hub/types";
export * as Link from "./link/types";
export * as Overlay from "./overlay/types";
export * as Pages from "./pages/types";
export * as Panels from "./panels/types";
export * as Registry from "./registry/types";
export * as RenderView from "./renderView/types";
export * as StateView from "./stateView/types";
export * as Workspace from "./workspace/types";

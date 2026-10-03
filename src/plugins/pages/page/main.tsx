/**
 * @file The tools page entry: composes the editor-tools app with its default plugins (link,
 * workspace, panels, flowView, gameView, renderView, stateView, filesView, consoleView), starts
 * it, then mounts the workspace on [data-editor-root] (R3: workspace does not mount in onStart).
 * link reads #moku-editor-boot by its default config and exposes it as link.boot() (R4); no
 * pluginConfigs here (R7).
 */
import { createApp } from "../../../tools";

const root = document.querySelector<HTMLElement>("[data-editor-root]");

try {
  if (!root) throw new Error("the tools page has no [data-editor-root] element");
  const editor = createApp({});
  await editor.start();
  editor.workspace.mount(root);
} catch (error) {
  // The only error surface before the workspace exists (no console: MC2).
  if (root) {
    root.dataset.editorFatal = "";
    root.textContent = `moku editor failed to start: ${error instanceof Error ? error.message : String(error)}`;
  }
}

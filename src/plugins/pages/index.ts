/**
 * Complex tier — serves the tools page (boot JSON injected), its assets, the hello route and the
 * hot reload route, registered with the hub in onInit; publishes the hot reload state through the
 * hub. The moku-editor bin lives next to it (bin.ts), its perf CLI in `perf/`; the
 * `collector:session` hook prints the perf live lines after `attachPerf`. Emits no events.
 *
 * @see README.md
 */
import { createServerPlugin } from "../../config";
import { collectorPlugin } from "../collector";
import { filesPlugin } from "../files";
import { hubPlugin } from "../hub";
import { createPagesApi } from "./api";
import { createPagesHooks } from "./handlers";
import { initPages } from "./init";
import { createPagesState } from "./state";
import type { PagesConfig } from "./types";

const defaultConfig: PagesConfig = {
  title: "moku editor",
  editorUrl: "vscode://file/{path}:{line}",
  pageDir: undefined,
  gameUrl: "/",
  toolsPage: true
};

/**
 * Pages plugin — the tools page, its assets, /__editor/hello and /__editor/hmr; the perf live
 * lines after attachPerf.
 *
 * @example
 * ```ts
 * const editor = createApp({ pluginConfigs: { pages: { editorUrl: "cursor://file/{path}:{line}" } } });
 * // tools page: http://127.0.0.1:3000/__editor/
 * ```
 */
export const pagesPlugin = createServerPlugin("pages", {
  depends: [
    filesPlugin,
    hubPlugin,
    collectorPlugin // only to see collector:session (spec/07 §5)
  ],
  config: defaultConfig,
  createState: createPagesState,
  api: createPagesApi,
  hooks: createPagesHooks,
  onInit: initPages
});

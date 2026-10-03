/**
 * Standard tier — serves the tools page (boot JSON injected), its assets and the hello route,
 * registered with the hub in onInit. The moku-editor bin lives next to it (bin.ts). Emits no events.
 *
 * @see README.md
 */
import { createServerPlugin } from "../../config";
import { filesPlugin } from "../files";
import { hubPlugin } from "../hub";
import { createPagesApi } from "./api";
import { initPages } from "./init";
import { createPagesState } from "./state";
import type { PagesConfig } from "./types";

const defaultConfig: PagesConfig = {
  title: "moku editor",
  editorUrl: "vscode://file/{path}:{line}",
  pageDir: undefined,
  gameUrl: "/"
};

/**
 * Pages plugin — the tools page, its assets and /__editor/hello.
 *
 * @example
 * ```ts
 * const editor = createApp({ pluginConfigs: { pages: { editorUrl: "cursor://file/{path}:{line}" } } });
 * // tools page: http://127.0.0.1:3000/__editor/
 * ```
 */
export const pagesPlugin = createServerPlugin("pages", {
  depends: [filesPlugin, hubPlugin],
  config: defaultConfig,
  createState: createPagesState,
  api: createPagesApi,
  onInit: initPages
});

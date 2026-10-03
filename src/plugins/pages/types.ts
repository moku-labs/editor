/**
 * @file pages plugin — type definitions: config, state, api, the bin arguments, the route deps and
 * the domain context. ToolsBoot and HelloBody come from the protocol (R1); the route types from hub.
 */
import type { Log } from "@moku-labs/common/browser";
import type { Require } from "../../config";
import type { FilesApi } from "../files/types";
import type { EditorRoutes, HubApi } from "../hub/types";

/**
 * Pages configuration.
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { pages: { editorUrl: "cursor://file/{path}:{line}" } } });
 * ```
 */
export type PagesConfig = {
  /** Tools page <title> and boot title. */
  title: string;
  /** "Open in editor" link template (D-08): {path} absolute file path, {line} 1-based line. */
  editorUrl: string;
  /** Folder with the built tools page; undefined = dist/tools next to the module. */
  pageDir: string | undefined;
  /** Same-origin URL of the game page the tools page embeds (R3). */
  gameUrl: string;
};

/**
 * Pages state.
 */
export type PagesState = {
  /** Resolved folder of the built page, or undefined when not built. Set in onInit. */
  pageDir: string | undefined;
  /** index.html of pageDir, read once on the first page request. */
  template: string | undefined;
  /** The routes registered with hub (returned by routes()). */
  routes: EditorRoutes;
};

/**
 * The pages api (`app.pages`).
 *
 * @example
 * ```ts
 * Object.keys(editor.pages.routes()); // ["/__editor", "/__editor/", "/__editor/hello", "/__editor/assets/*"]
 * ```
 */
export type PagesApi = {
  /** The routes this plugin registered with the hub in onInit (the same frozen object). */
  routes(): EditorRoutes;
};

/**
 * Parsed arguments of `moku-editor <game-html> [--port 3000] [--root .] [--help]`.
 */
export type BinArgs =
  | { readonly kind: "run"; readonly html: string; readonly port: number; readonly root: string }
  | { readonly kind: "help" }
  | { readonly kind: "error"; readonly message: string };

/**
 * What the route handlers need.
 */
export type RouteDeps = {
  readonly hub: HubApi;
  readonly files: FilesApi;
  readonly config: Readonly<PagesConfig>;
  readonly state: PagesState;
  readonly log: Log.LogApi;
};

/**
 * Domain context of pages: the kernel context is assignable to it.
 */
export type PagesCtx = {
  readonly config: Readonly<PagesConfig>;
  state: PagesState;
  readonly log: Log.LogApi;
  readonly require: Require;
};

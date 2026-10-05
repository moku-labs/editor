/**
 * @file pages plugin — type definitions: config, state, api, the bin arguments, the route deps and
 * the domain context. ToolsBoot and HelloBody come from the protocol (R1); the route types from hub.
 */
import type { Log } from "@moku-labs/common/browser";
import type { Require } from "../../config";
import type { FilesApi } from "../files/types";
import type { BunServeOptions, EditorRoutes, HubApi } from "../hub/types";
import type { HotReload } from "../registry/protocol";

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
  /** Hot reload: owner "server" with HMR off until the bin attaches its server (R6). */
  hot: HotReload;
};

/**
 * The server the bin attaches: Bun's Server is one.
 */
export type AttachedServer = { reload(options: BunServeOptions): void };

/**
 * The pages api (`app.pages`).
 *
 * @example
 * ```ts
 * Object.keys(app.pages.routes()); // ["/__editor", "/__editor/", "/__editor/hello", "/__editor/hmr", "/__editor/assets/*"]
 * ```
 */
export type PagesApi = {
  /**
   * A copy of the routes this plugin registered with the hub in onInit, keyed by URL path under
   * the hub path.
   *
   * @returns The five routes `P`, `P/`, `P/hello`, `P/hmr` and `P/assets/*`.
   * @example
   * ```ts
   * // Check which editor URLs the server answers.
   * Object.keys(app.pages.routes()); // ["/__editor", "/__editor/", "/__editor/hello", "/__editor/hmr", "/__editor/assets/*"]
   * ```
   */
  routes(): EditorRoutes;
  /**
   * Tells pages that the moku-editor bin serves the game with these options: the bin owns hot
   * reload from now on, HMR is read from `options.development`, and the state goes to every tools
   * page through `hub.publish("hotReload", …)`. The bin calls it right after `Bun.serve`.
   *
   * @param server - The running server (Bun's Server).
   * @param options - The options it was started with (the result of `hub.serve`).
   * @example
   * ```ts
   * // The bin, after it started the game server.
   * const options = editor.hub.serve({ port, development: { hmr: true, console: true }, routes });
   * const server = Bun.serve(options);
   * editor.pages.attachServer(server, options);
   * editor.pages.hotReload(); // { hmr: true, owner: "bin" }
   * ```
   */
  attachServer(server: AttachedServer, options: BunServeOptions): void;
  /**
   * The hot reload state: whether Bun reloads the game page on a source change, and who owns the
   * server. A game's own `Bun.serve` (no `attachServer` call) is owner "server" with HMR off.
   *
   * @returns A fresh `{ hmr, owner }`.
   * @example
   * ```ts
   * // A game's own dev server that never attached it.
   * app.pages.hotReload(); // { hmr: false, owner: "server" }
   * ```
   */
  hotReload(): HotReload;
  /**
   * Asks for Bun HMR on or off, and publishes the state. Bun 1.3.14 cannot switch HMR on a
   * running server, so the switch is read-only: a game's own server always answers false, the
   * bin answers true only when its HMR already equals `on`. Restart the bin to change hot reload.
   *
   * @param on - The asked value.
   * @returns True when the bin owns the server and its HMR already equals `on`; false otherwise
   * (a game's own server always answers false).
   * @example
   * ```ts
   * // The bin serves with HMR on.
   * await editor.pages.setHotReload(true); // true: already on
   * await editor.pages.setHotReload(false); // false: Bun keeps HMR on until the bin restarts
   * ```
   */
  setHotReload(on: boolean): Promise<boolean>;
};

/**
 * Arguments of `moku-editor <game-html> [--port 3000] [--root .] [--no-hmr]`: serve the game.
 */
export type RunArgs = {
  readonly kind: "run";
  readonly html: string;
  readonly port: number;
  readonly root: string;
  /** False with `--no-hmr`: Bun serves the game without hot reload. */
  readonly hmr: boolean;
};

/**
 * Arguments of `moku-editor mcp [<game-html>] [--port N] [--root DIR] [--no-hmr]`: the stdio MCP
 * bridge. `html`, `port` and `hmr` only feed the bin the bridge starts when none runs; a live
 * `.moku/editor.json` under `root` wins.
 */
export type McpArgs = {
  readonly kind: "mcp";
  /** The game HTML file, when given. */
  readonly html?: string;
  /** The port, when `--port` was given. */
  readonly port?: number;
  /** The project root (default "."): where `.moku/editor.json` is read. */
  readonly root: string;
  /** False with `--no-hmr`. */
  readonly hmr: boolean;
};

/**
 * Arguments of `moku-editor mcp-config [<game-html>] [--port N]`: print the `.mcp.json` snippet
 * and the `claude mcp add` line for the same `mcp` arguments.
 */
export type McpConfigArgs = {
  readonly kind: "mcp-config";
  /** The game HTML file, when given. */
  readonly html?: string;
  /** The port, when `--port` was given. */
  readonly port?: number;
};

/**
 * Parsed arguments of the bin: serve, the two MCP subcommands, help, or an error.
 */
export type BinArgs =
  | RunArgs
  | McpArgs
  | McpConfigArgs
  | { readonly kind: "help" }
  | { readonly kind: "error"; readonly message: string };

/**
 * The discovery file `<root>/.moku/editor.json` a serving bin writes (mode 0600) and removes on
 * stop: how the MCP bridge finds the running editor. Holds the hub token, so it is never printed
 * or logged.
 */
export type EditorDiscovery = {
  readonly version: 1;
  /** The bin's process id (the bridge treats a dead pid as no bin). */
  readonly pid: number;
  /** The real port on 127.0.0.1. */
  readonly port: number;
  /** `http://127.0.0.1:<port>`. */
  readonly url: string;
  /** `ws://127.0.0.1:<port><P>/ws`, without the query. */
  readonly ws: string;
  /** The hub token of this start. */
  readonly token: string;
  /** The absolute project root. */
  readonly root: string;
  /** The absolute game HTML file. */
  readonly html: string;
  /** `Date.now()` when the file was written. */
  readonly startedAt: number;
};

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

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
  /** The bin's serve options and restart (D-32), set by attachServer; undefined for a game's own server. */
  served: ServedGame | undefined;
};

/**
 * The server the bin attaches: Bun's Server is one. Pages reads nothing of it; a Hot reload switch
 * goes through the bin's restart, which reaches the current server (A9).
 */
export type AttachedServer = {
  /** The real port, undefined for a unix socket. */
  readonly port?: number | undefined;
  /**
   * Stops the server.
   *
   * @param closeActiveConnections - True closes the open connections at once.
   * @returns Resolves once the server stopped.
   */
  stop(closeActiveConnections?: boolean): Promise<void>;
};

/**
 * The bin's restart (D-32): stops its game server and serves these options on the same port. The
 * hub keeps running, so its token stays. Rejects when the new server cannot start.
 *
 * @example
 * ```ts
 * const restart: RestartServer = next => game.restart(next);
 * await restart({ ...options, development: { hmr: false, console: true } });
 * ```
 */
export type RestartServer = (options: BunServeOptions) => Promise<void>;

/**
 * What pages keeps of the bin's server: its options and its restart.
 */
export type ServedGame = {
  /** The options the server runs with; the asked ones from the moment a switch is accepted. */
  readonly options: BunServeOptions;
  /** The bin's restart; undefined when the server was attached without one (no switch then). */
  readonly restart: RestartServer | undefined;
};

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
   * page through `hub.publish("hotReload", …)`. With `restart`, `setHotReload` can switch HMR by
   * restarting the server (D-32). The bin calls it right after its first `Bun.serve`.
   *
   * @param options - The options it was started with (the result of `hub.serve`).
   * @param restart - Stops the bin's current server and serves new options on the same port.
   * @example
   * ```ts
   * // The bin, after it started the game server.
   * const options = editor.hub.serve({ port, development: { hmr: true, console: true }, routes });
   * const game = createGameServer(options, (code, reason) => editor.hub.closeAll(code, reason), {
   *   warn: message => ui.warn(message)
   * });
   * editor.pages.attachServer(options, next => game.restart(next));
   * editor.pages.hotReload(); // { hmr: true, owner: "bin" }
   * ```
   */
  attachServer(options: BunServeOptions, restart?: RestartServer): void;
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
   * Asks for Bun HMR on or off, and publishes the state. Bun cannot switch HMR on a running
   * server, so the bin's server restarts with HMR flipped on the same port (D-32): the asked state
   * is set and published at once, and the restart runs after the answer went out (A1). A failed
   * restart is logged, the old state is published again and the old options are served again. A
   * game's own server always answers false; a bin attached without a restart answers true only
   * when its HMR already equals `on`.
   *
   * @param on - The asked value.
   * @returns True when the bin owns the server and its HMR equals `on` or is switching to it; false
   * otherwise (a game's own server always answers false).
   * @example
   * ```ts
   * // The bin serves with HMR on; the tools page asks for it off.
   * await editor.pages.setHotReload(false); // true: the server restarts without HMR
   * editor.pages.hotReload(); // { hmr: false, owner: "bin" }
   * ```
   */
  setHotReload(on: boolean): Promise<boolean>;
};

/**
 * Arguments of `moku-editor [<game-html>] [--port 3000] [--root .] [--no-hmr] [--preload FILE]…
 * [--serve-plugin FILE]…`: serve the game. Without `html` the engine writes the page of the
 * moku-game folder at `root` (the engine page); the two lists feed only that page.
 *
 * @example
 * ```ts
 * // moku-editor --root games/timber --serve-plugin plugins/marker.ts
 * const args: RunArgs = { kind: "run", port: 3000, root: "games/timber", hmr: true, preload: [], servePlugins: ["plugins/marker.ts"] };
 * ```
 */
export type RunArgs = {
  readonly kind: "run";
  /** The game HTML file, when given; the key is left out for the engine page. */
  readonly html?: string;
  /** The port on 127.0.0.1: 3000 by default, 0 for a random free port. */
  readonly port: number;
  /** The project root as given (default "."): the editor reads and writes there. */
  readonly root: string;
  /** False with `--no-hmr`: Bun serves the game without hot reload. */
  readonly hmr: boolean;
  /** Every `--preload`, as given: files Bun preloads in the serving process (engine page only). */
  readonly preload: readonly string[];
  /** Every `--serve-plugin`, as given: Bun plugins the page bundles with (engine page only). */
  readonly servePlugins: readonly string[];
};

/**
 * `run` arguments with the game HTML file: what the bin serves, itself or from a re-spawned bin.
 *
 * @example
 * ```ts
 * const args: ServeArgs = { kind: "run", html: "/g/.moku/index.html", port: 0, root: "/g", hmr: true, preload: [], servePlugins: [] };
 * ```
 */
export type ServeArgs = RunArgs & { readonly html: string };

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
 * Arguments of `moku-editor e2e -c <playwright config> [playwright args…]`: one Playwright run per
 * project and spec file of the config, each on its own `PORT` (D-52, D-53). Only `-c` / `--config`
 * is read here; `e2e.ts` sorts the other words for the list run and the runs.
 *
 * @example
 * ```ts
 * // moku-editor e2e -c tests/browser/playwright.config.ts -g pick --headed
 * const args: E2eArgs = { kind: "e2e", config: "tests/browser/playwright.config.ts", rest: ["-g", "pick", "--headed"] };
 * ```
 */
export type E2eArgs = {
  readonly kind: "e2e";
  /** The Playwright config, as given after `-c` or `--config`. */
  readonly config: string;
  /** The other words, in order: Playwright's arguments. */
  readonly rest: readonly string[];
};

/**
 * Parsed arguments of the bin: serve, the two MCP subcommands, `e2e`, help, or an error.
 */
export type BinArgs =
  | RunArgs
  | McpArgs
  | McpConfigArgs
  | E2eArgs
  | { readonly kind: "help" }
  | { readonly kind: "error"; readonly message: string };

/**
 * A signal the re-spawning bin forwards to its child (`reexec.ts`).
 */
export type ForwardedSignal = "SIGINT" | "SIGTERM" | "SIGHUP";

/**
 * The re-spawned bin as its parent sees it.
 */
export type ReexecChild = {
  /** Resolves with the exit code. */
  readonly exited: Promise<number>;
  /** Sends a signal; throws when the child is gone. */
  kill(signal: ForwardedSignal): void;
};

/**
 * What the bin needs to re-spawn itself in the game root (`reexec.ts`): the process cwd and
 * environment, the command prefix, the spawn and the signal handlers; and, in the re-spawned bin,
 * the parent pid and an interval to notice a parent that died without a signal (A4).
 */
export type ReexecDeps = {
  /** The process cwd. */
  readonly cwd: () => string;
  /** The process environment, handed on to the child with the loop marker. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /**
   * The command words before the bin arguments: `[bun, bin script]`. The engine page inserts
   * `--config=<bunfig>` after bun.
   */
  readonly command: readonly string[];
  /** Starts the child with stdio inherited, in its own process group. */
  readonly spawn: (
    cmd: readonly string[],
    options: {
      readonly cwd: string;
      readonly env: Readonly<Record<string, string | undefined>>;
    }
  ) => ReexecChild;
  /** Adds a signal handler; returns its removal. */
  readonly onSignal: (signal: ForwardedSignal, handler: () => void) => () => void;
  /** The parent pid now (`process.ppid`, read again on each call). */
  readonly ppid: () => number;
  /** Calls `tick` every `ms` without keeping the process alive; returns the cancel. */
  readonly interval: (ms: number, tick: () => void) => () => void;
};

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

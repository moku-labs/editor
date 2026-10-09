/**
 * @file pages plugin — the engine page (B5): a moku-game folder (`index.ts` + `config.ts`, no
 * `web/`) gets its dev page from the engine. The bin imports `@moku-labs/game/cli` from the game
 * root (never from the editor's own node_modules) and calls `preparePage` with the editor's page
 * agent, the `--preload` and `--serve-plugin` files resolved against the cwd, and, when the bin
 * runs from an editor working tree, the tree's own serve plugin `scripts/tree/bundle.ts` (D-50).
 * The same import gives `watchKeys` (game 0.13.1, D-54): the bin starts the engine's keys watch
 * with it after the page is written (`watchEngineKeys`, D-55), so `generated/` stays fresh while
 * the game is served. The bin then re-runs itself under the page's bunfig (`reexec.ts`, D-51).
 */
import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path/posix";
import type {
  preparePage as gamePreparePage,
  watchKeys as gameWatchKeys,
  KeysWatcher,
  PreparedPage
} from "@moku-labs/game/cli";

/**
 * The agent module the engine page starts after the game: `src/agent-page.ts` (D-49).
 */
export const AGENT_SPECIFIER = "@moku-labs/editor/agent/page";

/**
 * The engine entry the bin resolves from the game root.
 */
const GAME_CLI = "@moku-labs/game/cli";

/**
 * The oldest engine whose cli has both `preparePage` and `watchKeys` (D-54): the range the install
 * hint names.
 */
const GAME_RANGE = ">=0.13.1";

/**
 * The package name that marks the editor's own package.json.
 */
const EDITOR_PACKAGE = "@moku-labs/editor";

/**
 * The serve plugin of an editor working tree, relative to the tree (D-50). The published package
 * has no `scripts/`, so an installed editor never adds it.
 */
const TREE_PLUGIN = "scripts/tree/bundle.ts";

/**
 * The engine's `preparePage` of `@moku-labs/game/cli`.
 *
 * @example
 * ```ts
 * const prepare: PreparePage = cli.preparePage;
 * await prepare("/games/timber", { agents: [AGENT_SPECIFIER] }); // { html: "/games/timber/.moku/index.html", bunfig: "/games/timber/.moku/bunfig.toml" }
 * ```
 */
export type PreparePage = typeof gamePreparePage;

/**
 * The engine's `watchKeys` of `@moku-labs/game/cli` (game 0.13.1): it scans the game's keys once,
 * resolves, and scans again on every save of an asset or a strings file.
 *
 * @example
 * ```ts
 * const watch: WatchKeys = cli.watchKeys;
 * const keys = await watch("/games/timber", { onError: message => ui.warn(message) });
 * keys.close(); // a later save of features/home/strings/en.json rewrites nothing in generated/
 * ```
 */
export type WatchKeys = typeof gameWatchKeys;

/**
 * What the bin needs of `@moku-labs/game/cli`: the page writer and the keys watch, both from the
 * one import of the game's own engine.
 *
 * @example
 * ```ts
 * const cli: GameCli = await importGameCli("/games/timber");
 * await cli.preparePage("/games/timber", { agents: [AGENT_SPECIFIER] });
 * const keys = await cli.watchKeys("/games/timber"); // generated/ is fresh
 * ```
 */
export type GameCli = {
  /** Writes the dev page into `<root>/.moku/`. */
  readonly preparePage: PreparePage;
  /** Starts the keys watch of the game folder. */
  readonly watchKeys: WatchKeys;
};

/**
 * The written engine page, with the cli that wrote it: the caller starts the keys watch with the
 * same cli, so the engine is imported once.
 *
 * @example
 * ```ts
 * const prepared = await prepareEnginePage("/games/timber", options, { importCli: importGameCli });
 * if (typeof prepared !== "string") {
 *   prepared.page; // { html: "/games/timber/.moku/index.html", bunfig: "/games/timber/.moku/bunfig.toml" }
 *   await watchEngineKeys("/games/timber", prepared.cli, message => ui.warn(message));
 * }
 * ```
 */
export type EnginePage = {
  /** The page the engine wrote: its HTML and its bunfig. */
  readonly page: PreparedPage;
  /** The engine's cli as the game root resolves it. */
  readonly cli: GameCli;
};

/**
 * What the engine page is written with: the bin's `--preload` and `--serve-plugin` files as given,
 * the cwd they are relative to, and the bin file (`Bun.main`), which tells an editor working tree.
 *
 * @example
 * ```ts
 * const options: EnginePageOptions = { preload: [], servePlugins: ["bundle.ts"], cwd: process.cwd(), main: Bun.main };
 * ```
 */
export type EnginePageOptions = {
  /** Files Bun preloads in the serving process, relative to `cwd` or absolute. */
  readonly preload: readonly string[];
  /** Bun plugins the page bundles with, relative to `cwd` or absolute. */
  readonly servePlugins: readonly string[];
  /** The base of relative paths: the cwd of the bin. */
  readonly cwd: string;
  /** The bin file: `Bun.main`. */
  readonly main: string;
};

/**
 * What the engine page needs from outside: the import of the engine's cli from the game root.
 *
 * @example
 * ```ts
 * // A unit test: a stub engine that writes and watches nothing (/games/timber holds index.ts and config.ts).
 * const page = { html: "/games/timber/.moku/index.html", bunfig: "/games/timber/.moku/bunfig.toml" };
 * const cli: GameCli = {
 *   preparePage: () => Promise.resolve(page),
 *   watchKeys: () => Promise.resolve({ close: () => undefined })
 * };
 * const deps: EnginePageDeps = { importCli: () => Promise.resolve(cli) };
 * await prepareEnginePage("/games/timber", { preload: [], servePlugins: [], cwd: "/games", main: Bun.main }, deps); // { page, cli }
 * ```
 */
export type EnginePageDeps = {
  /**
   * Imports `@moku-labs/game/cli` as the game root resolves it; rejects when it does not, or when
   * it lacks `preparePage` or `watchKeys`.
   */
  readonly importCli: (root: string) => Promise<GameCli>;
};

/**
 * The message of any thrown value: the bin prints it without a stack.
 *
 * @param error - The thrown value.
 * @returns Its message.
 * @example
 * ```ts
 * messageOf(new Error("x")); // "x"
 * messageOf("plain text"); // "plain text"
 * ```
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Whether a path is a file.
 *
 * @param path - An absolute path.
 * @returns True for a file, false for a folder or nothing.
 */
function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * The real path of a path, or the path itself when it does not exist.
 *
 * @param path - An absolute path.
 * @returns The real path.
 */
function realOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * Whether a package.json names the editor. A missing or broken file is not the editor.
 *
 * @param manifestPath - The package.json path.
 * @returns True for `"name": "@moku-labs/editor"`.
 */
function isEditorManifest(manifestPath: string): boolean {
  try {
    const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
    return (
      typeof manifest === "object" &&
      manifest !== null &&
      "name" in manifest &&
      manifest.name === EDITOR_PACKAGE
    );
  } catch {
    return false;
  }
}

/**
 * Whether a folder holds a moku-game: `index.ts` and `config.ts`, both files.
 *
 * @param root - The absolute folder.
 * @returns True for a moku-game folder.
 * @example
 * ```ts
 * isGameFolder("/games/timber"); // true: /games/timber/index.ts and config.ts exist
 * isGameFolder("/games/timber/web"); // false
 * ```
 */
export function isGameFolder(root: string): boolean {
  return isFile(join(root, "index.ts")) && isFile(join(root, "config.ts"));
}

/**
 * Why a folder cannot get the engine page, or undefined for a moku-game folder.
 *
 * @param root - The absolute folder.
 * @returns The `[moku-editor]` error line, or undefined.
 * @example
 * ```ts
 * gameFolderProblem("/work/editor");
 * // "[moku-editor] /work/editor has no index.ts and config.ts: pass the game HTML file, or run in a moku-game folder"
 * ```
 */
export function gameFolderProblem(root: string): string | undefined {
  if (isGameFolder(root)) return undefined;
  return `[moku-editor] ${root} has no index.ts and config.ts: pass the game HTML file, or run in a moku-game folder`;
}

/**
 * The editor package a bin file belongs to: the nearest ancestor folder of its real path whose
 * package.json is named `@moku-labs/editor`.
 *
 * @param main - The bin file, `Bun.main`.
 * @returns The real path of the package, or undefined outside any editor package.
 * @example
 * ```ts
 * packageRoot("/work/editor/dist/bin.mjs"); // "/work/editor"
 * packageRoot("/work/editor/src/plugins/pages/bin.ts"); // "/work/editor"
 * packageRoot("/usr/local/bin/other.mjs"); // undefined
 * ```
 */
export function packageRoot(main: string): string | undefined {
  let folder = dirname(realOrSelf(main));
  for (;;) {
    if (isEditorManifest(join(folder, "package.json"))) return folder;

    const parent = dirname(folder);
    if (parent === folder) return undefined;
    folder = parent;
  }
}

/**
 * The serve plugin of an editor working tree (D-50): `<tree>/scripts/tree/bundle.ts` when the
 * editor is not installed in the game (`realpath(root)/node_modules`) and the file exists.
 *
 * @param editorRoot - The editor package (`packageRoot`), or undefined.
 * @param root - The game root.
 * @returns The plugin file, or undefined for an installed editor.
 * @example
 * ```ts
 * treePlugin("/work/editor", "/work/demos/merge-game"); // "/work/editor/scripts/tree/bundle.ts"
 * treePlugin("/g/node_modules/@moku-labs/editor", "/g"); // undefined
 * ```
 */
export function treePlugin(editorRoot: string | undefined, root: string): string | undefined {
  if (editorRoot === undefined) return undefined;

  const installs = `${join(realOrSelf(root), "node_modules")}/`;
  if (`${editorRoot}/`.startsWith(installs)) return undefined;

  const plugin = join(editorRoot, TREE_PLUGIN);
  return isFile(plugin) ? plugin : undefined;
}

/**
 * Whether an imported module has the engine's `preparePage`.
 *
 * @param cli - The module.
 * @returns True when `preparePage` is a function.
 */
function hasPreparePage(cli: unknown): cli is { preparePage: PreparePage } {
  return (
    typeof cli === "object" &&
    cli !== null &&
    "preparePage" in cli &&
    typeof cli.preparePage === "function"
  );
}

/**
 * Whether an imported module has the engine's `watchKeys`.
 *
 * @param cli - The module.
 * @returns True when `watchKeys` is a function.
 */
function hasWatchKeys(cli: unknown): cli is { watchKeys: WatchKeys } {
  return (
    typeof cli === "object" &&
    cli !== null &&
    "watchKeys" in cli &&
    typeof cli.watchKeys === "function"
  );
}

/**
 * Imports `@moku-labs/game/cli` as the game root resolves it: the game's own engine. Both
 * functions are required (D-54): there is no run without the keys watch.
 *
 * @param root - The game root.
 * @returns The engine's cli.
 * @throws {Error} When it does not resolve from the root, has no `preparePage` (before 0.10.0) or
 *   has no `watchKeys` (before 0.13.1).
 * @example
 * ```ts
 * const { preparePage, watchKeys } = await importGameCli("/games/timber");
 * // A game on engine 0.13.0 rejects: "[moku-editor] @moku-labs/game/cli has no watchKeys"
 * ```
 */
export async function importGameCli(root: string): Promise<GameCli> {
  const cli: unknown = await import(Bun.resolveSync(GAME_CLI, root));
  if (!hasPreparePage(cli)) throw new Error(`[moku-editor] ${GAME_CLI} has no preparePage`);
  if (!hasWatchKeys(cli)) throw new Error(`[moku-editor] ${GAME_CLI} has no watchKeys`);
  return cli;
}

/**
 * The engine's cli as the game root resolves it, or undefined when it does not import or lacks a
 * function the bin needs.
 *
 * @param rootPath - The game root.
 * @param deps - The import of the engine's cli.
 * @returns The cli, or undefined.
 */
async function gameCliOf(rootPath: string, deps: EnginePageDeps): Promise<GameCli | undefined> {
  try {
    return await deps.importCli(rootPath);
  } catch {
    return undefined;
  }
}

/**
 * The page's serve plugins: the given ones, then the tree plugin when it is not among them.
 *
 * @param given - The absolute `--serve-plugin` files.
 * @param tree - The tree plugin, or undefined.
 * @returns The plugins in order.
 */
function withTreePlugin(given: readonly string[], tree: string | undefined): string[] {
  if (tree === undefined || given.includes(tree)) return [...given];
  return [...given, tree];
}

/**
 * Writes the engine page of a moku-game folder: checks the folder, imports the engine's cli from
 * the root, and calls `preparePage` with the editor's page agent, the preloads and the serve
 * plugins (resolved against the cwd), plus the tree plugin of an editor working tree.
 *
 * @param rootPath - The absolute game root.
 * @param options - The preloads, the serve plugins, the cwd and the bin file.
 * @param deps - The import of the engine's cli.
 * @returns The written page with the cli that wrote it, or the error line to print (the engine's
 *   `[game] …` text as is).
 * @example
 * ```ts
 * const prepared = await prepareEnginePage("/games/timber", { preload: [], servePlugins: [], cwd: "/games", main: Bun.main }, { importCli: importGameCli });
 * // { page: { html: "/games/timber/.moku/index.html", bunfig: "/games/timber/.moku/bunfig.toml" }, cli }
 * // A game on engine 0.13.0:
 * // "[moku-editor] @moku-labs/game/cli does not resolve from /games/timber: install @moku-labs/game >=0.13.1 in the game"
 * ```
 */
export async function prepareEnginePage(
  rootPath: string,
  options: EnginePageOptions,
  deps: EnginePageDeps
): Promise<EnginePage | string> {
  const problem = gameFolderProblem(rootPath);
  if (problem !== undefined) return problem;

  const cli = await gameCliOf(rootPath, deps);
  if (cli === undefined) {
    return `[moku-editor] ${GAME_CLI} does not resolve from ${rootPath}: install @moku-labs/game ${GAME_RANGE} in the game`;
  }

  // Resolve the given files against the cwd, and add the tree plugin of an editor working tree.
  const preload = options.preload.map(file => resolve(options.cwd, file));
  const given = options.servePlugins.map(file => resolve(options.cwd, file));
  const servePlugins = withTreePlugin(given, treePlugin(packageRoot(options.main), rootPath));
  try {
    const agents = [AGENT_SPECIFIER];
    const page = await cli.preparePage(rootPath, { agents, preload, servePlugins });
    return { page, cli };
  } catch (error) {
    return messageOf(error);
  }
}

/**
 * Starts the engine's keys watch of a game folder (D-54, D-55), after its page is written. It
 * resolves after the engine's first scan, so `generated/` is fresh before the game is served. A
 * failed scan, the first one too, does not reject: the engine hands its message to `onError` and
 * the watch goes on.
 *
 * @param rootPath - The absolute game root.
 * @param cli - The engine's cli, the one that wrote the page (`prepareEnginePage`).
 * @param onError - Called with the scanner's message on every failed scan.
 * @returns The running watch (`close()` stops it), or the error line to print when the engine
 *   refuses the game (its `[game] …` text as is); then no watcher is left.
 * @example
 * ```ts
 * const keys = await watchEngineKeys("/games/timber", prepared.cli, message => ui.warn(message));
 * if (typeof keys !== "string") keys.close(); // when the served game stops
 * // A game whose config.ts is refused: keys is "[game] config.ts: page.title must be a string, got 1."
 * ```
 */
export async function watchEngineKeys(
  rootPath: string,
  cli: GameCli,
  onError: (message: string) => void
): Promise<KeysWatcher | string> {
  try {
    return await cli.watchKeys(rootPath, { onError });
  } catch (error) {
    return messageOf(error);
  }
}

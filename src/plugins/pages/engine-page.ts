/**
 * @file pages plugin — the engine page (B5): a moku-game folder (`index.ts` + `config.ts`, no
 * `web/`) gets its dev page from the engine. The bin imports `@moku-labs/game/cli` from the game
 * root (never from the editor's own node_modules) and calls `preparePage` with the editor's page
 * agent, the `--preload` and `--serve-plugin` files resolved against the cwd, and, when the bin
 * runs from an editor working tree, the tree's own serve plugin `scripts/tree/bundle.ts` (D-50).
 * The bin then re-runs itself under the page's bunfig (`reexec.ts`, D-51).
 */
import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path/posix";
import type { preparePage as gamePreparePage, PreparedPage } from "@moku-labs/game/cli";

/**
 * The agent module the engine page starts after the game: `src/agent-page.ts` (D-49).
 */
export const AGENT_SPECIFIER = "@moku-labs/editor/agent/page";

/**
 * The engine entry the bin resolves from the game root.
 */
const GAME_CLI = "@moku-labs/game/cli";

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
 * const deps: EnginePageDeps = { importCli: importGameCli };
 * ```
 */
export type EnginePageDeps = {
  /** Imports `@moku-labs/game/cli` as the game root resolves it; rejects when it does not. */
  readonly importCli: (root: string) => Promise<{ preparePage: PreparePage }>;
};

/**
 * The message of any thrown value.
 *
 * @param error - The thrown value.
 * @returns Its message.
 */
function messageOf(error: unknown): string {
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
 * Imports `@moku-labs/game/cli` as the game root resolves it: the game's own engine.
 *
 * @param root - The game root.
 * @returns The engine's cli.
 * @throws {Error} When it does not resolve from the root, or has no `preparePage` (before 0.10.0).
 * @example
 * ```ts
 * const { preparePage } = await importGameCli("/games/timber");
 * ```
 */
export async function importGameCli(root: string): Promise<{ preparePage: PreparePage }> {
  const cli: unknown = await import(Bun.resolveSync(GAME_CLI, root));
  if (!hasPreparePage(cli)) throw new Error(`[moku-editor] ${GAME_CLI} has no preparePage`);
  return cli;
}

/**
 * The engine's cli as the game root resolves it, or undefined when it does not import.
 *
 * @param rootPath - The game root.
 * @param deps - The import of the engine's cli.
 * @returns The cli, or undefined.
 */
async function gameCliOf(
  rootPath: string,
  deps: EnginePageDeps
): Promise<{ preparePage: PreparePage } | undefined> {
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
 * @returns The written page, or the error line to print (the engine's `[game] …` text as is).
 * @example
 * ```ts
 * const page = await prepareEnginePage("/games/timber", { preload: [], servePlugins: [], cwd: "/games", main: Bun.main }, { importCli: importGameCli });
 * // { html: "/games/timber/.moku/index.html", bunfig: "/games/timber/.moku/bunfig.toml" }
 * ```
 */
export async function prepareEnginePage(
  rootPath: string,
  options: EnginePageOptions,
  deps: EnginePageDeps
): Promise<PreparedPage | string> {
  const problem = gameFolderProblem(rootPath);
  if (problem !== undefined) return problem;

  const cli = await gameCliOf(rootPath, deps);
  if (cli === undefined) {
    return `[moku-editor] ${GAME_CLI} does not resolve from ${rootPath}: install @moku-labs/game >=0.10.0 in the game`;
  }

  const preload = options.preload.map(file => resolve(options.cwd, file));
  const given = options.servePlugins.map(file => resolve(options.cwd, file));
  const servePlugins = withTreePlugin(given, treePlugin(packageRoot(options.main), rootPath));
  try {
    return await cli.preparePage(rootPath, { agents: [AGENT_SPECIFIER], preload, servePlugins });
  } catch (error) {
    return messageOf(error);
  }
}

/**
 * @file Bundler plugin of the engine page for a game run against this editor working tree (D-50):
 * the bin adds it to the page's serve plugins when it runs from a tree (`treePlugin` in
 * `src/plugins/pages/engine-page.ts`), or a runner passes `--serve-plugin <tree>/scripts/tree/bundle.ts`.
 * The game's imports of `@moku-labs/editor` and its page entries bundle from the tree's build
 * (`dist/<entry>.mjs`, so `bun run build` first), not from an installed package.
 *
 * The build's own imports of the engine, Pixi, core, common and preact are rewritten when its
 * files load, to the files the game root resolves (the cwd of the serving bin), so the page holds
 * one copy of each. An `onResolve` for those packages breaks Bun's dev server: the engine's `dist`
 * modules then come out with no imports, and the game fails on "defineGame is not a function"
 * (demos#46). A package the game does not have stays the tree's.
 *
 * The tree is the folder two levels above this file: no path is written down anywhere. Repo only:
 * not in the npm `files`.
 */
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BunPlugin, PluginBuilder } from "bun";

/** The editor working tree: the folder two levels above `scripts/tree/`, as a real path. */
export const treeRoot = realpathSync(fileURLToPath(new URL("../..", import.meta.url)));

/** The plugin name Bun reports in its errors. */
const PLUGIN_NAME = "moku-editor-tree";

/** The editor's package name: its imports are the package or one of its page entries. */
const EDITOR_PACKAGE = "@moku-labs/editor";

/** An import of the editor, or of the page entries `/agent/page`, `/agent` and `/tools`. */
const EDITOR_IMPORT = /^@moku-labs\/editor(?:\/agent\/page|\/agent|\/tools)?$/;

/** The packages the tree's build and the game share one copy of, with any subpath. */
const SHARED_IMPORT = /^(?:@moku-labs\/(?:game|core|common)|pixi\.js|preact)(?:\/.*)?$/;

/** A bare import in a built file: `from "x"`, `import "x"`, `import("x")`. */
const BARE_IMPORT = /(from |import |import\()"([^"./][^"]*)"/g;

/**
 * The built file of an editor import: `@moku-labs/editor` is `dist/index.mjs`, a subpath is its
 * entry with `/` written `-` (`/agent/page` is `dist/agent-page.mjs`, as tsdown names it).
 *
 * @param specifier - An import that matches `EDITOR_IMPORT`.
 * @returns The absolute path of the built file.
 * @example
 * ```ts
 * editorBuild("@moku-labs/editor/agent/page"); // "<tree>/dist/agent-page.mjs"
 * ```
 */
function editorBuild(specifier: string): string {
  const subpath = specifier.slice(EDITOR_PACKAGE.length + 1);
  const entry = subpath === "" ? "index" : subpath.replaceAll("/", "-");
  return path.join(treeRoot, "dist", `${entry}.mjs`);
}

/**
 * Sends the editor's imports to the tree's build.
 *
 * @param build - Bun's plugin builder.
 */
function editorFromTree(build: PluginBuilder): void {
  build.onResolve({ filter: EDITOR_IMPORT }, args => ({ path: editorBuild(args.path) }));
}

/**
 * Resolves shared imports from the game root, once per import.
 *
 * @param gameRoot - The game folder.
 * @returns The resolver: the absolute file, or undefined when the game does not have it.
 */
function gameResolver(gameRoot: string): (specifier: string) => string | undefined {
  const known = new Map<string, string | undefined>();
  return specifier => {
    if (!known.has(specifier)) known.set(specifier, resolveOrUndefined(specifier, gameRoot));
    return known.get(specifier);
  };
}

/**
 * Bun's resolution of an import from a folder.
 *
 * @param specifier - The import.
 * @param from - The folder it is resolved from.
 * @returns The absolute file, or undefined when it does not resolve.
 */
function resolveOrUndefined(specifier: string, from: string): string | undefined {
  try {
    return Bun.resolveSync(specifier, from);
  } catch {
    return undefined;
  }
}

/**
 * Rewrites the shared imports of the tree's built files to the game's copies, when they load.
 *
 * @param build - Bun's plugin builder.
 * @param gameRoot - The game folder.
 */
function shareWithGame(build: PluginBuilder, gameRoot: string): void {
  const dist = `${path.join(treeRoot, "dist")}${path.sep}`;
  const filter = new RegExp(`^${RegExp.escape(dist)}.*\\.m?js$`);
  const fromGame = gameResolver(gameRoot);

  build.onLoad({ filter }, async args => {
    const text = await Bun.file(args.path).text();
    const contents = text.replaceAll(BARE_IMPORT, (whole, head: string, specifier: string) => {
      const file = SHARED_IMPORT.test(specifier) ? fromGame(specifier) : undefined;
      return file === undefined ? whole : `${head}${JSON.stringify(file)}`;
    });
    return { contents, loader: "js" };
  });
}

/**
 * The tree plugin for a game root: the editor's imports from the tree's build, the build's shared
 * imports from the game.
 *
 * @param gameRoot - The game folder whose engine, Pixi, core, common and preact the page uses.
 * @returns The Bun plugin.
 * @example
 * ```ts
 * await Bun.build({ entrypoints: ["games/timber/.moku/main.ts"], plugins: [createTreeBundle("games/timber")] });
 * ```
 */
export function createTreeBundle(gameRoot: string): BunPlugin {
  return {
    name: PLUGIN_NAME,
    setup(build) {
      editorFromTree(build);
      shareWithGame(build, gameRoot);
    }
  };
}

/**
 * The plugin the engine page bundles with (`[serve.static] plugins` of `.moku/bunfig.toml`): the
 * game root is the cwd of the serving bin, the game folder.
 */
const treeBundle: BunPlugin = {
  name: PLUGIN_NAME,
  setup(build) {
    return createTreeBundle(process.cwd()).setup(build);
  }
};

export default treeBundle;

/**
 * @file The `@moku-labs/editor/agent/page` entry (D-49): the editor's page agent for the page the
 * engine writes. The engine imports agent modules by specifier and calls their default export after
 * the game app started, on the dev page (`moku-game dev`, `preparePage`) and on a debug build
 * (`moku-game build --debug`, `native build --debug`). This module only defines that function:
 * importing it starts nothing.
 */
import type { PageAgent } from "@moku-labs/game/app";
import type { Registry } from "./agent";
import { bridgePlugin, capturePlugin, createApp } from "./agent";

/**
 * Whether a field of a `.dev` module is absent or an array: the shape of `sources` and `commands`.
 *
 * @param value - The module.
 * @param key - The field.
 * @returns True when the field is absent or an array.
 */
function isAbsentOrArray(value: object, key: "sources" | "commands"): boolean {
  const field: unknown = Reflect.get(value, key);
  return field === undefined || Array.isArray(field);
}

/**
 * Whether a module the engine hands over is a `.dev` module: its `sources` and `commands` are
 * each absent or an array. One with neither is still a `.dev` module; the registry ignores it.
 *
 * @param value - One of the game's `.dev` modules, as the engine hands it over.
 * @returns True for a `.dev` module.
 * @example
 * ```ts
 * isDevModule({ commands: [addCoins] }); // true
 * isDevModule({ helper: () => 1 }); // true: no sources, no commands
 * isDevModule({ sources: "board" }); // false
 * ```
 */
function isDevModule(value: object): value is Registry.DevModule {
  return isAbsentOrArray(value, "sources") && isAbsentOrArray(value, "commands");
}

/**
 * The editor's page agent for a page the engine writes: starts the agent core with bridge and
 * capture on the running game and sets `globalThis.editor`. The engine calls it after the game app
 * started, on the dev page (`moku-game dev`) and on a debug build (`moku-game build --debug`,
 * `native build --debug`). A page with neither `__MOKU_GAME_DEV__` nor `__MOKU_GAME_AGENT__` true
 * starts nothing, and a release build, which defines both `false`, drops the body. No side effect
 * on import.
 *
 * @param page - What the engine hands every agent.
 * @param page.app - The running game app.
 * @param page.name - The page title: the game's name in the manifest.
 * @param page.modules - The game's `.dev` modules; one without sources and commands is ignored.
 * @returns Resolves once the editor started, at once when neither flag is on.
 * @example
 * ```ts
 * // .moku/main.ts, written by preparePage with agents: ["@moku-labs/editor/agent/page"]
 * await startPage(game, config, { agents: [editorAgent], devModules: [boardDev] });
 * // editorAgent({ app, name: "mini-game", modules: [boardDev] }) → globalThis.editor is live
 * ```
 */
const editorAgent: PageAgent<Registry.GameLike> = async ({ app, name, modules }) => {
  // The dev page and a debug build start the agent. The guard is inline and positive, so a release
  // build, which defines both flags false, drops this body (engine spec 10 F4: never a function call).
  if (
    (typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__) ||
    (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__)
  ) {
    // A hot re-run of .moku/main.ts calls the agent again: stop the editor of the last run first.
    const previous: { stop?: () => Promise<void> } | undefined = Reflect.get(globalThis, "editor");
    await previous?.stop?.();
    const editor = createApp({
      plugins: [bridgePlugin, capturePlugin],
      pluginConfigs: {
        registry: { game: app, name, modules: modules.filter(module => isDevModule(module)) }
      }
    });
    Reflect.set(globalThis, "editor", editor);
    await editor.start();
  }
};

export default editorAgent;

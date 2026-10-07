/**
 * @file The `@moku-labs/editor/agent/page` entry (D-49): the editor's dev agent for the page the
 * engine writes (`moku-game dev`, `preparePage`). The engine imports agent modules by specifier
 * and calls their default export after the game app started, in dev only. This module only
 * defines that function: importing it starts nothing.
 */
import type { PageAgent } from "@moku-labs/game/app";
import type { Registry } from "./agent";
import { bridgePlugin, capturePlugin, createApp } from "./agent";

/**
 * The editor's dev agent for a page the engine writes (moku-game dev, preparePage): starts the
 * agent core with bridge and capture on the running game and sets `globalThis.editor`.
 * No side effect on import: the engine calls it after the game app started, in dev only.
 *
 * @param page - What the engine hands every agent.
 * @param page.app - The running game app.
 * @param page.name - The page title: the game's name in the manifest.
 * @param page.modules - The game's `.dev` modules; one without sources and commands is ignored.
 * @returns Resolves once the editor started.
 * @example
 * ```ts
 * // .moku/main.ts, written by preparePage with agents: ["@moku-labs/editor/agent/page"]
 * await startPage(game, config, { agents: [editorAgent], devModules: [boardDev] });
 * // editorAgent({ app, name: "mini-game", modules: [boardDev] }) → globalThis.editor is live
 * ```
 */
const editorAgent: PageAgent<Registry.GameLike> = async ({ app, name, modules }) => {
  // A hot re-run of .moku/main.ts calls the agent again: stop the editor of the last run first.
  const previous: { stop?: () => Promise<void> } | undefined = Reflect.get(globalThis, "editor");
  await previous?.stop?.();
  const editor = createApp({
    plugins: [bridgePlugin, capturePlugin],
    pluginConfigs: {
      registry: { game: app, name, modules: modules as readonly Registry.DevModule[] }
    }
  });
  Reflect.set(globalThis, "editor", editor);
  await editor.start();
};

export default editorAgent;

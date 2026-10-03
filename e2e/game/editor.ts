/**
 * @file The e2e game page entry: the merge-game fixture page (`./main.ts`, a copy of the pinned
 * fixture's web/main.ts), then the editor agent with bridge and capture on the game it started.
 * The e2e webServer copies this file next to the fixture's web/ files, so every import below is
 * resolved inside the copied fixture and `@moku-labs/game` resolves to the editor's dev
 * dependency: the game and the editor share one copy of the engine.
 */
import "./main";
import type { Registry } from "../../../src/agent";
import { bridgePlugin, capturePlugin, createApp } from "../../../src/agent";

const game: Registry.GameLike = Reflect.get(globalThis, "game");

const editor = createApp({
  plugins: [bridgePlugin, capturePlugin],
  pluginConfigs: { registry: { game, name: "merge-game 0.0.0" } }
});

Reflect.set(globalThis, "editor", editor);
await editor.start();

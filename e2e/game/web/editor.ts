/**
 * @file The e2e game page entry: the tiny game page (`./main.ts`), then the editor agent with
 * bridge and capture on the game it started. e2e/prepare-game.ts copies e2e/game/ to
 * dist-e2e/game/, the same depth under the repository, so `../../../src/agent` is the editor's
 * source in both places and `@moku-labs/game` resolves to the editor's dev dependency: the game
 * and the editor share one copy of the engine.
 */
import "./main";
import type { Registry } from "../../../src/agent";
import { bridgePlugin, capturePlugin, createApp } from "../../../src/agent";

const game: Registry.GameLike = Reflect.get(globalThis, "game");

const editor = createApp({
  plugins: [bridgePlugin, capturePlugin],
  pluginConfigs: { registry: { game, name: "tiny-game 0.0.0" } }
});

Reflect.set(globalThis, "editor", editor);
await editor.start();

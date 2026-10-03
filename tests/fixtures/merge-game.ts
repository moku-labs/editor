/**
 * @file The merge-game fixture of the pinned game checkout (`tests/integration/merge-game/game.ts`
 * under `GAME_DIR` of game-dir.ts), loaded at test time only. The path is built at run time, so
 * `tsc` never type-checks the game's own sources: they compile with the game's JSX settings, not
 * with the editor's. Vitest resolves the fixture's `@moku-labs/game` imports through the
 * `resolve.alias` set of vitest.config.ts to the built `@moku-labs/game` dev dependency.
 */
import type { GameLike } from "../../src/plugins/registry/types";
import { gameFileUrl } from "./game-dir";

/**
 * Absolute URL of the fixture module.
 */
const FIXTURE = gameFileUrl("tests/integration/merge-game/game.ts");

/**
 * What a test holds on to: the app of the merge game (the registry's `game`).
 */
export type MergeGame = { readonly app: GameLike };

/**
 * The fixture functions the editor tests use: headless, and with the (inert) screen.
 */
export type MergeGameFixture = {
  createGame(options?: { readonly seed?: number }): MergeGame;
  createScreenGame(options?: { readonly seed?: number }): MergeGame;
};

/**
 * Loads the merge-game fixture module. Tests set `globalThis.__MOKU_GAME_DEV__ = true` before
 * they run a door command and delete it afterwards.
 *
 * @returns The fixture's `createGame` and `createScreenGame`.
 * @example
 * ```ts
 * const { createGame } = await loadMergeGame();
 * const { app } = createGame();
 * ```
 */
export async function loadMergeGame(): Promise<MergeGameFixture> {
  const fixture: MergeGameFixture = await import(/* @vite-ignore */ FIXTURE);
  return fixture;
}

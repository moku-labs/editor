/**
 * @file Merge-game helpers of the root integration wave (plan §2.7), local only. They call
 * `loadMergeGame` and the game repository's `timber-helpers.ts`, both of which need the pinned
 * game checkout of tests/fixtures/game-dir.ts. CI test files never import this module: vitest.config.ts skips only the
 * test files whose text names `loadMergeGame`, so a local-only test imports it and says
 * `loadMergeGame` itself.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createHeadless } from "@moku-labs/game/testing";
import type { Registry } from "../../../src/agent";
import { gameFileUrl, MERGE_GAME_DIR } from "../../fixtures/game-dir";
import { loadMergeGame } from "../../fixtures/merge-game";
import { withoutPage } from "./page";
import type { StartedGame } from "./tiny-game";
import { settle } from "./wait";

/** The game repository's helper module (`startOnBoard`, `tap`, `until`), loaded at run time. */
const TIMBER_HELPERS = gameFileUrl("tests/integration/timber-helpers.ts");

/** Milliseconds per frame of `frames(n)`. */
const FRAME_MS = 16;

/** The display name of the merge game in the manifest. */
export const MERGE_NAME = "merge-game 0.0.0";

/** What the merge helpers need of a merge-game app: the registry's game plus the graph run. */
export type MergeApp = Registry.GameLike & {
  readonly flow: { run(): Promise<unknown>; state(): { readonly path: string } };
  readonly log: { clearSinks(): void };
};

/** A started merge game. */
export type MergeGame = StartedGame & {
  readonly app: MergeApp;
  /** Steps `count` frames of 16 ms, settling the event loop after each one. */
  frames(count: number): Promise<void>;
};

/** Which merge game to start. */
export type MergeOptions = {
  /** The game with its screen plugins (inert renderer); with `board`, assets load through DISK_IO. */
  readonly screen?: boolean;
  /** Walk onto `board/awaitIntent` before returning. */
  readonly board?: boolean;
};

/** What the merge helpers use of the game repository's timber helpers. */
type TimberHelpers = {
  readonly player: unknown;
  startOnBoard(start: unknown): Promise<{ readonly app: MergeApp }>;
  tap(game: { readonly app: MergeApp }, key: string): Promise<void>;
  until(game: { readonly app: MergeApp }, done: () => boolean): Promise<void>;
};

/** The screen variant of the fixture: `createScreenGame` with a manifest and an asset io. */
type ScreenFactory = (options: { manifest: unknown; io: typeof DISK_IO }) => { app: MergeApp };

/** The game's asset io over the fixture files: bundles load for real, textures are stand-ins. */
export const DISK_IO = {
  fetch: async (url: string) =>
    new Response(readFileSync(path.join(MERGE_GAME_DIR, url.replace(/^\//u, "")))),
  decode: async () => ({ width: 1, height: 1 }),
  createTexture: () => ({ label: "stand-in" }),
  destroyTexture: () => undefined
};

/**
 * Loads the game repository's timber helpers.
 *
 * @returns The helpers.
 */
async function loadTimberHelpers(): Promise<TimberHelpers> {
  const helpers: TimberHelpers = await import(/* @vite-ignore */ TIMBER_HELPERS);
  return helpers;
}

/**
 * True when the fixture's app (typed as the registry's `GameLike`) has what the helpers use.
 *
 * @param app - The app `createGame()` made.
 * @returns Whether it has a log and `flow.run`.
 */
function isMergeApp(app: Registry.GameLike): app is MergeApp {
  return "log" in app && "run" in app.flow;
}

/**
 * Wraps a started merge app as a `MergeGame`.
 *
 * @param app - The started app.
 * @returns The game.
 */
function mergeGameOf(app: MergeApp): MergeGame {
  app.log.clearSinks();
  return {
    kind: "game",
    app,
    frames: async (count: number) => {
      for (let frame = 0; frame < count; frame += 1) {
        app.time.step(FRAME_MS);
        await settle();
      }
    },
    stop: () => app.stop()
  };
}

/**
 * The headless merge game: `loadMergeGame()`, `createGame()`, `createHeadless(app)`. It rests at
 * `splash`; a test answers `game.answer { intent: "loaded" }` through the agent to reach `home`.
 *
 * @returns The started game.
 */
async function startHeadless(): Promise<MergeGame> {
  const { createGame } = await loadMergeGame();
  const { app } = createGame();
  if (!isMergeApp(app)) throw new Error("the merge game app has no log or no flow.run");
  const game = mergeGameOf(app);
  const headless = await withoutPage(() => createHeadless(app));
  return { ...game, stop: () => headless.stop() };
}

/**
 * The screen game with its assets on disk: `createScreenGame({ manifest, io: DISK_IO })`, started
 * and stepped until its graph rests (render-view-game.test.ts does the same).
 *
 * @returns The started game.
 */
async function startScreen(): Promise<MergeGame> {
  const fixture = await loadMergeGame();
  // The fixture types createScreenGame by its seed only; at run time it takes manifest and io.
  const create = fixture.createScreenGame as unknown as ScreenFactory;
  const manifest: unknown = JSON.parse(
    readFileSync(path.join(MERGE_GAME_DIR, "manifest.json"), "utf8")
  );
  const { app } = create({ manifest, io: DISK_IO });
  const game = mergeGameOf(app);
  await withoutPage(async () => {
    await app.start();
    app.flow.run().catch(() => undefined);
  });
  await game.frames(6);
  return game;
}

/**
 * Starts the merge game (local only):
 * - default: headless (`loadMergeGame`, `createGame`, `createHeadless`), at `splash`;
 * - `board`: the game repository's `startOnBoard(player)`, at `board/awaitIntent`;
 * - `screen`: `createScreenGame({ manifest, io: DISK_IO })`, at its first rest node;
 * - `screen` + `board`: the screen game walked onto `board/awaitIntent` with a tap on Play.
 * The page is hidden while the game starts, so its renderer is inert and frames move only
 * through `frames(n)`.
 *
 * @param options - Screen and board.
 * @returns The started game.
 */
export async function startMergeGame(options: MergeOptions = {}): Promise<MergeGame> {
  if (options.screen !== true && options.board !== true) return startHeadless();
  if (options.screen !== true) {
    const helpers = await loadTimberHelpers();
    const { app } = await withoutPage(() => helpers.startOnBoard(helpers.player));
    return mergeGameOf(app);
  }
  const game = await startScreen();
  if (options.board !== true) return game;
  const helpers = await loadTimberHelpers();
  await helpers.tap(game, "play");
  await helpers.until(game, () => game.app.flow.state().path === "board/awaitIntent");
  await game.frames(6);
  return game;
}

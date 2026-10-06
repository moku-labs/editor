/**
 * @file Where the local merge-game tests find the game checkout. One rule, used by
 * vitest.config.ts, e2e/prepare-game.ts and every test helper that reads game files:
 * `MOKU_GAME_DIR`, an absolute path or a path relative to the repository root. There is no
 * default. Without it the merge-game tests skip: vitest.config.ts leaves out the files that load
 * the fixture, and the few `skipIf` tests check `HAS_GAME`.
 *
 * The checkout must sit on the release of the `@moku-labs/game` dev dependency in package.json,
 * so the fixture runs on the engine it was built with, with its dependencies installed (the bin
 * test bundles the fixture page with Bun):
 *
 * ```sh
 * MOKU_GAME_DIR=<game checkout at that tag> bun run test
 * ```
 *
 * CI sets no `MOKU_GAME_DIR`, so these tests skip there.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The root of this repository. */
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Why the merge-game tests skip, or why a helper that needs the checkout throws. */
export const NO_GAME_REASON =
  "MOKU_GAME_DIR is not set or has no tests/integration/merge-game: the merge-game tests skip";

/** The game checkout directory, absolute, or undefined when `MOKU_GAME_DIR` is not set. */
export const GAME_DIR: string | undefined = process.env.MOKU_GAME_DIR
  ? path.resolve(REPO_ROOT, process.env.MOKU_GAME_DIR)
  : undefined;

/** True when `MOKU_GAME_DIR` names a checkout that holds the merge-game fixture. */
export const HAS_GAME =
  GAME_DIR !== undefined &&
  existsSync(path.join(GAME_DIR, "tests", "integration", "merge-game", "game.ts"));

/**
 * The game checkout directory. Call it only in a test that runs when `HAS_GAME` is true.
 *
 * @returns The absolute path of the checkout.
 * @throws {Error} With `NO_GAME_REASON` when `MOKU_GAME_DIR` is not set.
 * @example
 * ```ts
 * const testing = path.join(gameDir(), "src", "testing.ts");
 * ```
 */
export function gameDir(): string {
  if (GAME_DIR === undefined) throw new Error(NO_GAME_REASON);
  return GAME_DIR;
}

/**
 * The merge-game fixture folder inside the game checkout.
 *
 * @returns The absolute path of `tests/integration/merge-game` in the checkout.
 * @throws {Error} With `NO_GAME_REASON` when `MOKU_GAME_DIR` is not set.
 * @example
 * ```ts
 * const manifest = readFileSync(path.join(mergeGameDir(), "manifest.json"), "utf8");
 * ```
 */
export function mergeGameDir(): string {
  return path.join(gameDir(), "tests", "integration", "merge-game");
}

/**
 * The file URL of a file in the game checkout, for a run-time `import()`.
 *
 * @param relative - A path relative to the game checkout, with `/` separators.
 * @returns The `file://` URL of the file.
 * @throws {Error} With `NO_GAME_REASON` when `MOKU_GAME_DIR` is not set.
 * @example
 * ```ts
 * const helpers = await import(gameFileUrl("tests/integration/timber-helpers.ts"));
 * ```
 */
export function gameFileUrl(relative: string): string {
  return pathToFileURL(path.join(gameDir(), relative)).href;
}

/**
 * @file Where the local merge-game tests find the game repository. One rule, used by
 * vitest.config.ts and every test helper that reads game files:
 *
 * - `MOKU_GAME_DIR` when it is set: an absolute path, or a path relative to the repository root;
 * - otherwise `<repo root>/../game-fixture`.
 *
 * `../game-fixture` is a worktree of the game repository, checked out detached at the tag `v0.7.0`:
 * the release of the `@moku-labs/game` dev dependency in package.json (`0.7.0`). Its
 * `@moku-labs/game` imports resolve to that dev dependency (through the aliases of vitest.config.ts), so the merge
 * game runs on the engine it was built with. The live sibling `../game` may hold work in progress
 * that breaks the fixture, so the tests never read it. Create the worktree once, with its
 * dependencies (the bin test bundles the fixture page with Bun):
 *
 * ```sh
 * git -C ../game fetch --tags && git -C ../game worktree add --detach ../game-fixture v0.7.0
 * bun install --cwd ../game-fixture --frozen-lockfile --ignore-scripts
 * ```
 *
 * When the dev dependency moves to a newer release, move the fixture to its tag and install again:
 * `git -C ../game fetch --tags && git -C ../game-fixture checkout --detach vX.Y.Z`, then the
 * `bun install` line above.
 *
 * CI has no game checkout. There vitest.config.ts skips the test files that load the fixture.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The root of this repository. */
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * The game checkout directory, absolute: `MOKU_GAME_DIR` (resolved from the repository root) or
 * `<repo root>/../game-fixture`.
 */
export const GAME_DIR = path.resolve(REPO_ROOT, process.env.MOKU_GAME_DIR ?? "../game-fixture");

/** The merge-game fixture folder inside the game checkout, absolute. */
export const MERGE_GAME_DIR = path.join(GAME_DIR, "tests", "integration", "merge-game");

/**
 * The file URL of a file in the game checkout, for a run-time `import()`.
 *
 * @param relative - A path relative to the game checkout, with `/` separators.
 * @returns The `file://` URL of the file.
 * @example
 * ```ts
 * const helpers = await import(gameFileUrl("tests/integration/timber-helpers.ts"));
 * ```
 */
export function gameFileUrl(relative: string): string {
  return pathToFileURL(path.join(GAME_DIR, relative)).href;
}

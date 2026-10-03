/**
 * @file The e2e game build step (the `build:e2e` of this repository): copies the merge-game
 * fixture of the pinned game checkout (tests/fixtures/game-dir.ts) into dist-e2e/game/, puts the
 * e2e game page (e2e/game/editor.html and editor.ts: the fixture page plus the editor agent) into
 * its web/ folder and writes the tsconfig the Bun HTML bundler reads for the copied files.
 *
 * The copy is the project root the bin serves, so the editor's writes (notes, layout, styles,
 * captures) land in dist-e2e/, never in the game checkout, and every run starts from the same
 * frozen files. `@moku-labs/game` resolves to the editor's dev dependency (one engine copy for the
 * game and the editor). Only `@moku-labs/game/testing`, which the fixture's game.ts imports for
 * its fake clock, maps to the checkout's source: the built testing bundle carries the
 * playwright-core loader, which a browser bundle cannot hold.
 */
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GAME_DIR, MERGE_GAME_DIR } from "../tests/fixtures/game-dir";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const OUT = path.join(REPO, "dist-e2e", "game");

await rm(OUT, { recursive: true, force: true });
await mkdir(path.dirname(OUT), { recursive: true });
await cp(MERGE_GAME_DIR, OUT, {
  recursive: true,
  filter: source => !source.includes(`${path.sep}__tests__`)
});
for (const file of ["editor.html", "editor.ts"]) {
  await cp(path.join(REPO, "e2e", "game", file), path.join(OUT, "web", file));
}
const tsconfig = {
  extends: "../../tsconfig.json",
  compilerOptions: {
    jsxImportSource: "@moku-labs/game",
    paths: { "@moku-labs/game/testing": [path.join(GAME_DIR, "src", "testing.ts")] }
  }
};
await writeFile(path.join(OUT, "tsconfig.json"), `${JSON.stringify(tsconfig, undefined, 2)}\n`);

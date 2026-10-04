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
 *
 * The fixture page of game v0.1.0 also imports `@moku-labs/system` and `@moku-labs/native`, which
 * the editor does not depend on. They are linked from the checkout's node_modules into the copy's
 * own node_modules, so the bundler finds them and still takes `@moku-labs/game` from the editor.
 *
 * The copy gets its own package.json, as a game project has. Without it the copy inherits the
 * editor's `"sideEffects": false`, and the bin's bundler (Bun without HMR, D-22) drops the page's
 * bare `import "./main"`: the game would never start.
 */
import { cp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
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
/** Packages the fixture page imports that only the game checkout installs. */
const CHECKOUT_PACKAGES = ["@moku-labs/system", "@moku-labs/native"];
await mkdir(path.join(OUT, "node_modules", "@moku-labs"), { recursive: true });
for (const name of CHECKOUT_PACKAGES) {
  await symlink(
    path.join(GAME_DIR, "node_modules", name),
    path.join(OUT, "node_modules", name),
    "dir"
  );
}
const tsconfig = {
  extends: "../../tsconfig.json",
  compilerOptions: {
    jsxImportSource: "@moku-labs/game",
    paths: { "@moku-labs/game/testing": [path.join(GAME_DIR, "src", "testing.ts")] }
  }
};
await writeFile(path.join(OUT, "tsconfig.json"), `${JSON.stringify(tsconfig, undefined, 2)}\n`);
await writeFile(
  path.join(OUT, "package.json"),
  `${JSON.stringify({ name: "merge-game-e2e", private: true, type: "module" }, undefined, 2)}\n`
);

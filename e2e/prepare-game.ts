/**
 * @file The e2e game build step (the `build:e2e` of this repository): copies the merge-game
 * fixture of the game checkout named by MOKU_GAME_DIR (tests/fixtures/game-dir.ts) into
 * dist-e2e/game/, puts the e2e game page (e2e/game/editor.html and editor.ts: the fixture page
 * plus the editor agent) into its web/ folder and writes the tsconfig the Bun HTML bundler reads
 * for the copied files.
 *
 * The copy is the project root the bin serves, so the editor's writes (notes, layout, styles,
 * captures) land in dist-e2e/, never in the game checkout, and every run starts from the same
 * frozen files. `@moku-labs/game` resolves to the editor's dev dependency (one engine copy for the
 * game and the editor). Only `@moku-labs/game/testing`, which the fixture's game.ts imports for
 * its fake clock, maps to the checkout's source: the built testing bundle carries the
 * playwright-core loader, which a browser bundle cannot hold.
 *
 * The checkout sits on the release of the `@moku-labs/game` dev dependency; see
 * tests/fixtures/game-dir.ts.
 *
 * The fixture page also imports `@moku-labs/system` and `@moku-labs/native`, which
 * the editor does not depend on. They are linked from the checkout's node_modules into the copy's
 * own node_modules, so the bundler finds them and still takes `@moku-labs/game` from the editor.
 *
 * The bin opens the project index of the copy (`@moku-labs/game/project`), which needs
 * `typescript`, a dev dependency of every game. The copy sits under the editor, so `typescript`
 * resolves through the editor's node_modules; when it does not, it is linked from the checkout's
 * node_modules, and a copy where neither has it stops here: the index would be off
 * (`files:project-off`) and every view would only say so.
 *
 * The copy gets its own package.json, as a game project has. Without it the copy inherits the
 * editor's `"sideEffects": false`, and the bin's bundler drops the page's bare `import "./main"`:
 * the game would never start.
 *
 * The bin serves the copy with Bun hot reload on (D-23): a spec that writes a game source sees the
 * game page reload and restore its checkpoint, and restores the file it wrote.
 *
 * The copy keeps the fixture's `bunfig.toml`: its `[serve.static]` loads
 * the hot swap plugin `@moku-labs/game/hot`, so a save of a view module swaps in place without a
 * reload (U10). A fixture without one gets that file written here (B3). The bin, started from the
 * editor root with `--root dist-e2e/game`, re-runs itself in the copy, where Bun reads it.
 */
import { access, cp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gameDir, HAS_GAME, mergeGameDir, NO_GAME_REASON } from "../tests/fixtures/game-dir";

if (!HAS_GAME)
  throw new Error(`[moku-editor] e2e needs the merge-game fixture. ${NO_GAME_REASON}.`);

const REPO = fileURLToPath(new URL("..", import.meta.url));
const OUT = path.join(REPO, "dist-e2e", "game");

await rm(OUT, { recursive: true, force: true });
await mkdir(path.dirname(OUT), { recursive: true });
await cp(mergeGameDir(), OUT, {
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
    path.join(gameDir(), "node_modules", name),
    path.join(OUT, "node_modules", name),
    "dir"
  );
}
/**
 * True when a package resolves from the copy, as the bin's index resolves it.
 *
 * @param name - The package name.
 * @returns Whether it resolves.
 */
function resolvesFromCopy(name: string): boolean {
  try {
    Bun.resolveSync(`${name}/package.json`, OUT);
    return true;
  } catch {
    return false;
  }
}
if (!resolvesFromCopy("typescript")) {
  await symlink(
    path.join(gameDir(), "node_modules", "typescript"),
    path.join(OUT, "node_modules", "typescript"),
    "dir"
  );
}
if (!resolvesFromCopy("typescript")) {
  throw new Error(
    "[moku-editor] typescript does not resolve from dist-e2e/game: the project index would be off.\n  Run bun install in the editor or in the game checkout."
  );
}
const tsconfig = {
  extends: "../../tsconfig.json",
  compilerOptions: {
    jsxImportSource: "@moku-labs/game",
    paths: { "@moku-labs/game/testing": [path.join(gameDir(), "src", "testing.ts")] }
  }
};
await writeFile(path.join(OUT, "tsconfig.json"), `${JSON.stringify(tsconfig, undefined, 2)}\n`);
/** The bunfig of the copy: Bun's dev server loads the game's hot swap plugin from it. */
const BUNFIG = path.join(OUT, "bunfig.toml");
const hasBunfig = await access(BUNFIG).then(
  () => true,
  () => false
);
if (!hasBunfig) {
  await writeFile(BUNFIG, '[serve.static]\nplugins = ["@moku-labs/game/hot"]\n');
}
await writeFile(
  path.join(OUT, "package.json"),
  `${JSON.stringify({ name: "merge-game-e2e", private: true, type: "module" }, undefined, 2)}\n`
);

/**
 * @file The e2e game build step: copies the tiny game of e2e/game/ into dist-e2e/game/ and the
 * body font the engine ships (`@moku-labs/game/fonts/*`) into its `features/tiny/assets/`, where
 * its `manifest.json` names it. No game checkout and no environment variable: the game is built
 * from the editor's `@moku-labs/game` dev dependency only.
 *
 * The copy is the project root the bin serves, so the editor's writes (notes, layout, styles,
 * captures) land in dist-e2e/, never in e2e/game/, and every run starts from the same files. It
 * sits two folders under the repository, as e2e/game/ does, so the committed `tsconfig.json`
 * (`extends: "../../tsconfig.json"`, `jsxImportSource: "@moku-labs/game"`) and the page's import
 * of `../../../src/agent` hold in both places. `@moku-labs/game` resolves to the editor's dev
 * dependency: one engine copy for the game and the editor.
 *
 * The copy has its own `package.json`, as a game project has. Without it the copy inherits the
 * editor's `"sideEffects": false`, and the bin's bundler drops the page's bare `import "./main"`:
 * the game would never start.
 *
 * Its `bunfig.toml` loads the hot swap plugin `@moku-labs/game/hot` in `[serve.static]`, so a save
 * of a view module swaps in place and a save of a logic module reloads the page (D-23). The bin,
 * started from the editor root with `--root dist-e2e/game`, re-runs itself in the copy, where Bun
 * reads it.
 *
 * The bin opens the project index of the copy (`@moku-labs/game/project`), which needs
 * `typescript`. The copy sits under the editor, so `typescript` resolves through the editor's
 * node_modules; a copy where it does not stops here, as the index would be off
 * (`files:project-off`) and every view would only say so.
 */
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const SOURCE = path.join(REPO, "e2e", "game");
const OUT = path.join(REPO, "dist-e2e", "game");

/** The font files the engine ships, by their name in `@moku-labs/game/fonts/`. */
const FONT_FILES = ["font-body.fnt", "font-body.png"];

/** Where the game's manifest expects the font. */
const FONT_DIR = path.join(OUT, "features", "tiny", "assets");

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

await rm(OUT, { recursive: true, force: true });
await mkdir(path.dirname(OUT), { recursive: true });
await cp(SOURCE, OUT, { recursive: true });

await mkdir(FONT_DIR, { recursive: true });
for (const file of FONT_FILES) {
  await cp(Bun.resolveSync(`@moku-labs/game/fonts/${file}`, REPO), path.join(FONT_DIR, file));
}

if (!resolvesFromCopy("typescript")) {
  throw new Error(
    "[moku-editor] typescript does not resolve from dist-e2e/game: the project index would be off.\n  Run bun install in the editor."
  );
}

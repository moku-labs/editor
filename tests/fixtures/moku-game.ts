/**
 * @file A moku-game folder for the engine page tests (B5): `index.ts` with `defineGameApp`,
 * `config.ts` with the page title, one scenario under `tests/scenarios/`, and `node_modules`
 * linked to this repository's, so the game resolves the engine the editor is built against. No
 * `web/`, no html, no bunfig: the engine writes the page.
 *
 * The editor build those tests bundle from (`dist/agent-page.mjs`, through the tree's serve
 * plugin) is made once before all test files by tests/global-build.ts.
 */
import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The repository root. */
export const REPO = fileURLToPath(new URL("../../", import.meta.url)).replace(/\/$/, "");

/** The built page agent the engine page imports through the tree plugin. */
export const AGENT_PAGE_BUILD = path.join(REPO, "dist", "agent-page.mjs");

/** The page title of the fixture game (its `config.ts`). */
export const MOKU_GAME_TITLE = "moku game fixture";

/** A string of the fixture game's code: the page bundle carries it. */
export const MOKU_GAME_MARKER = "MOKU_GAME_MARKER";

/** The game: one rest node, its flow and where a new player starts. */
const INDEX = `import { defineGame, type } from "@moku-labs/game";
import { defineGameApp } from "@moku-labs/game/app";

const { defineNode, defineFlow } = defineGame();
const home = defineNode({ outcomes: { play: type() }, rest: true, checkpoint: true });
const mainFlow = defineFlow("main", { nodes: { home }, start: "home", edges: { home: { play: "home" } } });

export default defineGameApp({
  flow: mainFlow,
  safeNode: "home",
  player: { coins: 0, marker: "${MOKU_GAME_MARKER}" },
  session: {}
});
`;

/** The page of the game: its title, every other field a default. */
const CONFIG = `export default { page: { title: "${MOKU_GAME_TITLE}" } };\n`;

/** One prepared save, so the written `main.ts` has a scenario. */
const SCENARIO = `export default (now: number) => ({ player: { coins: now > 0 ? 1 : 0, marker: "ready" } });\n`;

/**
 * Writes the fixture game into a fresh temp folder. The caller removes it with
 * `rm(root, { recursive: true, force: true })`: the recursive rm unlinks the `node_modules`
 * symlink and does not follow it (checked on Bun 1.3.14 and Node), so the repository's
 * `node_modules` stays.
 *
 * @returns The real path of the game folder.
 * @example
 * ```ts
 * const root = await createMokuGame();
 * // bun src/plugins/pages/bin.ts --root <root> --port 0
 * ```
 */
export async function createMokuGame(): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "moku-game-")));
  await mkdir(path.join(root, "tests", "scenarios"), { recursive: true });
  await writeFile(path.join(root, "index.ts"), INDEX);
  await writeFile(path.join(root, "config.ts"), CONFIG);
  await writeFile(path.join(root, "tests", "scenarios", "ready.ts"), SCENARIO);
  await symlink(path.join(REPO, "node_modules"), path.join(root, "node_modules"), "dir");
  return root;
}

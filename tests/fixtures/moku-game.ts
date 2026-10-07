/**
 * @file A moku-game folder for the engine page tests (B5): `index.ts` with `defineGameApp`,
 * `config.ts` with the page title, one scenario under `tests/scenarios/`, and `node_modules`
 * linked to this repository's, so the game resolves the engine the editor is built against. No
 * `web/`, no html, no bunfig: the engine writes the page.
 *
 * Also the editor build those tests bundle from (`dist/agent-page.mjs`, through the tree's serve
 * plugin): tsdown runs once across test files when it is missing, under a lock folder, without
 * cleaning `dist/` (the tools page and the other entries stay for the tests that read them).
 */
import { existsSync, statSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
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

/** The lock folder of the build: one test file builds, the others wait for it. */
const BUILD_LOCK = path.join(REPO, "node_modules", ".moku-editor-build.lock");

/** How long a build may take, and how old a lock may get before it counts as left behind. */
const BUILD_TIMEOUT_MS = 60_000;

/**
 * Writes the fixture game into a fresh temp folder. The caller removes it.
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

/**
 * Takes the build lock. A lock older than the build timeout was left by a run that died: it is
 * removed and taken.
 *
 * @returns True when this process builds; false when another one does.
 */
async function takeBuildLock(): Promise<boolean> {
  try {
    await mkdir(BUILD_LOCK);
    return true;
  } catch {
    // Taken by another build, or released by it a moment ago: wait for it.
    const lock = statSync(BUILD_LOCK, { throwIfNoEntry: false });
    if (lock === undefined || Date.now() - lock.mtimeMs <= BUILD_TIMEOUT_MS) return false;

    await rm(BUILD_LOCK, { recursive: true, force: true });
    return takeBuildLock();
  }
}

/**
 * Waits until the other build released its lock, at most the build timeout.
 */
async function waitForBuild(): Promise<void> {
  const deadline = Date.now() + BUILD_TIMEOUT_MS;
  while (existsSync(BUILD_LOCK) && Date.now() < deadline) await Bun.sleep(200);
}

/**
 * Builds the editor's entries with tsdown when `dist/agent-page.mjs` is missing, once across the
 * test files that need it. `dist/` is not cleaned.
 *
 * @throws {Error} When tsdown exits with another code than 0.
 * @example
 * ```ts
 * beforeAll(buildEditorOnce, 120_000); // then dist/agent-page.mjs exists
 * ```
 */
export async function buildEditorOnce(): Promise<void> {
  if (existsSync(AGENT_PAGE_BUILD)) return;
  if (!(await takeBuildLock())) {
    await waitForBuild();
    return;
  }

  try {
    const build = Bun.spawn(["bun", "x", "tsdown", "--no-clean"], {
      cwd: REPO,
      stdout: "ignore",
      stderr: "pipe"
    });
    const [code, errors] = await Promise.all([build.exited, new Response(build.stderr).text()]);
    if (code !== 0) throw new Error(`tsdown exited with ${code}: ${errors}`);
  } finally {
    await rm(BUILD_LOCK, { recursive: true, force: true });
  }
}

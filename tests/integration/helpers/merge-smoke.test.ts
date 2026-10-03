import { afterEach, describe, expect, it, vi } from "vitest";
import { MERGE_NAME, type MergeGame, startMergeGame } from "./merge";
import {
  bootTools,
  createProject,
  installPage,
  type Stoppable,
  shutdown,
  startAgent,
  startServer,
  until
} from "./stack";

// ─────────────────────────────────────────────────────────────────────────────
// Local only: the merge-game helper (merge.ts, which calls loadMergeGame) needs
// the sibling repository ../game. vitest.config.ts skips this file on CI because
// its text names loadMergeGame.
// ─────────────────────────────────────────────────────────────────────────────

const running: (Stoppable | undefined)[] = [];

afterEach(async () => {
  await shutdown(...running.splice(0));
});

describe("merge-game helper (local only)", () => {
  it("serves the headless merge game through the stack and answers it from the tools", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const root = await createProject("merge");
    const server = await startServer(root);
    running.push(server);
    installPage(server.origin);
    const game: MergeGame = await startMergeGame();
    running.push(game);
    const agent = await startAgent(server, game, { modules: [], name: MERGE_NAME });
    running.push(agent);
    const tools = await bootTools(server);
    running.push(tools);
    const { link } = tools.app;

    await until(() => link.status().kind === "live" && link.manifest() !== undefined, "live");
    const manifest = link.manifest();
    expect(manifest?.game).toBe(MERGE_NAME);
    expect(manifest?.sources.filter(source => source.id.startsWith("game."))).toHaveLength(14);
    expect(game.app.flow.state().path).toBe("splash");
    await link.run("game.answer", { intent: "loaded" });
    await until(() => game.app.flow.state().path === "home", "home after loaded");
    expect(await link.files.list("")).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "manifest.json" })])
    );
  }, 30_000);

  it("starts the board game and the screen game with assets on board/awaitIntent", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const board = await startMergeGame({ board: true });
    running.push(board);
    expect(board.app.flow.state().path).toBe("board/awaitIntent");
    const screen = await startMergeGame({ screen: true, board: true });
    running.push(screen);
    expect(screen.app.flow.state().path).toBe("board/awaitIntent");
  }, 30_000);
});

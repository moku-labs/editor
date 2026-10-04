import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gameFileUrl } from "../../../../../tests/fixtures/game-dir";
import { agentCoreConfig, createAgentCore } from "../../../../config";
import { channelPlugin } from "../../../channel";
import { refId, type SceneNode } from "../../../panels/shared/scene";
import { registryPlugin } from "../../../registry";
import type { GameLike } from "../../../registry/types";
import { pickAt } from "../../element/select";
import { readScene } from "../../scene/read";
import { startSceneWatches, stopSceneWatches } from "../../scene/watch";
import { createCtx, type TestCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// gameView's scene over the real merge game: the game repository's own helper
// walks createScreenGame (inert renderer) onto board/awaitIntent; the agent
// core (registry + channel) serves its sources in process; gameView reads and
// watches them through a link whose read and watch are the agent channel's.
// Runs only where the pinned game checkout exists (tests/fixtures/game-dir.ts;
// vitest.config.ts skips files that call loadMergeGame… when it is absent, as on CI).
// ─────────────────────────────────────────────────────────────────────────────

/** The game repository's helper module (timber-helpers.ts), loaded at run time like the fixture. */
const HELPERS = gameFileUrl("tests/integration/timber-helpers.ts");

/** What the test uses of the helper module. */
type BoardHelpers = {
  readonly player: unknown;
  startOnBoard(start: unknown): Promise<{ readonly app: GameLike & { stop(): Promise<void> } }>;
};

/**
 * Loads the merge-game board helpers of the game repository.
 *
 * @returns The helpers.
 */
async function loadMergeGameBoard(): Promise<BoardHelpers> {
  const helpers: BoardHelpers = await import(/* @vite-ignore */ HELPERS);
  return helpers;
}

/**
 * Polls until a check holds: the scene builds on the next animation frame, whose timing the test
 * does not own.
 *
 * @param check - The condition to wait for.
 * @param label - What is awaited, for the timeout message.
 * @returns Resolves once the check holds.
 */
async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = performance.now() + 3000;
  while (!check()) {
    if (performance.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

const framework = createAgentCore(agentCoreConfig, { plugins: [registryPlugin, channelPlugin] });

let ctx: TestCtx;
let stopAll: () => Promise<void>;
beforeEach(async () => {
  const { player, startOnBoard } = await loadMergeGameBoard();
  const game = await startOnBoard(player);
  const agent = framework.createApp({
    pluginConfigs: { registry: { game: game.app, modules: [] } }
  });
  agent.log.clearSinks();
  await agent.start();

  ctx = createCtx();
  ctx.link.read.mockImplementation((id, input) => agent.channel.read(id, input));
  ctx.link.watch.mockImplementation((id, input, onValue) =>
    agent.channel.watch(id, input, onValue)
  );
  stopAll = async () => {
    await agent.stop();
    await game.app.stop();
  };
}, 30_000);

afterEach(async () => {
  stopSceneWatches(ctx);
  await stopAll();
});

/**
 * The board items of a scene.
 *
 * @param nodes - The scene nodes.
 * @returns The placed board items.
 */
function boardItems(nodes: Iterable<SceneNode>): SceneNode[] {
  return [...nodes].filter(node => node.entity?.owner === "board.items" && node.rect !== undefined);
}

describe("gameView on merge-game", () => {
  it("scene() lists boardSlot and the board items with rects, calibrated from game.rect", async () => {
    const scene = await readScene(ctx);

    expect(scene.calibrated).toBe(true);
    expect(ctx.state.calibration).toEqual({ scale: 1, x: 0, y: 0 });
    expect(scene.nodes.get("ui:boardScreen/boardSlot")?.rect).toEqual({
      x: 55,
      y: 801,
      w: 970,
      h: 970
    });
    const items = boardItems(scene.nodes.values());
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item.parent).toBe("ui:boardScreen/boardSlot");
  });

  it("the watches deliver the three sources and the next frame builds the scene", async () => {
    startSceneWatches(ctx);
    expect(ctx.link.watch.mock.calls.map(call => call[0])).toEqual([
      "game.ui",
      "game.entities",
      "game.projections"
    ]);
    expect(Object.keys(ctx.state.sources).toSorted()).toEqual(["entities", "projections", "ui"]);
    await until(() => ctx.state.scene !== undefined, "the scene");
    expect(ctx.state.scene?.nodes.has("ui:boardScreen/hudRow/coinPill")).toBe(true);
    expect(ctx.state.scene?.calibrated).toBe(true);
  });

  it("a picker click at a board item selects it", async () => {
    const scene = await readScene(ctx);
    const [item] = boardItems(scene.nodes.values());
    if (item?.rect === undefined) throw new Error("no board item");
    ctx.workspace.box = { left: 0, top: 0, width: 1080, height: 1440, scale: 1, docked: "stage" };
    ctx.state.picker.on = true;

    await pickAt(ctx, { x: item.rect.x + item.rect.w / 2, y: item.rect.y + item.rect.h / 2 });

    expect(ctx.state.selected).toEqual(item.ref);
    expect(refId(item.ref)).toBe(item.id);
  });
});

import { commands, run } from "@moku-labs/game/control";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  startTinyScreenGame,
  type TinyScreenGame
} from "../../../../../tests/fixtures/tiny-screen-game";
import { agentCoreConfig, createAgentCore } from "../../../../config";
import { channelPlugin } from "../../../channel";
import { refId, type SceneNode } from "../../../panels/shared/scene";
import { registryPlugin } from "../../../registry";
import { pickAt } from "../../element/select";
import { readScene } from "../../scene/read";
import { startSceneWatches, stopSceneWatches } from "../../scene/watch";
import { createCtx, type TestCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// gameView's scene over a real game: the tiny screen game (inert renderer)
// walked onto board/awaitIntent by a tap on Play; the agent core (registry +
// channel) serves its sources in process; gameView reads and watches them
// through a link whose read and watch are the agent channel's.
// ─────────────────────────────────────────────────────────────────────────────

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
let game: TinyScreenGame;
let stopAll: () => Promise<void>;
beforeEach(async () => {
  vi.stubGlobal("__MOKU_GAME_DEV__", true);
  game = await startTinyScreenGame();
  const tapped = run(game.app, commands.tap, { key: "play" });
  await game.until("board/awaitIntent");
  await game.frames(6);
  await tapped;
  const agent = framework.createApp({
    pluginConfigs: { registry: { game: game.app, modules: [] } }
  });
  agent.log.clearSinks();
  await agent.start();

  ctx = createCtx();
  // The agent's own manifest: it lists the rect source game.locate.
  ctx.link.manifestValue = agent.registry.manifest();
  ctx.link.read.mockImplementation((id, input) => agent.channel.read(id, input));
  ctx.link.watch.mockImplementation((id, input, onValue) =>
    agent.channel.watch(id, input, onValue)
  );
  stopAll = async () => {
    await agent.stop();
    await game.stop();
  };
}, 30_000);

afterEach(async () => {
  stopSceneWatches(ctx);
  await stopAll();
  vi.unstubAllGlobals();
});

/**
 * The items of a scene.
 *
 * @param nodes - The scene nodes.
 * @returns The placed items.
 */
function trayItems(nodes: Iterable<SceneNode>): SceneNode[] {
  return [...nodes].filter(node => node.entity?.owner === "tiny.items" && node.rect !== undefined);
}

describe("gameView on the tiny screen game", () => {
  it("scene() lists the tray and the items with rects, calibrated from the rect source", async () => {
    const scene = await readScene(ctx);

    expect(scene.calibrated).toBe(true);
    expect(ctx.state.calibration).toEqual({ scale: 1, x: 0, y: 0 });
    expect(scene.nodes.get("ui:boardScreen/tray")?.rect).toEqual({
      x: 240,
      y: 140,
      w: 600,
      h: 600
    });
    const items = trayItems(scene.nodes.values());
    expect(items.map(item => item.name)).toEqual(["a", "b"]);
    for (const item of items) expect(item.parent).toBe("ui:boardScreen/tray");
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

  it("a picker click at an item selects it", async () => {
    const scene = await readScene(ctx);
    const [item] = trayItems(scene.nodes.values());
    if (item?.rect === undefined) throw new Error("no item");
    ctx.workspace.box = { left: 0, top: 0, width: 1080, height: 1440, scale: 1, docked: "stage" };
    ctx.state.picker.on = true;

    await pickAt(ctx, { x: item.rect.x + item.rect.w / 2, y: item.rect.y + item.rect.h / 2 });

    expect(ctx.state.selected).toEqual(item.ref);
    expect(refId(item.ref)).toBe(item.id);
  });
});

// @vitest-environment happy-dom
import { createApp as createGame, defineGame, screen, type } from "@moku-labs/game";
import { fakeClock, memory } from "@moku-labs/game/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agentCoreConfig, createAgentCore } from "../../../../config";
import { registryPlugin } from "../../../registry";
import type { GameLike } from "../../../registry/types";
import { perfPlugin } from "../..";
import { CAUSE_BITS, causesOf } from "../../protocol";

// ─────────────────────────────────────────────────────────────────────────────
// perf against the REAL engine (spec 03 § Against the shipped engine, item 3):
// a real createApp game with the agent flag on, its renderer on a stand-in Pixi
// (the engine ships no mock renderer), frames from a scripted rAF. perf reads
// the engine's ring: the window fills, a 25.1 ms gap is a gap spike, every row's
// budget is the ring's, slot = k % capacity, and the bit order is the engine's.
// ─────────────────────────────────────────────────────────────────────────────

/** The game's player and session. */
type Tree = Record<string, never>;

/** A Pixi application with what the engine's host, render and sample call: init, a webgl renderer with no textures, a canvas. */
class StandInApplication {
  renderer = {
    name: "webgl",
    texture: { managedTextures: [] },
    render: (): void => undefined,
    resize: (): void => undefined
  };
  canvas = document.createElement("canvas");
  async init(): Promise<void> {
    await Promise.resolve();
  }
  destroy(): void {
    this.canvas.remove();
  }
}

/**
 * A real game app with the screen plugins, mounted on a div, Pixi stood in.
 *
 * @returns The game app (not started).
 */
function createRealGame() {
  const { defineNode, defineFlow } = defineGame<{
    player: Tree;
    session: Tree;
    assets: string;
    strings: Record<string, unknown>;
  }>();
  const home = defineNode({ outcomes: { play: type() }, rest: true, checkpoint: true });
  const mainFlow = defineFlow("main", {
    nodes: { home },
    start: "home",
    edges: { home: { play: "home" } }
  });
  const mount = document.createElement("div");
  document.body.append(mount);
  const app = createGame({
    plugins: [...screen],
    pluginConfigs: {
      model: { playerProvider: memory(), initialPlayer: {}, initialSession: {}, seed: 1 },
      clock: { source: fakeClock(1000) },
      flow: { mainFlow, safeNode: "home" },
      renderer: { mount, loadPixi: async () => ({ Application: StandInApplication }) as never }
    }
  });
  app.log.clearSinks();
  return app;
}

const { createApp } = createAgentCore(agentCoreConfig, { plugins: [registryPlugin, perfPlugin] });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("perf on the real engine", () => {
  it("reads the engine's ring: the window fills, a 25.1 ms gap is a gap spike, each row's budget is the ring's", async () => {
    vi.useFakeTimers({
      toFake: ["performance", "setInterval", "clearInterval", "setTimeout", "clearTimeout"]
    });
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    let frame: ((at: number) => void) | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: (at: number) => void) => {
      frame = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {
      frame = undefined;
    });

    const game = createRealGame();
    await game.start();
    const editor = createApp({
      pluginConfigs: { registry: { game: game as unknown as GameLike } }
    });
    editor.log.clearSinks();
    await editor.start();
    const monitor = editor.perf.monitor();
    expect(monitor).toBe(game.renderer.monitor);

    let now = performance.now();
    const step = (gapMs: number): void => {
      vi.advanceTimersByTime(gapMs);
      now += gapMs;
      frame?.(now);
    };
    frame?.(now);
    for (let index = 0; index < 20; index += 1) step(16.7);
    step(25.1);
    for (let index = 0; index < 80; index += 1) step(16.7);
    vi.advanceTimersByTime(250);

    const ring = game.renderer.monitor.frames();
    // The stand-in renderer is WebGL without a GPU timer: the header's gpu.timer is null.
    expect(editor.perf.status()).toEqual({ state: "on", lost: 0, gpuTimer: false });
    const [spike] = editor.perf.spikes();
    expect(spike).toMatchObject({ cause: "gap", causes: ["gap"], ms: 25.1 });

    editor.perf.readWindow(window => {
      expect(window.count).toBe(ring.written);
      for (let row = 0; row < window.count; row += 1) {
        const slot = row % ring.capacity;
        expect(ring.columns.frame[slot]).toBe(window.frame[row]);
        expect(window.budgetMs[row]).toBe(ring.columns.budgetMs[slot]);
      }
    });
    const spikeSlot =
      (ring.written - 1 - (ring.columns.frame[ring.newest] ?? 0) + (spike?.frame ?? 0)) %
      ring.capacity;
    expect(ring.columns.causes[spikeSlot]).toBe(1 << CAUSE_BITS.indexOf("gap"));
    expect(editor.perf.second().budgetMs).toBe(16.67);

    const detail = editor.perf.spike(spike?.frame ?? 0)?.detail;
    expect(detail?.frame.causes).toEqual(causesOf(ring.columns.causes[spikeSlot] ?? 0));
    expect(detail?.frame.budgetMs).toBe(16.67);

    await editor.stop();
    await game.stop();
  });
});

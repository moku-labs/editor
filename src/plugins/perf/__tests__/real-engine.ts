import { createApp as createGame, defineGame, screen, type } from "@moku-labs/game";
import { fakeClock, memory } from "@moku-labs/game/testing";
import { expect, vi } from "vitest";
import { agentCoreConfig, createAgentCore } from "../../../config";
import { registryPlugin } from "../../registry";
import type { GameLike } from "../../registry/types";
import { perfPlugin } from "..";

// ─────────────────────────────────────────────────────────────────────────────
// The real-engine harness of perf's integration tests (needs a DOM: the files
// using it run under happy-dom): a real createApp game with the screen plugins
// and the agent flag on, its renderer on a stand-in Pixi (the engine ships no
// mock renderer), frames from a scripted rAF on fake time.
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

/** What a test can change of the real game: render on demand, the idle cap, the rate and the adaptive rule. */
export type RealGameOptions = {
  readonly onDemand?: boolean;
  readonly idleFps?: 0 | 30;
  readonly idleAfterMs?: number;
  readonly maxFps?: 30 | 60 | 120;
  readonly adaptive?: boolean;
};

/**
 * A real game app with the screen plugins, mounted on a div, Pixi stood in.
 *
 * @param options - Render on demand and the idle cap.
 * @returns The game app (not started).
 */
function createRealGame(options: RealGameOptions) {
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
      time: {
        idleFps: options.idleFps ?? 30,
        idleAfterMs: options.idleAfterMs ?? 2000,
        maxFps: options.maxFps ?? 60,
        ...(options.adaptive === true ? { adaptive: { floor: 60 } } : {})
      },
      renderer: {
        mount,
        onDemand: options.onDemand ?? false,
        loadPixi: async () => ({ Application: StandInApplication }) as never
      }
    }
  });
  app.log.clearSinks();
  return app;
}

const { createApp } = createAgentCore(agentCoreConfig, { plugins: [registryPlugin, perfPlugin] });

/**
 * Starts a real game with the agent flag on and frames from a scripted rAF, then the agent app with
 * registry and perf on it. Time is fake (`performance` included): `step(gapMs)` moves the clock and
 * runs one frame of the loop at that gap. The caller restores globals and timers (`vi.unstubAllGlobals`,
 * `vi.useRealTimers`).
 *
 * @param options - Render on demand and the idle cap of the game.
 * @returns The game, the editor and the frame stepper.
 */
export async function startPair(options: RealGameOptions = {}) {
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

  const game = createRealGame(options);
  await game.start();
  const editor = createApp({
    pluginConfigs: { registry: { game: game as unknown as GameLike } }
  });
  editor.log.clearSinks();
  await editor.start();
  expect(editor.perf.monitor()).toBe(game.renderer.monitor);

  // The frame's rAF timestamp is the page clock now, so a frame's work reads 0 ms and its gap is the
  // time moved since the last frame (a perf tick's advance included).
  const step = (gapMs: number): void => {
    vi.advanceTimersByTime(gapMs);
    frame?.(performance.now());
  };
  frame?.(performance.now());
  return { game, editor, step };
}

/** The game's frame API the stall hook needs. */
type FrameHost = { readonly time: { onFrame(phase: "animate", callback: () => void): () => void } };

/**
 * A hook that makes the next frame of the game work `ms` of page clock (in its `animate` phase):
 * real work the engine measures in `workMs`.
 *
 * @param game - The game app.
 * @returns `arm(ms)`: the next frame works that long.
 */
export function stallOnce(game: FrameHost) {
  let pending = 0;
  game.time.onFrame("animate", () => {
    if (pending === 0) return;
    const ms = pending;
    pending = 0;
    vi.advanceTimersByTime(ms);
  });
  return {
    arm: (ms: number): void => {
      pending = ms;
    }
  };
}

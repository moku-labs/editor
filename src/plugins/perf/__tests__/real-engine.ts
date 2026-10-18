import { createApp as createGame, defineGame, screen, type } from "@moku-labs/game";
import { fakeClock, memory } from "@moku-labs/game/testing";
import { expect, vi } from "vitest";
import { agentCoreConfig, createAgentCore } from "../../../config";
import { registryPlugin } from "../../registry";
import type { GameLike } from "../../registry/types";
import { perfPlugin } from "..";
import { countedGpuPixi, STAND_IN_FILTER } from "./counted-gpu";

// ─────────────────────────────────────────────────────────────────────────────
// The real-engine harness of perf's integration tests (needs a DOM: the files
// using it run under happy-dom): a real createApp game with the screen plugins
// and the agent flag on, its renderer on a stand-in Pixi (the engine ships no
// mock renderer): an uncounted WebGL one by default, or a counted WebGPU one
// (./counted-gpu.ts) that draws passes, a filter and a compile; frames from a
// scripted rAF on fake time.
// ─────────────────────────────────────────────────────────────────────────────

/** The game's player and session. */
type Tree = Record<string, never>;

/** A Pixi runner or signal the engine adds a listener to and removes it from; it never fires. */
const silentRunner = { add: (): void => undefined, remove: (): void => undefined };

/**
 * A Pixi application with what the engine's host, render and sample call: init, a webgl renderer
 * with no textures, a canvas; and the runners a build without the agent flag counts passes on.
 */
class StandInApplication {
  renderer = {
    name: "webgl",
    texture: { managedTextures: [] },
    runners: { prerender: silentRunner, renderStart: silentRunner },
    renderTarget: { renderTarget: undefined, onRenderTargetChange: silentRunner },
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
 * What a test can change of the real game: render on demand, the idle cap, the rate, the adaptive
 * rule, the agent flag (on by default; off is a page `moku-game dev` did not write, whose
 * monitor's ring has capacity 0), the backend (`"webgl"`: the uncounted stand-in, by default;
 * `"webgpu"`: the counted one), the kind of the counted backend's filter (`filterKind`: an entity
 * hangs it before the first frame, so its passes and compile name that entity and kind; absent,
 * no entity hangs it) and the app id the build wrote (`__MOKU_GAME_APP__`).
 */
export type RealGameOptions = {
  readonly agent?: boolean;
  readonly backend?: "webgl" | "webgpu";
  readonly filterKind?: string;
  readonly appId?: string;
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
        ...(options.backend === "webgpu"
          ? { preference: "webgpu" as const, loadPixi: async () => countedGpuPixi() as never }
          : { loadPixi: async () => ({ Application: StandInApplication }) as never })
      }
    }
  });
  app.log.clearSinks();
  return app;
}

const { createApp } = createAgentCore(agentCoreConfig, { plugins: [registryPlugin, perfPlugin] });

/**
 * Hangs the counted backend's filter on a new entity with a kind, the way `effects` names a
 * filter: the engine then writes that entity as the owner of its passes and compiles.
 *
 * @param game - The game app.
 * @param kind - The filter kind id.
 * @returns The entity.
 */
function hangFilter(game: ReturnType<typeof createRealGame>, kind: string): number {
  const entity = game.world.ecs.spawn({ kind: "plugin", name: "perf.test" }, []);
  // boundary: the stand-in filter is not a Pixi Filter; the engine only keys its maps by it
  game.renderer.sync.filters.set(entity, [{ filter: STAND_IN_FILTER as never, passes: 1, kind }]);
  return entity;
}

/**
 * Starts a real game with the agent flag on (unless `agent: false`) and frames from a scripted
 * rAF, then the agent app with registry and perf on it. Time is fake (`performance` included): `step(gapMs)` moves the clock and
 * runs one frame of the loop at that gap. The caller restores globals and timers (`vi.unstubAllGlobals`,
 * `vi.useRealTimers`).
 *
 * @param options - Render on demand, the idle cap, the agent flag, the backend, the filter kind and
 *   the app id.
 * @returns The game, the editor, the frame stepper and the entity hanging the filter (with
 *   `filterKind`).
 */
export async function startPair(options: RealGameOptions = {}) {
  vi.useFakeTimers({
    toFake: ["performance", "setInterval", "clearInterval", "setTimeout", "clearTimeout"]
  });
  vi.stubGlobal("__MOKU_GAME_AGENT__", options.agent ?? true);
  if (options.appId !== undefined) vi.stubGlobal("__MOKU_GAME_APP__", options.appId);
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
  const filterOwner =
    options.filterKind === undefined ? undefined : hangFilter(game, options.filterKind);
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
  return { game, editor, step, filterOwner };
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

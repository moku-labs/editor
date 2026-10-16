// @vitest-environment happy-dom
import { createApp as createGame, defineGame, screen, type } from "@moku-labs/game";
import { fakeClock, memory } from "@moku-labs/game/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agentCoreConfig, createAgentCore } from "../../../../config";
import { channelPlugin } from "../../../channel";
import { perfPlugin } from "../../../perf";
import type { PerfLogLine } from "../../../perf/protocol";
import { registryPlugin } from "../../../registry";
import type { GameLike } from "../../../registry/types";
import { recorderPlugin } from "../..";

// ─────────────────────────────────────────────────────────────────────────────
// The recorder against the REAL engine (spec 05 § When the engine ships): a
// real createApp game with the agent flag on, its renderer on a stand-in Pixi,
// frames from a scripted rAF. The engine's monitor stream feeds the recorder:
// the log starts with the engine's header, a recorder mark arrives as a `mark`
// line, `command` and `recorder` events arrive as `event` lines.
// ─────────────────────────────────────────────────────────────────────────────

/** The game's player and session. */
type Tree = Record<string, never>;

/** A Pixi application with what the engine's host, render and sample call. */
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

const { createApp } = createAgentCore(agentCoreConfig, {
  plugins: [registryPlugin, channelPlugin, perfPlugin, recorderPlugin]
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the recorder on the real engine", () => {
  it("logs the engine's stream: the header first, samples, a mark, command and recorder events", async () => {
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
      pluginConfigs: {
        registry: { game: game as unknown as GameLike },
        recorder: { storage: "memory", autoStart: "device" }
      }
    });
    editor.log.clearSinks();
    await editor.start();
    expect(editor.recorder.status()).toMatchObject({ state: "recording", monitor: true });

    let now = performance.now();
    frame?.(now);
    for (let index = 0; index < 150; index += 1) {
      vi.advanceTimersByTime(16.7);
      now += 16.7;
      frame?.(now);
    }
    expect(editor.recorder.mark("boss enters")).toBe(true);
    await editor.channel.run("editor.mark", { label: "door" }, "bridge");
    await editor.recorder.stop();

    const lines = (editor.recorder.unsentRun(100_000)?.lines ?? []).map(
      text => JSON.parse(text) as PerfLogLine
    );
    expect(lines[0]).toMatchObject({ v: 1, kind: "header", measured: expect.any(Array) });
    expect(lines.some(line => line.kind === "sample")).toBe(true);
    expect(lines).toContainEqual(
      expect.objectContaining({ kind: "mark", label: "boss enters", auto: false })
    );
    expect(lines).toContainEqual(
      expect.objectContaining({
        kind: "event",
        name: "command",
        detail: { id: "editor.mark", input: { label: "door" }, via: "bridge", ok: true }
      })
    );
    const recorderEvents = lines.filter(line => line.kind === "event" && line.name === "recorder");
    expect(recorderEvents.map(line => (line.kind === "event" ? line.detail.action : ""))).toEqual([
      "start",
      "stop"
    ]);

    await editor.stop();
    await game.stop();
  });
});

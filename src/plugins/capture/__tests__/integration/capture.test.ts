import { createHeadless } from "@moku-labs/game/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadMergeGame } from "../../../../../tests/fixtures/merge-game";
import { agentCoreConfig, createAgentCore } from "../../../../config";
import { channelPlugin } from "../../../channel";
import { registryPlugin } from "../../../registry";
import type { Json } from "../../../registry/protocol";
import type { GameLike } from "../../../registry/types";
import { capturePlugin } from "../..";

// ─────────────────────────────────────────────────────────────────────────────
// The agent core (registry + channel) with capture added the way a game's dev
// entry adds it, over the headless merge game. The headless app has no
// renderer, so a Proxy hands the game.capture door a stub renderer. The game
// page viewport is stubbed on globalThis (393 x 852, a phone in portrait).
// ─────────────────────────────────────────────────────────────────────────────

const framework = createAgentCore(agentCoreConfig, { plugins: [registryPlugin, channelPlugin] });

/** A PNG data URL as the renderer answers it. */
const PNG = "data:image/png;base64,AAAA";

/** The stub renderer the door command calls. */
type StubRenderer = { capture: ReturnType<typeof vi.fn<() => Promise<string | undefined>>> };

let renderer: StubRenderer;
let game: GameLike;
let stopGame: () => Promise<void>;

/**
 * Creates the editor app with capture and starts it.
 *
 * @returns The started editor app.
 */
async function startEditor() {
  const app = framework.createApp({
    plugins: [capturePlugin],
    pluginConfigs: { registry: { game, modules: [] } }
  });
  await app.start();
  return app;
}

/**
 * One field of a wire object, or undefined when the value is no object.
 *
 * @param value - A wire value.
 * @param key - The field.
 * @returns The field's value.
 */
function fieldOf(value: Json, key: string): Json | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value[key]
    : undefined;
}

beforeEach(async () => {
  vi.stubGlobal("__MOKU_GAME_DEV__", true);
  vi.stubGlobal("innerWidth", 393);
  vi.stubGlobal("innerHeight", 852);
  const { createGame } = await loadMergeGame();
  const { app } = createGame();
  const headless = await createHeadless(app);
  renderer = { capture: vi.fn(async (): Promise<string | undefined> => PNG) };
  game = new Proxy(app, {
    get: (target, key) => (key === "renderer" ? renderer : Reflect.get(target, key))
  });
  stopGame = () => headless.stop();
  vi.useFakeTimers();
});

afterEach(async () => {
  vi.useRealTimers();
  await stopGame();
  vi.unstubAllGlobals();
});

describe("capture integration", () => {
  it("adds the three read commands to the manifest", async () => {
    const app = await startEditor();

    const commands = app.registry
      .manifest()
      .commands.filter(command => command.id.startsWith("editor."));
    expect(commands.map(command => [command.id, command.effect])).toEqual([
      ["editor.capture", "read"],
      ["editor.series", "read"],
      ["editor.seriesStop", "read"]
    ]);

    await app.stop();
  });

  it("createApp → start → editor.capture → stop", async () => {
    const app = await startEditor();

    const ran = await app.channel.run("editor.capture");

    expect(ran.value).toEqual({
      image: PNG,
      frame: ran.state.frame,
      device: { w: 393, h: 852, orientation: "portrait" }
    });
    expect(ran.state.frame).toBe(app.registry.envelope().frame);
    expect(renderer.capture).toHaveBeenCalledTimes(1);

    await app.stop();
  });

  it("records a short series in one call", async () => {
    const app = await startEditor();

    const series = app.channel.run("editor.series", { durationMs: 100, intervalMs: 20 });
    await vi.advanceTimersByTimeAsync(100);
    const ran = await series;

    const shots = fieldOf(ran.value, "shots");
    const list = Array.isArray(shots) ? shots : [];
    expect(list.length).toBeGreaterThan(0);
    expect(list.length).toBeLessThanOrEqual(5);
    const times = list.map(shot => fieldOf(shot, "atMs"));
    expect(times.every(time => typeof time === "number")).toBe(true);
    expect(times).toEqual(times.toSorted((a, b) => Number(a) - Number(b)));
    expect(new Set(times).size).toBe(times.length);
    for (const shot of list) expect(typeof fieldOf(shot, "frame")).toBe("number");
    expect(fieldOf(ran.value, "device")).toEqual({ w: 393, h: 852, orientation: "portrait" });

    await app.stop();
  });

  it("refuses a series over the limits naming the field", async () => {
    const app = await startEditor();

    await expect(
      app.channel.run("editor.series", { durationMs: 20_001, intervalMs: 100 })
    ).rejects.toMatchObject({ code: -32_602, data: { field: "durationMs" } });
    await expect(
      app.channel.run("editor.series", { durationMs: 1000, intervalMs: 10 })
    ).rejects.toMatchObject({ code: -32_602, data: { field: "intervalMs" } });

    await app.stop();
  });

  it("never captures on its own", async () => {
    const app = await startEditor();

    await vi.advanceTimersByTimeAsync(60_000);

    expect(renderer.capture).not.toHaveBeenCalled();
    await app.stop();
  });

  it("stop() during a series resolves it with the shots so far and leaves no timer", async () => {
    const app = await startEditor();

    const series = app.channel.run("editor.series", { durationMs: 1000, intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(250);
    await app.stop();
    const ran = await series;

    expect(ran.value).toMatchObject({ shots: [{ atMs: 0 }, { atMs: 100 }, { atMs: 200 }] });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects -32000 when the renderer answers no picture", async () => {
    renderer.capture.mockResolvedValue(undefined);
    const app = await startEditor();

    await expect(app.channel.run("editor.capture")).rejects.toMatchObject({
      code: -32_000,
      message:
        "[moku-editor] game.capture gave no picture.\n  The renderer is inert, headless or this is not a dev build."
    });

    await app.stop();
  });

  it("editor.seriesStop while idle answers stopped: false with the registry envelope", async () => {
    const app = await startEditor();

    const ran = await app.channel.run("editor.seriesStop");

    expect(ran).toEqual({ value: { stopped: false }, state: app.registry.envelope() });
    await app.stop();
  });
});

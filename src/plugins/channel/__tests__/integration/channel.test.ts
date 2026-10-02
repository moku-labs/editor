/* eslint-disable unicorn/no-null -- null is the wire value for "no input" */
import { createHeadless } from "@moku-labs/game/testing";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { loadMergeGame } from "../../../../../tests/fixtures/merge-game";
import { agentCoreConfig, createAgentCore, createAgentPlugin } from "../../../../config";
import { registryPlugin } from "../../../registry";
import type { EditorChannel, Heartbeat, Json, RunResult } from "../../../registry/protocol";
import type { GameLike } from "../../../registry/types";
import { channelPlugin } from "../..";
import type { ChannelApi, HeartbeatListener } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// The agent core composed with registry + channel, over the headless merge game.
// Headless, the game rests at "splash"; answering "loaded" moves it to "home".
// ─────────────────────────────────────────────────────────────────────────────

const framework = createAgentCore(agentCoreConfig, { plugins: [registryPlugin, channelPlugin] });

/** A started headless merge game. */
type StartedGame = { readonly app: GameLike; stop(): Promise<void> };

let game: StartedGame;

/**
 * Creates the editor app over the game and starts it.
 *
 * @param heartbeatMs - The channel heartbeat interval.
 * @returns The started editor app.
 */
async function startEditor(heartbeatMs = 1000) {
  const app = framework.createApp({
    pluginConfigs: { registry: { game: game.app }, channel: { heartbeatMs } }
  });
  await app.start();
  return app;
}

/**
 * The path of a game.position value.
 *
 * @param value - A game.position wire value.
 * @returns Its path.
 */
function pathOf(value: Json | undefined): unknown {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value.path
    : undefined;
}

beforeEach(async () => {
  vi.stubGlobal("__MOKU_GAME_DEV__", true);
  const { createGame } = await loadMergeGame();
  const { app } = createGame();
  const headless = await createHeadless(app);
  game = { app, stop: () => headless.stop() };
});

afterEach(async () => {
  vi.useRealTimers();
  await game.stop();
  vi.unstubAllGlobals();
});

describe("channel integration", () => {
  it("createApp → start → read equals the door read → stop", async () => {
    const app = await startEditor();

    const value = await app.channel.read("game.position");

    expect(value).toEqual(app.registry.source("game.position")?.read(null));
    expect(pathOf(value)).toBe("splash");
    await app.stop();
  });

  it("answers at once while the game is paused", async () => {
    const app = await startEditor();
    await app.channel.run("game.pause");
    const values: Json[] = [];

    const stop = app.channel.watch("game.position", undefined, value => values.push(value));

    expect(values).toEqual([app.registry.source("game.position")?.read(null)]);
    expect(app.channel.heartbeat().paused).toBe(true);
    expect(app.channel.status()).toEqual({ kind: "paused", frame: game.app.time.snapshot().frame });
    stop();
    await app.stop();
  });

  it("runs game.step from inside a frame callback", async () => {
    const app = await startEditor();
    let tickFrame = -1;
    let ran: Promise<RunResult> | undefined;
    const off = game.app.time.onFrame("signals", () => {
      off();
      tickFrame = game.app.time.snapshot().frame;
      ran = app.channel.run("game.step", { frames: 1 });
    });

    game.app.time.step(16);
    const result = await ran;

    expect(result?.state.frame).toBe(tickFrame + 1);
    await app.stop();
  });

  it("follows the door: no duplicate on the first frame, a new path after a route", async () => {
    const app = await startEditor();
    const values: Json[] = [];
    const stop = app.channel.watch("game.position", undefined, value => values.push(value));

    game.app.time.step(16);
    expect(values).toHaveLength(1);

    await app.channel.run("game.answer", { intent: "loaded" });
    expect(values).toHaveLength(1);
    game.app.time.step(16);

    expect(values.map(value => pathOf(value))).toEqual(["splash", "home"]);
    game.app.time.step(16);
    expect(values).toHaveLength(2);
    stop();
    await app.stop();
  });

  it("beats on setInterval with the current frame", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const app = await startEditor(200);
    const beats: Heartbeat[] = [];
    app.channel.onHeartbeat(beat => beats.push(beat));
    game.app.time.step(16);

    vi.advanceTimersByTime(600);

    const { frame } = game.app.time.snapshot();
    expect(beats).toHaveLength(3);
    expect(beats.every(beat => beat.frame === frame && !beat.paused)).toBe(true);
    await app.stop();
  });

  it("stop closes every door watch and clears the timer", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const app = await startEditor(200);
    const values: Json[] = [];
    const beats: Heartbeat[] = [];
    app.channel.watch("game.position", undefined, value => values.push(value));
    app.channel.onHeartbeat(beat => beats.push(beat));

    await app.stop();
    await app.registry.command("game.answer")?.run({ intent: "loaded" });
    game.app.time.step(16);
    vi.advanceTimersByTime(1000);

    expect(values).toHaveLength(1);
    expect(beats).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects an invalid heartbeatMs at createApp", () => {
    expect(() =>
      framework.createApp({
        pluginConfigs: { registry: { game: game.app }, channel: { heartbeatMs: 50 } }
      })
    ).toThrow("[moku-editor] channel.heartbeatMs must be a whole number of at least 100.");
  });
});

describe("channel types", () => {
  it("app.channel is the EditorChannel plus heartbeat and onHeartbeat", () => {
    const app = framework.createApp({ pluginConfigs: { registry: { game: game.app } } });

    expectTypeOf(app.channel).toEqualTypeOf<ChannelApi>();
    expectTypeOf(app.channel).toMatchTypeOf<EditorChannel>();
    expectTypeOf(app.channel.heartbeat).returns.toEqualTypeOf<Heartbeat>();
    expectTypeOf(app.channel.onHeartbeat).parameter(0).toEqualTypeOf<HeartbeatListener>();
    expectTypeOf(app.channel.run).returns.resolves.toEqualTypeOf<RunResult>();
  });

  it("watch requires the input argument", () => {
    const app = framework.createApp({ pluginConfigs: { registry: { game: game.app } } });

    // @ts-expect-error — watch takes (id, input, onValue); input may be undefined but not omitted
    expect(() => app.channel.watch("game.position", () => {})).toThrow();
  });

  it("ctx.require(channelPlugin) types to ChannelApi in a dependent plugin", () => {
    let seen: ChannelApi | undefined;
    const userPlugin = createAgentPlugin("user", {
      depends: [channelPlugin],
      onInit: ctx => {
        const channel = ctx.require(channelPlugin);
        expectTypeOf(channel).toEqualTypeOf<ChannelApi>();
        seen = channel;
      }
    });

    const app = framework.createApp({
      plugins: [userPlugin],
      pluginConfigs: { registry: { game: game.app } }
    });

    expect(seen).toBeDefined();
    expect(seen?.status().kind).toBe(app.channel.status().kind);
  });
});

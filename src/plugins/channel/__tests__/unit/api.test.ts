/* eslint-disable unicorn/no-null -- null is the wire value for "no input" */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Heartbeat, Json } from "../../../registry/protocol";
import { wireError } from "../../../registry/protocol";
import { buildChannelApi, createChannelApi } from "../../api";
import { beginHeartbeat } from "../../heartbeat";
import type { ChannelCtx } from "../../types";
import { createDeps, fakeCommand } from "../helpers";

describe("read", () => {
  it("resolves the current value of a source", async () => {
    const deps = createDeps();
    const channel = buildChannelApi(deps);

    await expect(channel.read("game.position")).resolves.toEqual({ path: "home" });
  });

  it("reads synchronously at call time, with null for a missing input", async () => {
    const deps = createDeps();
    const source = deps.registry.sources.get("game.position");
    const channel = buildChannelApi(deps);

    const pending = channel.read("game.position");
    const withInput = channel.read("game.position", { last: 1 });
    expect(source?.reads).toEqual([null, { last: 1 }]);

    await Promise.all([pending, withInput]);
  });

  it("rejects -32601 with data.id for an unknown source and never throws synchronously", async () => {
    const channel = buildChannelApi(createDeps());

    let pending: Promise<Json> | undefined;
    expect(() => {
      pending = channel.read("game.nope");
    }).not.toThrow();

    await expect(pending).rejects.toMatchObject({
      code: -32_601,
      message: "[moku-editor] game.nope: unknown source",
      data: { reason: "unknown_id", retryable: false, id: "game.nope" }
    });
  });

  it("rejects with the entry error unchanged", async () => {
    const deps = createDeps();
    const failure = wireError(-32_000, "game.position: door broke", { reason: "command_failed" });
    const source = deps.registry.sources.get("game.position");
    if (source) {
      source.read = () => {
        throw failure;
      };
    }
    const channel = buildChannelApi(deps);

    await expect(channel.read("game.position")).rejects.toBe(failure);
  });
});

describe("watch", () => {
  it("delegates to openWatch: the first value arrives before watch returns", () => {
    const deps = createDeps();
    const channel = buildChannelApi(deps);
    const values: Json[] = [];

    const stop = channel.watch("game.position", undefined, value => values.push(value));

    expect(values).toEqual([{ path: "home" }]);
    expect(deps.state.watches.has(stop)).toBe(true);
    stop();
  });
});

describe("run", () => {
  it("does not call entry.run before a microtask boundary", async () => {
    const deps = createDeps();
    const command = deps.registry.commands.get("game.step");
    const channel = buildChannelApi(deps);

    const pending = channel.run("game.step", { frames: 1 });
    expect(command?.runs).toEqual([]);

    await Promise.resolve();
    expect(command?.runs).toEqual([{ frames: 1 }]);
    await expect(pending).resolves.toEqual({
      value: null,
      state: { path: "home", frame: 1, tainted: false }
    });
  });

  it("passes null for a missing input", async () => {
    const deps = createDeps();
    const command = deps.registry.commands.get("game.step");

    await buildChannelApi(deps).run("game.step");

    expect(command?.runs).toEqual([null]);
  });

  it("rejects an unknown command asynchronously with -32601", async () => {
    const deps = createDeps();
    const lookups = vi.spyOn(deps.registry, "command");
    const channel = buildChannelApi(deps);

    const pending = channel.run("game.nope");
    expect(lookups).not.toHaveBeenCalled();

    await expect(pending).rejects.toMatchObject({
      code: -32_601,
      message: "[moku-editor] game.nope: unknown command",
      data: { reason: "unknown_id", retryable: false, id: "game.nope" }
    });
  });

  it("rejects with the command's error unchanged", async () => {
    const deps = createDeps();
    const failure = wireError(-32_000, "game.step: refused");
    deps.registry.commands.set(
      "game.step",
      fakeCommand("game.step", () => Promise.reject(failure))
    );

    await expect(buildChannelApi(deps).run("game.step")).rejects.toBe(failure);
  });

  it("rejects when entry.run throws synchronously", async () => {
    const deps = createDeps();
    const failure = new Error("[moku-editor] sync throw");
    deps.registry.commands.set(
      "game.step",
      fakeCommand("game.step", () => {
        throw failure;
      })
    );

    await expect(buildChannelApi(deps).run("game.step")).rejects.toBe(failure);
  });
});

describe("status", () => {
  it("is live with the frame while the clock runs", () => {
    const deps = createDeps();

    expect(buildChannelApi(deps).status()).toEqual({ kind: "live", frame: 1840 });
  });

  it("is paused with the frame while the clock is paused", () => {
    const deps = createDeps();
    deps.registry.clockNow = { frame: 12, paused: true };

    expect(buildChannelApi(deps).status()).toEqual({ kind: "paused", frame: 12 });
  });
});

describe("heartbeat and onHeartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_790_000_000_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("heartbeat returns a fresh frozen beat now", () => {
    const deps = createDeps();
    deps.registry.clockNow = { frame: 7, paused: true };

    const beat = buildChannelApi(deps).heartbeat();

    expect(beat).toEqual({ frame: 7, paused: true, at: 1_790_000_000_000 });
    expect(Object.isFrozen(beat)).toBe(true);
  });

  it("onHeartbeat listeners get beats once the interval runs, and the remover is idempotent", () => {
    const deps = createDeps(100);
    const channel = buildChannelApi(deps);
    const beats: Heartbeat[] = [];

    const off = channel.onHeartbeat(beat => beats.push(beat));
    beginHeartbeat(deps);
    vi.advanceTimersByTime(200);
    expect(beats).toHaveLength(2);

    off();
    off();
    vi.advanceTimersByTime(200);
    expect(beats).toHaveLength(2);
    expect(deps.state.listeners.size).toBe(0);
  });

  it("the same function added twice gets two subscriptions with their own removers", () => {
    const deps = createDeps(100);
    const channel = buildChannelApi(deps);
    const beats: Heartbeat[] = [];
    const listener = (beat: Heartbeat): void => {
      beats.push(beat);
    };

    const offFirst = channel.onHeartbeat(listener);
    channel.onHeartbeat(listener);
    beginHeartbeat(deps);
    vi.advanceTimersByTime(100);
    expect(beats).toHaveLength(2);

    offFirst();
    vi.advanceTimersByTime(100);
    expect(beats).toHaveLength(3);
  });
});

describe("createChannelApi", () => {
  it("builds the api over ctx.require(registry)", async () => {
    const deps = createDeps();
    const ctx = {
      config: deps.config,
      state: deps.state,
      log: deps.log,
      require: () => deps.registry
    } as unknown as ChannelCtx;

    await expect(createChannelApi(ctx).read("game.position")).resolves.toEqual({ path: "home" });
  });
});

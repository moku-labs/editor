import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Heartbeat } from "../../../registry/protocol";
import { beatOf, beginHeartbeat, checkConfig, startHeartbeat, stopChannel } from "../../heartbeat";
import type { ChannelCtx } from "../../types";
import { createDeps, thrownBy } from "../helpers";

const CONFIG_ERROR =
  "[moku-editor] channel.heartbeatMs must be a whole number of at least 100.\n  Pass pluginConfigs.channel.heartbeatMs, for example 1000.";

describe("checkConfig", () => {
  it.each([
    99,
    1.5,
    150.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    0,
    -1000
  ])("rejects heartbeatMs %s", heartbeatMs => {
    expect(thrownBy(() => checkConfig({ config: { heartbeatMs } }))).toMatchObject({
      message: CONFIG_ERROR
    });
  });

  it.each([100, 1000])("accepts heartbeatMs %s", heartbeatMs => {
    expect(() => checkConfig({ config: { heartbeatMs } })).not.toThrow();
  });
});

describe("beatOf", () => {
  it("builds a frozen { frame, paused, at } from the registry clock", () => {
    const { registry } = createDeps();
    registry.clockNow = { frame: 1840, paused: true };

    const beat = beatOf(registry, 1_790_000_000_000);

    expect(beat).toEqual({ frame: 1840, paused: true, at: 1_790_000_000_000 });
    expect(Object.keys(beat)).toEqual(["frame", "paused", "at"]);
    expect(Object.isFrozen(beat)).toBe(true);
  });
});

describe("beginHeartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_790_000_000_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ticks every heartbeatMs on setInterval, not at start", () => {
    const deps = createDeps(250);
    const beats: Heartbeat[] = [];
    deps.state.listeners.add(beat => beats.push(beat));

    beginHeartbeat(deps);
    expect(deps.state.timer).toBeDefined();
    expect(beats).toEqual([]);

    vi.advanceTimersByTime(249);
    expect(beats).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(beats).toEqual([{ frame: 1840, paused: false, at: 1_790_000_000_250 }]);

    deps.registry.clockNow = { frame: 1900, paused: true };
    vi.advanceTimersByTime(500);
    expect(beats).toHaveLength(3);
    expect(beats.at(-1)).toEqual({ frame: 1900, paused: true, at: 1_790_000_000_750 });
    stopChannel(deps);
  });

  it("gives every listener the same frozen beat, in subscription order", () => {
    const deps = createDeps(100);
    const calls: [string, Heartbeat][] = [];
    deps.state.listeners.add(beat => calls.push(["first", beat]));
    deps.state.listeners.add(beat => calls.push(["second", beat]));

    beginHeartbeat(deps);
    vi.advanceTimersByTime(100);

    expect(calls.map(([name]) => name)).toEqual(["first", "second"]);
    expect(calls[0]?.[1]).toBe(calls[1]?.[1]);
    expect(Object.isFrozen(calls[0]?.[1])).toBe(true);
    stopChannel(deps);
  });

  it("logs a throwing listener once per tick and still runs the next one", () => {
    const deps = createDeps(100);
    const beats: Heartbeat[] = [];
    deps.state.listeners.add(() => {
      throw new Error("listener broke");
    });
    deps.state.listeners.add(beat => beats.push(beat));

    beginHeartbeat(deps);
    vi.advanceTimersByTime(100);
    expect(beats).toHaveLength(1);
    expect(deps.log.warn).toHaveBeenCalledTimes(1);
    expect(deps.log.warn).toHaveBeenCalledWith("channel:heartbeat-listener-failed", {
      message: "listener broke"
    });

    vi.advanceTimersByTime(100);
    expect(beats).toHaveLength(2);
    expect(deps.log.warn).toHaveBeenCalledTimes(2);
    stopChannel(deps);
  });

  it("logs a thrown non-Error value by its text", () => {
    const deps = createDeps(100);
    deps.state.listeners.add(() => {
      throw "plain text";
    });

    beginHeartbeat(deps);
    vi.advanceTimersByTime(100);

    expect(deps.log.warn).toHaveBeenCalledWith("channel:heartbeat-listener-failed", {
      message: "plain text"
    });
    stopChannel(deps);
  });

  it("a listener removed during a tick does not break the tick", () => {
    const deps = createDeps(100);
    const calls: string[] = [];
    const first = (): void => {
      calls.push("first");
      deps.state.listeners.delete(first);
    };
    deps.state.listeners.add(first);
    deps.state.listeners.add(() => calls.push("second"));

    beginHeartbeat(deps);
    vi.advanceTimersByTime(200);

    expect(calls).toEqual(["first", "second", "second"]);
    stopChannel(deps);
  });

  it("replaces a running interval instead of starting a second one", () => {
    const deps = createDeps(100);
    const beats: Heartbeat[] = [];
    deps.state.listeners.add(beat => beats.push(beat));

    beginHeartbeat(deps);
    beginHeartbeat(deps);
    vi.advanceTimersByTime(100);

    expect(beats).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);
    stopChannel(deps);
  });

  it("unrefs the timer when the runtime offers unref", () => {
    vi.useRealTimers();
    const deps = createDeps(100_000);

    beginHeartbeat(deps);
    const { timer } = deps.state;

    expect(typeof timer === "object" && timer !== null && "hasRef" in timer && timer.hasRef()).toBe(
      false
    );
    stopChannel(deps);
  });

  it.each([7, { unref: "no" }])("leaves a browser-style timer %o alone", timer => {
    vi.useRealTimers();
    const handle = timer as unknown as ReturnType<typeof setInterval>;
    const start = vi.spyOn(globalThis, "setInterval").mockReturnValue(handle);
    const clear = vi.spyOn(globalThis, "clearInterval").mockImplementation(() => {});
    const deps = createDeps(100);

    expect(() => beginHeartbeat(deps)).not.toThrow();
    expect(deps.state.timer).toBe(handle);

    stopChannel(deps);
    expect(clear).toHaveBeenCalledWith(handle);
    start.mockRestore();
    clear.mockRestore();
  });
});

describe("startHeartbeat", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts the interval with the registry from ctx.require", () => {
    vi.useFakeTimers();
    const deps = createDeps(100);
    const beats: Heartbeat[] = [];
    deps.state.listeners.add(beat => beats.push(beat));
    const ctx = {
      config: deps.config,
      state: deps.state,
      log: deps.log,
      require: () => deps.registry
    } as unknown as ChannelCtx;

    startHeartbeat(ctx);
    vi.advanceTimersByTime(100);

    expect(beats).toEqual([expect.objectContaining({ frame: 1840, paused: false })]);
    stopChannel(deps);
  });
});

describe("stopChannel", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears the timer, closes every watch and clears the listeners", () => {
    vi.useFakeTimers();
    const deps = createDeps(100);
    const beats: Heartbeat[] = [];
    deps.state.listeners.add(beat => beats.push(beat));
    const closed: string[] = [];
    const first = (): void => {
      closed.push("first");
      deps.state.watches.delete(first);
    };
    const second = (): void => {
      closed.push("second");
      deps.state.watches.delete(second);
    };
    deps.state.watches.add(first);
    deps.state.watches.add(second);
    beginHeartbeat(deps);

    stopChannel({ state: deps.state });
    vi.advanceTimersByTime(1000);

    expect(deps.state.timer).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    expect(beats).toEqual([]);
    expect(closed).toEqual(["first", "second"]);
    expect(deps.state.watches.size).toBe(0);
    expect(deps.state.listeners.size).toBe(0);
  });

  it("is safe without a running timer", () => {
    const deps = createDeps();

    expect(() => stopChannel(deps)).not.toThrow();
    expect(deps.state.timer).toBeUndefined();
  });
});

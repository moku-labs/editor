import { afterEach, describe, expect, it, vi } from "vitest";
import { encode, notification } from "../../../registry/protocol";
import { checkConfig, stopBridge } from "../../lifecycle";
import { createBridgeState } from "../../state";
import { CONFIG, FakeSocket, openDeps } from "../helpers";

afterEach(() => {
  vi.useRealTimers();
});

describe("createBridgeState", () => {
  it("starts idle and connecting with empty maps", () => {
    const state = createBridgeState({ config: CONFIG });

    expect(state).toEqual({
      phase: "idle",
      status: { kind: "connecting" },
      session: undefined,
      socket: undefined,
      attempt: 0,
      retryTimer: undefined,
      failureLogged: false,
      lastFrame: 0,
      subs: new Map(),
      pending: new Map(),
      inflight: new Map(),
      off: []
    });
  });

  it("gives every state its own maps", () => {
    const first = createBridgeState({ config: CONFIG });
    const second = createBridgeState({ config: CONFIG });

    expect(first.subs).not.toBe(second.subs);
    expect(first.off).not.toBe(second.off);
  });
});

describe("checkConfig", () => {
  it("accepts the defaults", () => {
    expect(() => checkConfig({ config: CONFIG })).not.toThrow();
  });

  it("rejects an empty hello", () => {
    expect(() => checkConfig({ config: { ...CONFIG, hello: "" } })).toThrow(
      '[moku-editor] bridge.hello must be a non-empty string.\n  Fix pluginConfigs.bridge.hello, for example "/__editor/hello".'
    );
  });

  it.each([50, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects retryMs %s", retryMs => {
    expect(() => checkConfig({ config: { ...CONFIG, retryMs } })).toThrow(
      "[moku-editor] bridge.retryMs must be a whole number of at least 100.\n  Fix pluginConfigs.bridge.retryMs, for example 1000."
    );
  });

  it("rejects a callTimeoutMs below 100", () => {
    expect(() => checkConfig({ config: { ...CONFIG, callTimeoutMs: 99 } })).toThrow(
      "[moku-editor] bridge.callTimeoutMs must be a whole number of at least 100.\n  Fix pluginConfigs.bridge.callTimeoutMs, for example 5000."
    );
  });
});

describe("stopBridge", () => {
  it("says bye, closes 1000, clears timers, listeners and subs", () => {
    vi.useFakeTimers();
    const { deps, socket } = openDeps();
    const off = vi.fn();
    const stop = vi.fn();
    deps.state.off.push(off);
    deps.state.retryTimer = setTimeout(() => {}, 1000);
    deps.state.inflight.set(
      1,
      setTimeout(() => {}, 1000)
    );
    deps.state.subs.set(1, {
      sub: 1,
      id: "game.position",
      input: undefined,
      changes: "edge",
      stop,
      lastSent: undefined
    });
    deps.state.pending.set(1, 2);
    deps.state.session = "s-1";

    stopBridge({ state: deps.state });

    expect(socket.sent).toEqual([encode(notification("game", "bye"))]);
    expect(socket.closes).toEqual([{ code: 1000, reason: "bye" }]);
    expect(deps.state.phase).toBe("stopped");
    expect(deps.state.socket).toBeUndefined();
    expect(deps.state.session).toBeUndefined();
    expect(deps.state.retryTimer).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    expect(off).toHaveBeenCalledOnce();
    expect(deps.state.off).toEqual([]);
    expect(stop).toHaveBeenCalledOnce();
    expect(deps.state.subs.size).toBe(0);
    expect(deps.state.pending.size).toBe(0);
  });

  it("closes a socket that is still connecting without a bye", () => {
    const { deps } = openDeps();
    const socket = new FakeSocket();
    deps.state.socket = socket;

    stopBridge({ state: deps.state });

    expect(socket.sent).toEqual([]);
    expect(socket.closes).toHaveLength(1);
  });

  it("is safe without a socket", () => {
    const { deps } = openDeps();
    deps.state.socket = undefined;

    expect(() => stopBridge({ state: deps.state })).not.toThrow();
    expect(deps.state.phase).toBe("stopped");
  });
});

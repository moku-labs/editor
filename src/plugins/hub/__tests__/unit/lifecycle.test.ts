/* eslint-disable sonarjs/no-hardcoded-ip -- LAN addresses of device mode are the cases under test */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refreshAndPublish } from "../../engine";
import { startHub, stopHub } from "../../lifecycle";
import {
  createCtx,
  createDeviceHarness,
  createHarness,
  ENGINE,
  flush,
  helloOf,
  pairAdb,
  pairOf,
  paramsOf
} from "../helpers";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("startHub", () => {
  it("creates a new token every start and never logs it", () => {
    const first = createCtx();
    const second = createCtx();

    startHub(first);
    startHub(second);

    expect(first.state.token).toMatch(/^[\w-]{43}$/);
    expect(second.state.token).not.toBe(first.state.token);
    const logged = JSON.stringify([first.log.info.mock.calls, first.log.debug.mock.calls]);
    expect(logged).not.toContain(first.state.token ?? "none");
    stopHub(first);
    stopHub(second);
  });

  it("ticks the silent check every min(1000, silentAfterMs / 2) ms", () => {
    const harness = createHarness({ silentAfterMs: 600 });
    startHub(harness.ctx);
    const { session } = harness.hello();

    vi.advanceTimersByTime(600);
    expect(harness.ctx.state.sessions.get(session)?.silent).toBe(false);

    vi.advanceTimersByTime(300);
    expect(harness.ctx.state.sessions.get(session)?.silent).toBe(true);
    stopHub(harness.ctx);
  });

  it("ticks at most once a second with the default silentAfterMs", () => {
    const harness = createHarness();
    startHub(harness.ctx);
    const { session } = harness.hello();

    vi.advanceTimersByTime(6000);
    expect(harness.ctx.state.sessions.get(session)?.silent).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(harness.ctx.state.sessions.get(session)?.silent).toBe(true);
    stopHub(harness.ctx);
  });
});

describe("stopHub", () => {
  it("closes every socket with 1001, clears timers, maps and the token", () => {
    const harness = createHarness();
    startHub(harness.ctx);
    const { agent, session } = harness.hello();
    const tools = harness.connect("tools");
    const entry = harness.ctx.state.sessions.get(session);
    harness.send(tools, {
      jsonrpc: "2.0",
      id: 1,
      channel: "game",
      method: "read",
      params: { id: "game.position" }
    });
    harness.send(tools, {
      jsonrpc: "2.0",
      id: 2,
      channel: "game",
      method: "watch",
      params: { sub: 1, id: "game.position" }
    });
    tools.clear();

    stopHub(harness.ctx);

    expect(agent.closes).toEqual([{ code: 1001, reason: "editor stopping" }]);
    expect(tools.closes).toEqual([{ code: 1001, reason: "editor stopping" }]);
    const { state } = harness.ctx;
    expect(state.token).toBeUndefined();
    expect(state.silentTimer).toBeUndefined();
    expect([state.conns.size, state.sessions.size, state.pending.size, state.shared.size]).toEqual([
      0, 0, 0, 0
    ]);

    vi.advanceTimersByTime(60_000);
    expect(tools.sent).toEqual([]);
    expect(entry?.silent).toBe(false);
  });

  it("forgets the selection's page and keeps the selection as null: no page is left (A7)", () => {
    const harness = createHarness();
    startHub(harness.ctx);
    const page = harness.page();
    harness.send(page, {
      jsonrpc: "2.0",
      channel: "editor",
      method: "selection",
      params: { ref: { kind: "entity", id: 7 }, name: "slime", type: "entity", at: 1 }
    });

    stopHub(harness.ctx);

    expect(harness.ctx.state.selectionConn).toBeUndefined();
    expect(harness.ctx.state.published.get("selection")).toBeNull();
  });

  it("keeps no selection when none was published", () => {
    const harness = createHarness();
    startHub(harness.ctx);

    stopHub(harness.ctx);

    expect(harness.ctx.state.published.has("selection")).toBe(false);
  });

  it("runs with the teardown context only and twice in a row", () => {
    const ctx = createCtx();
    startHub(ctx);

    expect(() => {
      stopHub({ state: ctx.state });
      stopHub({ state: ctx.state });
    }).not.toThrow();
  });
});

describe("startHub and the computer's engine (C7)", () => {
  it("publishes files.engine() as engine on start, replayed to a tools page that opens later", () => {
    const harness = createHarness();

    startHub(harness.ctx);
    const tools = harness.connect("tools");

    expect(harness.ctx.files.engine).toHaveBeenCalledTimes(1);
    expect(harness.ctx.state.engineId).toBe(ENGINE.id);
    expect(paramsOf(tools.notes("editor", "engine")[0])).toEqual(ENGINE);
    stopHub(harness.ctx);
  });

  it("publishes again after a pairing only when the refreshed id changed", async () => {
    const harness = await createDeviceHarness();
    startHub(harness.ctx);
    const tools = harness.connect("tools");
    tools.clear();
    const newer = { id: "0.14.13+1ab7f2", version: "0.14.13", dist: "1ab7f2cc" };

    pairAdb(harness);
    await flush();
    expect(tools.notes("editor", "engine")).toEqual([]);

    harness.ctx.files.refreshEngine.mockResolvedValueOnce(newer);
    pairAdb(harness);
    await flush();
    expect(tools.notes("editor", "engine").map(note => paramsOf(note))).toEqual([newer]);
    expect(harness.ctx.state.engineId).toBe(newer.id);
    await stopHub(harness.ctx);
  });

  it("keeps the last id and logs at debug when the refresh rejects", async () => {
    const harness = createHarness();
    startHub(harness.ctx);
    harness.ctx.files.refreshEngine.mockRejectedValueOnce(new Error("EACCES"));

    await refreshAndPublish(harness.ctx);

    expect(harness.ctx.state.engineId).toBe(ENGINE.id);
    expect(harness.ctx.log.debug).toHaveBeenCalledWith("hub:engine-refresh-failed", {
      error: "Error: EACCES"
    });
    stopHub(harness.ctx);
  });
});

describe("stopHub and device mode", () => {
  it("tears device mode down through the state only: listeners stopped, pairings aborted, no hub:device and no log line (bug: a teardown that calls stopDevices)", async () => {
    const harness = await createDeviceHarness({ deviceLan: true, lanAddress: "192.168.1.5" });
    startHub(harness.ctx);
    const { socket } = pairAdb(harness);
    harness.send(socket, helloOf());
    const pairing = harness.device({ link: "lan", address: "192.168.1.23" });
    harness.send(pairing, pairOf());
    harness.ctx.emit.mockClear();
    for (const level of ["info", "debug", "warn", "error"] as const)
      harness.ctx.log[level].mockClear();

    await stopHub({ state: harness.ctx.state });
    harness.close(socket);
    harness.close(pairing);

    expect(harness.fake.servers.map(server => server.stop.mock.calls.length)).toEqual([1, 1]);
    expect(harness.asked[0]?.signal.aborted).toBe(true);
    expect(harness.ctx.state.deviceServers).toBeUndefined();
    expect(harness.ctx.state.devices.size).toBe(0);
    expect(socket.closes).toEqual([{ code: 1001, reason: "editor stopping" }]);
    expect(harness.ctx.emit).not.toHaveBeenCalled();
    const { log } = harness.ctx;
    expect([log.info, log.debug, log.warn, log.error].flatMap(level => level.mock.calls)).toEqual(
      []
    );
  });
});

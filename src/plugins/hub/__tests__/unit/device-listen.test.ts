/* eslint-disable unicorn/no-null, sonarjs/no-hardcoded-ip -- null is "no LAN listener" (DeviceListen.lan); LAN addresses are the cases under test */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceDeps } from "../../device/listen";
import { DEVICE_STOP_MS, listenDevices, stopDevices, teardownDevices } from "../../device/listen";
import { registerRoutes } from "../../serve";
import { createHubState } from "../../state";
import type { DeviceListenOptions, HubDeviceEvent } from "../../types";
import type { DeviceHarness, FakeServe, Harness } from "../helpers";
import {
  createDeviceHarness,
  createHarness,
  DEFAULT_CONFIG,
  fakeServe,
  helloOf,
  pairAdb,
  pairOf,
  recordingConfirm
} from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Device mode on and off (C2) behind a fake listener start: what each listener
// serves, the errors, and the two halves of device mode off (stopDevices with
// its events and log line, teardownDevices with neither).
// ─────────────────────────────────────────────────────────────────────────────

const confirm = recordingConfirm().confirm;

/**
 * The deps of a fake listener start with an interface table.
 *
 * @param fake - The fake serve.
 * @param interfaces - The interface table.
 * @returns The deps.
 */
function depsOf(
  fake: FakeServe,
  interfaces: ReturnType<DeviceDeps["interfaces"]> = {}
): DeviceDeps {
  return { serve: fake.serve, interfaces: () => interfaces };
}

/**
 * Starts device mode on a harness with fake listeners.
 *
 * @param harness - A started harness.
 * @param fake - The fake serve.
 * @param options - The options of listenDevices.
 * @returns What listenDevices answered.
 */
function listen(harness: Harness, fake: FakeServe, options?: DeviceListenOptions) {
  return listenDevices(harness.ctx, options ?? { confirm }, harness.handler, depsOf(fake));
}

/**
 * The hub:device events a harness emitted, in order.
 *
 * @param harness - The harness.
 * @returns The events.
 */
function deviceEvents(harness: Harness): HubDeviceEvent[] {
  return harness.ctx.emit.mock.calls.flatMap(([name, payload]) =>
    name === "hub:device" && "kind" in payload ? [payload] : []
  );
}

/**
 * Every line the harness logged, at every level.
 *
 * @param harness - The harness.
 * @returns The log calls.
 */
function logLines(harness: Harness): unknown[] {
  const { log } = harness.ctx;
  return [
    ...log.info.mock.calls,
    ...log.debug.mock.calls,
    ...log.warn.mock.calls,
    ...log.error.mock.calls
  ];
}

describe("listenDevices", () => {
  it("binds the adb listener on 127.0.0.1 with the extra routes, the editor routes and the socket", async () => {
    const harness = createHarness();
    const fake = fakeServe();
    const hello = new Response("hello");
    const page = new Response("no game here");
    registerRoutes(harness.ctx, { "/__editor/hello": hello });

    const answer = await listen(harness, fake, { confirm, routes: { "/": page } });

    expect(answer).toEqual({ port: 47_600, adb: "127.0.0.1:47600", lan: null });
    expect(fake.calls).toHaveLength(1);
    const [adb] = fake.calls;
    expect([adb?.hostname, adb?.port]).toEqual(["127.0.0.1", 47_600]);
    expect(Object.keys(adb?.routes ?? {}).toSorted()).toEqual([
      "/",
      "/__editor/hello",
      "/__editor/ws"
    ]);
    expect(adb?.routes["/__editor/hello"]).toBe(hello);
    expect(adb?.websocket).toBe(harness.handler);
    expect(adb?.fetch().status).toBe(404);
    expect(harness.ctx.state.deviceListen).toEqual(answer);
    expect(harness.ctx.log.info).toHaveBeenCalledWith("hub:devices-on", {
      port: 47_600,
      lan: null
    });
    expect(deviceEvents(harness)).toEqual([{ kind: "listening", listen: answer }]);
  });

  it("binds the LAN listener on the LAN address and the real port with the socket only (bug: the tools page reachable from the LAN)", async () => {
    const harness = createHarness({ devicePort: 0, deviceLan: true, lanAddress: "192.168.1.5" });
    const fake = fakeServe(51_234);
    registerRoutes(harness.ctx, { "/__editor/hello": new Response("hello") });

    const answer = await listen(harness, fake, { confirm, routes: { "/": new Response("page") } });

    expect(answer).toEqual({ port: 51_234, adb: "127.0.0.1:51234", lan: "192.168.1.5:51234" });
    const lan = fake.calls[1];
    expect([lan?.hostname, lan?.port]).toEqual(["192.168.1.5", 51_234]);
    expect(Object.keys(lan?.routes ?? {})).toEqual(["/__editor/ws"]);
    expect(lan?.fetch().status).toBe(404);
  });

  it("writes an IPv6 LAN address in brackets and picks the card's address when lanAddress is unset", async () => {
    const ipv6 = createHarness({ deviceLan: true, lanAddress: "::1" });
    const bracketed = await listen(ipv6, fakeServe());
    expect(bracketed.lan).toBe("[::1]:47600");

    // The Host check compares with this text lower-cased: an upper-case address never matches.
    const upper = createHarness({ deviceLan: true, lanAddress: "FE80::1" });
    const lowered = await listen(upper, fakeServe());
    expect(lowered.lan).toBe("[fe80::1]:47600");

    const picked = createHarness({ deviceLan: true });
    const fake = fakeServe();
    const interfaces = {
      utun3: [{ address: "10.8.0.2", family: "IPv4", internal: false }],
      en0: [{ address: "192.168.1.5", family: "IPv4", internal: false }]
    };
    const answer = await listenDevices(
      picked.ctx,
      { confirm },
      picked.handler,
      depsOf(fake, interfaces)
    );
    expect(answer.lan).toBe("192.168.1.5:47600");
  });

  it("throws the two-line no-LAN error and starts nothing when deviceLan finds no address", async () => {
    const harness = createHarness({ deviceLan: true });
    const fake = fakeServe();

    await expect(listen(harness, fake)).rejects.toThrow(
      /^\[moku-editor] hub: --lan found no LAN address on this computer\.\n {2}Connect to a Wi-Fi or set pluginConfigs\.hub\.lanAddress\.$/
    );
    expect(fake.serve).not.toHaveBeenCalled();
    expect(harness.ctx.state.deviceServers).toBeUndefined();
  });

  it("throws a two-line lifecycle Error before start and while device mode is on", async () => {
    const harness = createHarness();
    harness.ctx.state.token = undefined;
    const before = listen(harness, fakeServe());
    await expect(before).rejects.toThrow(
      /^\[moku-editor] hub\.listenDevices\(\) needs a started app\.\n {2}Call it after await editor\.start\(\)\.$/
    );
    await expect(before).rejects.not.toBeInstanceOf(TypeError);

    const started = createHarness();
    await listen(started, fakeServe());
    await expect(listen(started, fakeServe())).rejects.toThrow(
      /^\[moku-editor] hub\.listenDevices\(\): device mode is already on\.\n {2}Call hub\.stopDevices\(\) first\.$/
    );
  });

  it("refuses a confirm that is not a function with a TypeError", async () => {
    const harness = createHarness();
    const options: DeviceListenOptions = JSON.parse('{"confirm":"yes"}');

    await expect(listen(harness, fakeServe(), options)).rejects.toBeInstanceOf(TypeError);
    await expect(listen(harness, fakeServe(), options)).rejects.toThrow(
      /^\[moku-editor] hub\.listenDevices\(\) needs options\.confirm/
    );
  });

  it("refuses an extra route under the editor path", async () => {
    const harness = createHarness();
    const fake = fakeServe();

    await expect(
      listen(harness, fake, { confirm, routes: { "/__editor/x": new Response("x") } })
    ).rejects.toThrow(/^\[moku-editor] hub\.listenDevices\(\) refuses the route "\/__editor\/x"/);
    expect(fake.serve).not.toHaveBeenCalled();
  });

  it("freezes the editor routes: addRoutes throws after it", async () => {
    const harness = createHarness();
    await listen(harness, fakeServe());

    expect(() => registerRoutes(harness.ctx, { "/__editor/late": new Response("late") })).toThrow(
      /^\[moku-editor] hub\.addRoutes\(\) ran after hub\.serve\(\) or hub\.listenDevices\(\)\./
    );
  });

  it("turns a taken port into the two-line port error and keeps code EADDRINUSE", async () => {
    const harness = createHarness();
    const fake = fakeServe();
    fake.serve.mockImplementationOnce(() => {
      throw Object.assign(new Error("Failed to start server. Is port 47600 in use?"), {
        code: "EADDRINUSE"
      });
    });

    const failing = listen(harness, fake);

    await expect(failing).rejects.toThrow(
      /^\[moku-editor] port 47600 is in use\.\n {2}Is another moku-editor perf running\? Try --port 47601\.$/
    );
    await expect(failing).rejects.toMatchObject({ code: "EADDRINUSE" });
    expect(harness.ctx.state.deviceServers).toBeUndefined();
  });

  it("rethrows another start error as it is", async () => {
    const harness = createHarness();
    const fake = fakeServe();
    const denied = Object.assign(new Error("permission denied"), { code: "EACCES" });
    fake.serve.mockImplementationOnce(() => {
      throw denied;
    });

    await expect(listen(harness, fake)).rejects.toBe(denied);
  });

  it("stops the adb listener when the LAN listener fails", async () => {
    const harness = createHarness({ deviceLan: true, lanAddress: "192.168.1.5" });
    const fake = fakeServe();
    const adbStart = fake.serve.getMockImplementation();
    fake.serve.mockImplementation(options => {
      if (options.hostname !== "127.0.0.1") {
        throw Object.assign(new Error("in use"), { code: "EADDRINUSE" });
      }
      if (adbStart === undefined) throw new Error("no fake");
      return adbStart(options);
    });

    await expect(listen(harness, fake)).rejects.toMatchObject({ code: "EADDRINUSE" });
    expect(fake.servers[0]?.stop).toHaveBeenCalledWith(true);
    expect(harness.ctx.state.deviceServers).toBeUndefined();
    expect(deviceEvents(harness)).toEqual([]);
  });
});

describe("stopDevices", () => {
  let harness: DeviceHarness;

  beforeEach(async () => {
    harness = await createDeviceHarness();
  });

  it("emits closed (stopped) per connected device, closes device sockets 1001, forgets tokens, then emits stopped", async () => {
    const { socket, id } = pairAdb(harness);
    const away = pairAdb(harness);
    harness.close(away.socket);
    harness.ctx.emit.mockClear();

    await stopDevices(harness.ctx);

    const kinds = deviceEvents(harness).map(event =>
      event.kind === "closed" ? [event.kind, event.device.id, event.reason] : [event.kind]
    );
    expect(kinds).toEqual([["closed", id, "stopped"], ["stopped"]]);
    const [closed] = deviceEvents(harness);
    expect(closed?.kind === "closed" ? closed.device.online : undefined).toBe(false);
    expect(socket.closes).toEqual([{ code: 1001, reason: "device mode off" }]);
    expect(harness.ctx.state.devices.size).toBe(0);
    expect(harness.fake.servers[0]?.stop).toHaveBeenCalledWith(true);
    expect(harness.ctx.log.info).toHaveBeenCalledWith("hub:devices-off", {});

    harness.close(socket);
    expect(deviceEvents(harness)).toHaveLength(2);
  });

  it("does nothing on a second call", async () => {
    await stopDevices(harness.ctx);
    harness.ctx.emit.mockClear();
    harness.ctx.log.info.mockClear();

    await stopDevices(harness.ctx);

    expect(harness.ctx.emit).not.toHaveBeenCalled();
    expect(harness.ctx.log.info).not.toHaveBeenCalled();
  });

  it("resolves after at most 500 ms when a listener never stops", async () => {
    vi.useFakeTimers();
    try {
      harness.fake.servers[0]?.stop.mockImplementation(() => new Promise(() => undefined));
      let done = false;
      const stopping = stopDevices(harness.ctx).then(() => {
        done = true;
      });

      await vi.advanceTimersByTimeAsync(DEVICE_STOP_MS - 1);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await stopping;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("teardownDevices", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("aborts pairings, closes device sockets 1001, stops both listeners and clears device mode, with no emit and no log line", async () => {
    vi.useFakeTimers();
    const harness = await createDeviceHarness({ deviceLan: true, lanAddress: "192.168.1.5" });
    const { socket: paired } = pairAdb(harness);
    harness.send(paired, helloOf());
    const pairing = harness.device({ link: "lan", address: "192.168.1.23" });
    harness.send(pairing, pairOf());
    await vi.advanceTimersByTimeAsync(0);
    const { state } = harness.ctx;
    harness.ctx.emit.mockClear();
    harness.ctx.log.info.mockClear();
    harness.ctx.log.debug.mockClear();

    await teardownDevices(state);

    expect(harness.asked[0]?.signal.aborted).toBe(true);
    expect(paired.closes).toEqual([{ code: 1001, reason: "device mode off" }]);
    expect(pairing.closes).toEqual([{ code: 1001, reason: "device mode off" }]);
    expect(harness.fake.servers.map(server => server.stop.mock.calls)).toEqual([
      [[true]],
      [[true]]
    ]);
    expect([state.devices.size, state.deviceServers, state.deviceListen, state.confirm]).toEqual([
      0,
      undefined,
      undefined,
      undefined
    ]);
    expect(state.pairing.queue).toEqual([]);
    expect(state.pairing.asking).toBeUndefined();
    expect(harness.ctx.emit).not.toHaveBeenCalled();
    expect(logLines(harness)).toEqual([]);

    // The closed sockets' own close handlers find no device record: no hub:device, no device line.
    harness.close(paired);
    harness.close(pairing);
    vi.advanceTimersByTime(60_000);
    expect(deviceEvents(harness)).toEqual([]);
    const lines = logLines(harness).map(line => (Array.isArray(line) ? line[0] : line));
    expect(lines.filter(line => line !== "hub:close")).toEqual([]);
    expect(pairing.closes).toHaveLength(1);
  });

  it("resolves at once with device mode off", async () => {
    const state = createHubState({ config: DEFAULT_CONFIG });

    await expect(teardownDevices(state)).resolves.toBeUndefined();
    expect(state.deviceServers).toBeUndefined();
  });

  it("clears the first-message deadline of the pairing sockets it closes", async () => {
    vi.useFakeTimers();
    const harness = await createDeviceHarness();
    const idle = harness.device({ link: "lan", address: "192.168.1.23" });

    await teardownDevices(harness.ctx.state);
    vi.advanceTimersByTime(60_000);

    expect(idle.closes).toEqual([{ code: 1001, reason: "device mode off" }]);
  });

  it("leaves a non-device agent's socket open", async () => {
    const harness = await createDeviceHarness();
    const game = harness.connect("agent");

    await teardownDevices(harness.ctx.state);

    expect(game.closes).toEqual([]);
  });
});

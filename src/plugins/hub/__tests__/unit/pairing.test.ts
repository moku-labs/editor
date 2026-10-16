/* eslint-disable sonarjs/no-hardcoded-ip -- LAN phone addresses are the cases under test */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notification } from "../../../registry/protocol";
import { createHubApi } from "../../api";
import { forget, PAIR_COOLDOWN_MS, PAIR_FIRST_MS } from "../../device/pairing";
import { publishEngine } from "../../engine";
import type { HubDeviceEvent } from "../../types";
import type { DeviceHarness } from "../helpers";
import { createDeviceHarness, ENGINE, flush, helloOf, pairAdb, pairOf, paramsOf } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Pairing (C4) and the paired connections (C5 close reasons) through the hub's
// socket handler, with device mode on behind fake listeners and a recording
// confirm. PHONE is a LAN phone's address.
// ─────────────────────────────────────────────────────────────────────────────

const PHONE = "192.168.1.23";
const NOW = 1_000_000;

/**
 * The hub:device events a harness emitted, in order.
 *
 * @param harness - The harness.
 * @returns The events.
 */
function deviceEvents(harness: DeviceHarness): HubDeviceEvent[] {
  return harness.ctx.emit.mock.calls.flatMap(([name, payload]) =>
    name === "hub:device" && "kind" in payload ? [payload] : []
  );
}

/**
 * A device harness with the engine published (as onStart does).
 *
 * @param overrides - Config fields to change.
 * @returns The harness.
 */
async function deviceMode(
  overrides: Parameters<typeof createDeviceHarness>[0] = {}
): Promise<DeviceHarness> {
  const harness = await createDeviceHarness(overrides);
  publishEngine(harness.ctx);
  harness.ctx.log.debug.mockClear();
  return harness;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("pairing: who is asked", () => {
  it('pairs an adb phone at once under pairing: "lan", without asking', async () => {
    const harness = await deviceMode();
    const socket = harness.device({ link: "adb", address: "127.0.0.1" });

    harness.send(socket, pairOf());

    expect(harness.confirm).not.toHaveBeenCalled();
    const paired = paramsOf(socket.notes("editor", "paired")[0]);
    expect(paired).toEqual({
      device: expect.stringMatching(/^d-[\da-f]{4}$/),
      token: expect.any(String),
      engine: ENGINE.id
    });
    expect(String(paired?.token)).toHaveLength(43);
    const [record] = harness.ctx.state.devices.values();
    expect(record).toMatchObject({
      id: paired?.device,
      model: "SM-A266B",
      link: "adb",
      engine: "0.14.12+9c41e0",
      build: "debug-1",
      pairedAt: NOW,
      conn: socket.data.conn
    });
    expect(deviceEvents(harness)).toEqual([
      {
        kind: "connected",
        device: {
          id: paired?.device,
          model: "SM-A266B",
          link: "adb",
          address: "127.0.0.1",
          port: 47_600,
          engine: "0.14.12+9c41e0",
          build: "debug-1",
          pairedAt: NOW,
          online: true,
          // eslint-disable-next-line unicorn/no-null -- null is "no pong yet" on LinkedDevice.latencyMs
          latencyMs: null
        }
      }
    ]);
    expect(harness.ctx.log.info).toHaveBeenCalledWith("hub:paired", {
      id: paired?.device,
      model: "SM-A266B",
      link: "adb"
    });
  });

  it('asks about an adb phone too under pairing: "always"', async () => {
    const harness = await deviceMode({ pairing: "always" });
    const socket = harness.device({ link: "adb", address: "127.0.0.1" });

    harness.send(socket, pairOf());

    expect(harness.asked).toHaveLength(1);
    expect(socket.notes("editor", "paired")).toEqual([]);
  });

  it("asks about a LAN phone with the normalized model, the address, the link and the code, and pairs on true", async () => {
    const harness = await deviceMode();
    const socket = harness.device({ link: "lan", address: PHONE });

    harness.send(socket, pairOf("0421"));

    expect(harness.asked.map(question => question.request)).toEqual([
      {
        code: "0421",
        model: "SM-A266B",
        address: PHONE,
        link: "lan",
        engine: "0.14.12+9c41e0",
        build: "debug-1"
      }
    ]);
    expect(socket.notes("editor", "paired")).toEqual([]);
    harness.asked[0]?.answer.resolve(true);
    await flush();
    expect(socket.notes("editor", "paired")).toHaveLength(1);
    expect(harness.ctx.state.devices.size).toBe(1);
  });

  it("asks one question at a time, in arrival order", async () => {
    const harness = await deviceMode();
    const first = harness.device({ link: "lan", address: PHONE });
    const second = harness.device({ link: "lan", address: "192.168.1.24" });

    harness.send(first, pairOf("1111"));
    harness.send(second, pairOf("2222"));
    expect(harness.asked.map(question => question.request.code)).toEqual(["1111"]);

    harness.asked[0]?.answer.resolve(false);
    await flush();
    expect(harness.asked.map(question => question.request.code)).toEqual(["1111", "2222"]);
  });
});

describe("pairing: refusals", () => {
  it("closes 1008 pairing refused on false and starts the 10 s cooldown", async () => {
    const harness = await deviceMode();
    const socket = harness.device({ link: "lan", address: PHONE });
    harness.send(socket, pairOf());

    harness.asked[0]?.answer.resolve(false);
    await flush();

    expect(socket.closes).toEqual([{ code: 1008, reason: "pairing refused" }]);
    expect(harness.ctx.state.pairing.cooldown.get(PHONE)).toBe(NOW + PAIR_COOLDOWN_MS);
    expect(harness.ctx.log.info).toHaveBeenCalledWith("hub:pair-refused", {
      address: PHONE,
      model: "SM-A266B"
    });
    expect(harness.ctx.state.devices.size).toBe(0);
  });

  it("counts a throwing or rejecting callback as a refusal, logged hub:pair-failed", async () => {
    const harness = await deviceMode();
    harness.confirm.mockImplementationOnce(() => {
      throw new Error("terminal closed");
    });
    harness.confirm.mockImplementationOnce(() => Promise.reject(new Error("ask failed")));
    const throwing = harness.device({ link: "lan", address: PHONE });
    const rejecting = harness.device({ link: "lan", address: "192.168.1.24" });

    harness.send(throwing, pairOf());
    harness.send(rejecting, pairOf());
    await flush();

    expect(throwing.closes).toEqual([{ code: 1008, reason: "pairing refused" }]);
    expect(rejecting.closes).toEqual([{ code: 1008, reason: "pairing refused" }]);
    expect(harness.ctx.log.warn.mock.calls).toEqual([
      ["hub:pair-failed", { error: "Error: terminal closed" }],
      ["hub:pair-failed", { error: "Error: ask failed" }]
    ]);
    expect(harness.ctx.state.pairing.cooldown.has("192.168.1.24")).toBe(true);
  });

  it("closes 1008 pairing timed out after pairTimeoutMs, aborts the question and starts the cooldown", async () => {
    const harness = await deviceMode({ pairTimeoutMs: 5000 });
    const socket = harness.device({ link: "lan", address: PHONE });
    harness.send(socket, pairOf());

    vi.advanceTimersByTime(4999);
    expect(socket.closes).toEqual([]);
    vi.advanceTimersByTime(1);

    expect(socket.closes).toEqual([{ code: 1008, reason: "pairing timed out" }]);
    expect(harness.asked[0]?.signal.aborted).toBe(true);
    expect(harness.ctx.state.pairing.cooldown.get(PHONE)).toBe(NOW + 5000 + PAIR_COOLDOWN_MS);
    harness.asked[0]?.answer.resolve(true);
    await flush();
    expect(socket.notes("editor", "paired")).toEqual([]);
  });

  it("aborts the question of a socket that closes while asked; its late true pairs nothing and the next is asked", async () => {
    const harness = await deviceMode();
    const leaving = harness.device({ link: "lan", address: PHONE });
    const waiting = harness.device({ link: "lan", address: "192.168.1.24" });
    harness.send(leaving, pairOf("1111"));
    harness.send(waiting, pairOf("2222"));

    harness.close(leaving);
    expect(harness.asked[0]?.signal.aborted).toBe(true);
    expect(harness.asked.map(question => question.request.code)).toEqual(["1111", "2222"]);

    harness.asked[0]?.answer.resolve(true);
    await flush();
    expect(harness.ctx.state.devices.size).toBe(0);
    expect(deviceEvents(harness)).toEqual([]);
    expect(harness.ctx.state.pairing.cooldown.size).toBe(0);
    expect(harness.ctx.log.warn).not.toHaveBeenCalled();
  });

  it("logs no pair-failed for a question that rejects because it was aborted", async () => {
    const harness = await deviceMode();
    const socket = harness.device({ link: "lan", address: PHONE });
    harness.send(socket, pairOf());

    harness.close(socket);
    harness.asked[0]?.answer.reject(new DOMException("The question was aborted", "AbortError"));
    await flush();

    expect(harness.ctx.log.warn).not.toHaveBeenCalled();
    expect(harness.ctx.state.pairing.cooldown.size).toBe(0);
  });

  it("drops a queued pairing whose socket closes before it is asked", async () => {
    const harness = await deviceMode();
    const asked = harness.device({ link: "lan", address: PHONE });
    const queued = harness.device({ link: "lan", address: "192.168.1.24" });
    harness.send(asked, pairOf("1111"));
    harness.send(queued, pairOf("2222"));

    harness.close(queued);
    harness.asked[0]?.answer.resolve(false);
    await flush();

    expect(harness.asked.map(question => question.request.code)).toEqual(["1111"]);
    vi.advanceTimersByTime(60_000);
    expect(queued.closes).toEqual([]);
  });

  it("refuses the fifth waiting pairing with pairing busy", async () => {
    const harness = await deviceMode();
    const sockets = [21, 22, 23, 24, 25].map(last =>
      harness.device({ link: "lan", address: `192.168.1.${last}` })
    );

    for (const socket of sockets) harness.send(socket, pairOf());

    expect(sockets.map(socket => socket.closes[0]?.reason)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      "pairing busy"
    ]);
    expect(sockets[4]?.closes).toEqual([{ code: 1008, reason: "pairing busy" }]);
  });

  it("refuses the seventeenth device with pairing busy", async () => {
    const harness = await deviceMode();
    for (let index = 0; index < 16; index += 1) pairAdb(harness);

    const seventeenth = harness.device({ link: "adb", address: "127.0.0.1" });
    harness.send(seventeenth, pairOf());

    expect(harness.ctx.state.devices.size).toBe(16);
    expect(seventeenth.closes).toEqual([{ code: 1008, reason: "pairing busy" }]);
  });
});

describe("pairing: the first message", () => {
  it("closes 1008 pair first on any first message but pair", async () => {
    const harness = await deviceMode();
    const hello = harness.device({ link: "adb", address: "127.0.0.1" });
    const request = harness.device({ link: "adb", address: "127.0.0.1" });
    const gameChannel = harness.device({ link: "adb", address: "127.0.0.1" });

    harness.send(hello, helloOf());
    harness.send(request, {
      jsonrpc: "2.0",
      id: 1,
      channel: "editor",
      method: "pair",
      params: { code: "4821", device: {} }
    });
    harness.send(gameChannel, notification("game", "pair", { code: "4821", device: {} }));

    for (const socket of [hello, request, gameChannel]) {
      expect(socket.closes).toEqual([{ code: 1008, reason: "pair first" }]);
    }
    expect(harness.ctx.state.sessions.size).toBe(0);
  });

  it("counts a code of three or five digits as a strike and pairs nothing (bug: a code the terminal cannot ask for)", async () => {
    const harness = await deviceMode();
    const socket = harness.device({ link: "adb", address: "127.0.0.1" });

    harness.send(socket, pairOf("482"));
    harness.send(socket, pairOf("48211"));

    expect(harness.agentConn(socket).invalid).toBe(2);
    expect(socket.closes).toEqual([]);
    expect(socket.notes("editor", "paired")).toEqual([]);
    expect(harness.ctx.state.devices.size).toBe(0);
  });

  it("counts a second pair while the first waits as a strike, and asks once", async () => {
    const harness = await deviceMode();
    const socket = harness.device({ link: "lan", address: PHONE });

    harness.send(socket, pairOf("1111"));
    harness.send(socket, pairOf("2222"));

    expect(harness.agentConn(socket).invalid).toBe(1);
    expect(harness.asked).toHaveLength(1);
  });
});

describe("paired connections", () => {
  it("a token reconnect keeps the id, closes the older connection replaced, and emits closed (replaced) then connected", async () => {
    const harness = await deviceMode();
    const { socket: older, id } = pairAdb(harness);
    harness.ctx.emit.mockClear();

    const newer = harness.device({ link: "lan", address: PHONE, id });

    expect(older.closes).toEqual([{ code: 1001, reason: "replaced" }]);
    expect(
      deviceEvents(harness).map(event => [event.kind, "reason" in event ? event.reason : undefined])
    ).toEqual([
      ["closed", "replaced"],
      ["connected", undefined]
    ]);
    const record = harness.ctx.state.devices.get(id);
    expect(record).toMatchObject({ id, conn: newer.data.conn, address: PHONE, link: "lan" });
    // The closed event describes the replaced connection, taken before the record moved on.
    const [closed, connected] = deviceEvents(harness);
    expect(closed?.kind === "closed" ? closed.device : undefined).toMatchObject({
      address: "127.0.0.1",
      link: "adb",
      online: false
    });
    expect(connected?.kind === "connected" ? connected.device : undefined).toMatchObject({
      address: PHONE,
      link: "lan",
      online: true
    });

    harness.close(older);
    expect(deviceEvents(harness)).toHaveLength(2);
    expect(record?.conn).toBe(newer.data.conn);
  });

  it("keeps a device's log indices across a reconnect: the resent lines are skipped", async () => {
    const harness = await deviceMode();
    const { socket: first, id } = pairAdb(harness);
    const line = { v: 1, kind: "mark" };
    harness.send(
      first,
      notification("editor", "perf.lines", { log: "a.jsonl", from: 0, lines: [line, line, line] })
    );
    harness.close(first);

    const second = harness.device({ link: "adb", address: "127.0.0.1", id });
    harness.ctx.emit.mockClear();
    harness.send(
      second,
      notification("editor", "perf.lines", {
        log: "a.jsonl",
        from: 0,
        lines: [line, line, line, line]
      })
    );

    expect(paramsOf(second.notes("editor", "perf.ack")[0])).toEqual({
      log: "a.jsonl",
      next: 4,
      n: 4
    });
    const [event] = deviceEvents(harness);
    expect(event?.kind === "lines" ? [event.lines.from, event.lines.items.length] : []).toEqual([
      3, 1
    ]);
  });

  it("announces closed lost when a paired phone drops, closed bye after a bye, and nothing for a pairing socket", async () => {
    const harness = await deviceMode();
    const { socket: lost, id: lostId } = pairAdb(harness);
    const { socket: leaving, id: byeId } = pairAdb(harness);
    const pairing = harness.device({ link: "lan", address: PHONE });
    harness.send(leaving, helloOf());
    harness.send(leaving, notification("game", "bye"));
    harness.ctx.emit.mockClear();

    harness.close(lost);
    harness.close(leaving);
    harness.close(pairing);

    const closed = deviceEvents(harness).map(event =>
      event.kind === "closed" ? [event.device.id, event.reason, event.device.online] : [event.kind]
    );
    expect(closed).toEqual([
      [lostId, "lost", false],
      [byeId, "bye", false]
    ]);
    expect(harness.ctx.state.devices.size).toBe(2);
  });

  it("refreshes the engine through files when a phone pairs or reconnects", async () => {
    const harness = await deviceMode();
    const { socket, id } = pairAdb(harness);
    harness.close(socket);
    harness.device({ link: "adb", address: "127.0.0.1", id });
    await flush();

    expect(harness.ctx.files.refreshEngine).toHaveBeenCalledTimes(2);
  });

  it("closes a token upgrade 4401 when its record was forgotten since the upgrade", async () => {
    const harness = await deviceMode();
    const socket = harness.device({ link: "adb", address: "127.0.0.1", id: "d-0000" });

    expect(socket.closes).toEqual([{ code: 4401, reason: "unpaired" }]);
    expect(deviceEvents(harness)).toEqual([]);
  });

  it("never logs a device token", async () => {
    const harness = await deviceMode();
    const lan = harness.device({ link: "lan", address: PHONE });
    harness.send(lan, pairOf());
    harness.asked[0]?.answer.resolve(true);
    await flush();
    const token = String(paramsOf(lan.notes("editor", "paired")[0])?.token);
    const { socket, id, token: adbToken } = pairAdb(harness);
    harness.close(socket);
    harness.device({ link: "adb", address: "127.0.0.1", id });

    const { log } = harness.ctx;
    const logged = JSON.stringify([
      log.info.mock.calls,
      log.debug.mock.calls,
      log.warn.mock.calls,
      log.error.mock.calls
    ]);
    expect(token).toHaveLength(43);
    expect(logged).not.toContain(token);
    expect(logged).not.toContain(adbToken);
  });
});

describe("devices() and the hub:device emit", () => {
  it("lists the paired devices by pairedAt as fresh frozen copies without the token (bug: the token reaching a reader of devices())", async () => {
    const harness = await deviceMode();
    const api = createHubApi(harness.ctx);
    const first = pairAdb(harness);
    vi.setSystemTime(NOW + 5000);
    const second = pairAdb(harness);
    harness.close(first.socket);

    const devices = api.devices();

    expect(devices.map(device => [device.id, device.pairedAt, device.online])).toEqual([
      [first.id, NOW, false],
      [second.id, NOW + 5000, true]
    ]);
    expect(Object.isFrozen(devices[0])).toBe(true);
    expect(JSON.stringify(devices)).not.toContain(first.token);
    expect(devices[0]).not.toHaveProperty("token");
    expect(api.devices()[0]).not.toBe(devices[0]);
  });

  it("logs a failing hub:device hook as hub:emit-failed and still pairs (bug: a hook throwing into the socket handler)", async () => {
    const harness = await deviceMode();
    harness.ctx.emit.mockImplementation(() => {
      throw new Error("hook failed");
    });
    const socket = harness.device({ link: "adb", address: "127.0.0.1" });

    harness.send(socket, pairOf());

    expect(socket.notes("editor", "paired")).toHaveLength(1);
    expect(harness.ctx.log.error).toHaveBeenCalledWith("hub:emit-failed", {
      event: "hub:device",
      kind: "connected",
      error: "Error: hook failed"
    });
  });
});

describe("review fixes: clean pairing text, the first-message deadline, forget", () => {
  it("counts a pair with a bidi override in its model as a strike: nobody is asked, nothing is logged", async () => {
    const harness = await deviceMode();
    const socket = harness.device({ link: "lan", address: PHONE });

    harness.send(socket, pairOf("4821", { model: "Pixel\u202E8" }));

    expect(harness.agentConn(socket).invalid).toBe(1);
    expect(harness.asked).toEqual([]);
  });

  it("closes an idle pairing socket 1008 pair first after the deadline (bug: a LAN socket held open forever)", async () => {
    const harness = await deviceMode();
    const socket = harness.device({ link: "lan", address: PHONE });

    vi.advanceTimersByTime(PAIR_FIRST_MS - 1);
    expect(socket.closes).toEqual([]);
    vi.advanceTimersByTime(1);

    expect(PAIR_FIRST_MS).toBe(5000);
    expect(socket.closes).toEqual([{ code: 1008, reason: "pair first" }]);
  });

  it("keeps the deadline after a malformed pair, and clears it on a valid one", async () => {
    const harness = await deviceMode();
    const malformed = harness.device({ link: "lan", address: PHONE });
    const waiting = harness.device({ link: "lan", address: "192.168.1.24" });

    harness.send(malformed, pairOf("48"));
    harness.send(waiting, pairOf());
    vi.advanceTimersByTime(PAIR_FIRST_MS);

    expect(malformed.closes).toEqual([{ code: 1008, reason: "pair first" }]);
    expect(waiting.closes).toEqual([]);
  });

  it("clears the deadline of a socket that closes, and never closes a token reconnect or an adb pairing", async () => {
    const harness = await deviceMode();
    const leaving = harness.device({ link: "lan", address: PHONE });
    const { socket: paired, id } = pairAdb(harness);
    harness.close(paired);
    const back = harness.device({ link: "adb", address: "127.0.0.1", id });

    harness.close(leaving);
    vi.advanceTimersByTime(PAIR_FIRST_MS);

    expect(leaving.closes).toEqual([]);
    expect(paired.closes).toEqual([]);
    expect(back.closes).toEqual([]);
  });

  it("forget leaves the queue alone for a ticket that is in neither slot (bug: splice(-1) drops the last waiting phone)", async () => {
    const harness = await deviceMode();
    for (const last of [21, 22, 23])
      harness.send(harness.device({ link: "lan", address: `192.168.1.${last}` }), pairOf());
    const { queue, asking } = harness.ctx.state.pairing;
    const before = [...queue];
    const request = harness.asked[0]?.request;
    if (request === undefined) throw new Error("nobody asked");
    const stray = {
      conn: 999,
      request,
      abort: new AbortController(),
      timer: setTimeout(() => undefined, 1)
    };

    forget(harness.ctx.state, stray);

    expect(queue).toHaveLength(2);
    expect(harness.ctx.state.pairing.queue).toEqual(before);
    expect(harness.ctx.state.pairing.asking).toBe(asking);
  });
});

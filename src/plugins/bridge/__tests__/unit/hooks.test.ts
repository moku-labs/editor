import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildBridgeApi } from "../../api";
import { connect } from "../../connection/loop";
import { buildBridgeHooks } from "../../handlers";
import { PAIRING_STORE_KEY } from "../../types";
import { deviceDeps, flush, LAN, LOG, openDeps, socketOf } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The hooks: overlay:connect (the same as connect(address)) and
// recorder:status (ship what is pending), and the api's connect.
// ─────────────────────────────────────────────────────────────────────────────

/** The office computer. */
const OFFICE = "10.0.0.7:47600";

/** A recorder status payload (the bridge reads none of its numbers). */
const STATUS = { state: "recording", lines: 3, bytes: 300, sent: 0, pending: 3 } as const;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("overlay:connect", () => {
  it("warns about a bad address and leaves the socket alone", () => {
    const { deps, socket } = openDeps();

    buildBridgeHooks(deps)["overlay:connect"]({ address: "nope" });

    expect(deps.log.warn).toHaveBeenCalledWith("bridge:bad-address", { address: "nope" });
    expect(socket.closes).toEqual([]);
    expect(deps.state.mode).toBe("page");
    expect(deps.net.sockets).toEqual([]);
  });

  it("switches to the address: closes 1000 switch, dials it now and remembers it", async () => {
    const { deps, socket } = openDeps();
    deps.state.attempt = 3;

    buildBridgeHooks(deps)["overlay:connect"]({ address: ` ${OFFICE} ` });
    await flush();

    expect(socket.closes).toEqual([{ code: 1000, reason: "switch" }]);
    expect(deps.state.mode).toBe("device");
    expect(deps.state.attempt).toBe(0);
    expect(deps.net.fetches).toEqual([]);
    expect(deps.net.sockets.map(opened => opened.url)).toEqual([
      "ws://10.0.0.7:47600/__editor/ws?kind=agent&role=device"
    ]);
    expect(JSON.parse(deps.linkStorage.items.get(PAIRING_STORE_KEY) ?? "{}").last).toBe(OFFICE);
  });

  it("does not dial the address that is already live", async () => {
    const deps = deviceDeps();
    deps.state.remembered.links[LAN] = { device: "d-7f3a", token: "t" };
    await connect(deps);
    socketOf(deps).open();

    buildBridgeHooks(deps)["overlay:connect"]({ address: LAN });
    await flush();

    expect(socketOf(deps).closes).toEqual([]);
    expect(deps.net.sockets).toHaveLength(1);
  });
});

describe("connect(address)", () => {
  it("throws a two-line TypeError for a bad address and changes nothing", () => {
    const deps = deviceDeps();

    expect(() => buildBridgeApi(deps).connect("my-pc.local")).toThrow(
      new TypeError(
        '[moku-editor] bridge.connect needs host:port, got "my-pc.local".\n  Pass an address like "192.168.1.5:47600".'
      )
    );
    expect(deps.state.address).toBe(LAN);
    expect(deps.linkStorage.items.size).toBe(0);
  });

  it("dials again after a refusal", async () => {
    const deps = deviceDeps();
    await connect(deps);
    socketOf(deps).open();
    socketOf(deps).emit("close", { code: 1008, reason: "pairing refused" });

    buildBridgeApi(deps).connect(LAN);
    await flush();

    expect(deps.net.sockets).toHaveLength(2);
  });
});

describe("recorder:status", () => {
  it("sends nothing when nothing is pending, and the pending lines when there are some", async () => {
    const deps = deviceDeps();
    deps.state.remembered.links[LAN] = { device: "d-7f3a", token: "t" };
    await connect(deps);
    const socket = socketOf(deps);
    socket.open();
    const hooks = buildBridgeHooks(deps);
    socket.clear();

    hooks["recorder:status"](STATUS);
    expect(socket.sent).toEqual([]);

    deps.recorder.add(LOG, 3);
    hooks["recorder:status"](STATUS);
    expect(socket.messages()).toMatchObject([{ method: "perf.lines", params: { from: 0 } }]);
  });
});

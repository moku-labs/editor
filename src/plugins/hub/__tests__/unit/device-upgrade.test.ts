/* eslint-disable unicorn/no-null, sonarjs/no-hardcoded-ip -- null is "not reported" on a device record; LAN addresses are the cases under test */
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_PAIRING_SOCKETS } from "../../device/pairing";
import { handleDeviceUpgrade } from "../../device/upgrade";
import { validateHubConfig } from "../../init";
import type { DeviceLinkKind } from "../../protocol";
import { sameToken } from "../../security/token";
import type { DeviceRecord, HubServer } from "../../types";
import type { FakeServer, TestCtx } from "../helpers";
import { createCtx, createHarness, fakeServer, fakeSocket, TOKEN } from "../helpers";

vi.mock("../../security/token", async importOriginal => {
  const actual = await importOriginal<typeof import("../../security/token")>();
  return { ...actual, sameToken: vi.fn(actual.sameToken) };
});

// ─────────────────────────────────────────────────────────────────────────────
// The device upgrade (C3), row by row on both listeners. P is the device port;
// the LAN listener answers on 192.168.1.5:P. Unless a row says otherwise the
// request is a pairing upgrade: kind=agent role=device, the listener's Host,
// Origin tauri://localhost, no credentials.
// ─────────────────────────────────────────────────────────────────────────────

const P = 47_600;
const LAN = `192.168.1.5:${P}`;
const PHONE = "192.168.1.23";
const DEVICE_TOKEN = "d".repeat(43);

/** Options of one device upgrade request. */
type Ask = {
  path?: string;
  method?: string;
  query?: Record<string, string | undefined>;
  headers?: Record<string, string | undefined>;
};

/**
 * Builds a device upgrade request for a listener; every field defaults to a pairing upgrade.
 *
 * @param link - Which listener.
 * @param ask - What to change.
 * @returns The request.
 */
function deviceRequest(link: DeviceLinkKind, ask: Ask = {}): Request {
  const host = link === "adb" ? `127.0.0.1:${P}` : LAN;
  const url = new URL(`http://${host}${ask.path ?? "/__editor/ws"}`);
  const query: Record<string, string | undefined> = { kind: "agent", role: "device", ...ask.query };
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  const merged: Record<string, string | undefined> = {
    host,
    origin: "tauri://localhost",
    upgrade: "websocket",
    connection: "Upgrade",
    ...ask.headers
  };
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(merged)) if (value !== undefined) headers[key] = value;
  return new Request(url, { method: ask.method ?? "GET", headers });
}

/** A device listener whose peer address Bun reports. */
type DeviceServer = FakeServer & Required<Pick<HubServer, "requestIP">>;

/**
 * A started ctx (token set, config validated) with device mode on, and a listener.
 *
 * @param upgraded - What server.upgrade returns.
 * @returns The ctx and the listener.
 */
function started(upgraded = true): { ctx: TestCtx; server: DeviceServer } {
  const ctx = createCtx();
  validateHubConfig(ctx);
  ctx.state.token = TOKEN;
  ctx.state.deviceListen = { port: P, adb: `127.0.0.1:${P}`, lan: LAN };
  const server: DeviceServer = {
    ...fakeServer(P, upgraded),
    requestIP: () => ({ address: PHONE })
  };
  return { ctx, server };
}

/**
 * A paired device record of this run.
 *
 * @param id - The device id.
 * @returns The record.
 */
function recordOf(id: string): DeviceRecord {
  return {
    id,
    token: DEVICE_TOKEN,
    model: "SM-A266B",
    link: "adb",
    address: "127.0.0.1",
    engine: null,
    build: null,
    pairedAt: 1,
    conn: undefined,
    logs: new Map(),
    latencyMs: null
  };
}

/**
 * The status of a device upgrade attempt (101 when upgraded) on a fresh started ctx.
 *
 * @param link - Which listener.
 * @param ask - The request options.
 * @param upgraded - What server.upgrade returns.
 * @returns The status.
 */
function statusOf(link: DeviceLinkKind, ask: Ask = {}, upgraded = true): number {
  const { ctx, server } = started(upgraded);
  return handleDeviceUpgrade(ctx, deviceRequest(link, ask), server, link)?.status ?? 101;
}

afterEach(() => {
  vi.mocked(sameToken).mockClear();
});

describe("handleDeviceUpgrade, rows 1–3 and 9 on both listeners", () => {
  for (const link of ["adb", "lan"] as const) {
    it(`${link}: 404 off the socket path, 426 without an upgrade, 400 when Bun refuses`, () => {
      expect(statusOf(link, { path: "/__editor/hello" })).toBe(404);
      expect(statusOf(link, { headers: { upgrade: undefined } })).toBe(426);
      expect(statusOf(link, { method: "POST" })).toBe(426);
      expect(statusOf(link, {}, false)).toBe(400);
    });
  }

  it("answers 503 while device mode is off and before start", () => {
    const { ctx, server } = started();
    ctx.state.deviceListen = undefined;
    expect(handleDeviceUpgrade(ctx, deviceRequest("adb"), server, "adb")?.status).toBe(503);

    const notStarted = createCtx();
    expect(handleDeviceUpgrade(notStarted, deviceRequest("adb"), server, "adb")?.status).toBe(503);
  });
});

describe("handleDeviceUpgrade, row 4: the listener rule", () => {
  it("runs the normal checks for a tools socket on the adb listener (the tools page is served there)", () => {
    const tools = { kind: "tools", role: undefined, token: TOKEN };
    const loopbackOrigin = { origin: `http://127.0.0.1:${P}` };

    expect(statusOf("adb", { query: tools, headers: loopbackOrigin })).toBe(101);
    expect(
      statusOf("adb", { query: { ...tools, token: "x".repeat(43) }, headers: loopbackOrigin })
    ).toBe(401);
    expect(statusOf("adb", { query: tools })).toBe(403);
  });

  it("refuses a tools socket on the LAN listener, hub token or not (bug: the tools socket reachable from the LAN)", () => {
    const { ctx, server } = started();
    const ask = {
      query: { kind: "tools", role: undefined, token: TOKEN },
      headers: { origin: `http://${LAN}` }
    };

    expect(handleDeviceUpgrade(ctx, deviceRequest("lan", ask), server, "lan")?.status).toBe(403);
    expect(ctx.log.warn).toHaveBeenCalledWith(
      "hub:refused",
      expect.objectContaining({ status: 403, check: "listener" })
    );
    expect(server.upgrade).not.toHaveBeenCalled();
  });
});

describe("handleDeviceUpgrade, rows 5–7: role, Host, Origin", () => {
  for (const link of ["adb", "lan"] as const) {
    it(`${link}: a plain kind=agent is 400 (no game page is served here), an unknown kind 400`, () => {
      expect(statusOf(link, { query: { role: undefined } })).toBe(400);
      expect(statusOf(link, { query: { role: "page" } })).toBe(400);
      expect(statusOf(link, { query: { kind: "admin" } })).toBe(400);
    });

    it(`${link}: Origin null, a missing or a web Origin is 403; the Origin's case does not matter`, () => {
      expect(statusOf(link, { headers: { origin: "null" } })).toBe(403);
      expect(statusOf(link, { headers: { origin: undefined } })).toBe(403);
      expect(statusOf(link, { headers: { origin: `http://127.0.0.1:${P}` } })).toBe(403);
      expect(statusOf(link, { headers: { origin: "https://evil.com" } })).toBe(403);
      expect(statusOf(link, { headers: { origin: "TAURI://LOCALHOST" } })).toBe(101);
      expect(statusOf(link, { headers: { origin: "http://tauri.localhost" } })).toBe(101);
    });
  }

  it("adb: answers to the loopback Host of its port only", () => {
    expect(statusOf("adb", { headers: { host: `localhost:${P}` } })).toBe(101);
    expect(statusOf("adb", { headers: { host: LAN } })).toBe(403);
    expect(statusOf("adb", { headers: { host: "127.0.0.1:3000" } })).toBe(403);
    expect(statusOf("adb", { headers: { host: undefined } })).toBe(403);
  });

  it("lan: the Host of the adb port is 403 (DNS rebinding); only <lan address>:<port> passes", () => {
    expect(statusOf("lan", { headers: { host: `127.0.0.1:${P}` } })).toBe(403);
    expect(statusOf("lan", { headers: { host: `localhost:${P}` } })).toBe(403);
    expect(statusOf("lan", { headers: { host: "evil.example:47600" } })).toBe(403);
    expect(statusOf("lan", { headers: { host: LAN.toUpperCase() } })).toBe(101);
  });

  it("refuses a Host on a listener without a port", () => {
    const { ctx } = started();
    const portless = { ...fakeServer(P), port: undefined };
    expect(handleDeviceUpgrade(ctx, deviceRequest("adb"), portless, "adb")?.status).toBe(403);
  });
});

describe("handleDeviceUpgrade, row 8: credentials", () => {
  it("upgrades a pairing socket with the link and the peer address on its data", () => {
    for (const link of ["adb", "lan"] as const) {
      const { ctx, server } = started();
      const conn = ctx.state.nextConn;
      const req = deviceRequest(link);

      expect(handleDeviceUpgrade(ctx, req, server, link)).toBeUndefined();
      expect(server.upgrade).toHaveBeenCalledWith(req, {
        data: { kind: "agent", conn, device: { link, address: PHONE } }
      });
    }
  });

  it("names the peer unknown when Bun does not report its address", () => {
    const { ctx } = started();
    const server = fakeServer(P);

    handleDeviceUpgrade(ctx, deviceRequest("adb"), server, "adb");

    expect(server.upgrade.mock.calls[0]?.[1].data.device?.address).toBe("unknown");
  });

  it("pairs a token upgrade of this run by a timing-safe compare", () => {
    const { ctx, server } = started();
    ctx.state.devices.set("d-7f3a", recordOf("d-7f3a"));

    handleDeviceUpgrade(
      ctx,
      deviceRequest("adb", { query: { device: "d-7f3a", token: DEVICE_TOKEN } }),
      server,
      "adb"
    );

    expect(sameToken).toHaveBeenCalledWith(DEVICE_TOKEN, DEVICE_TOKEN);
    expect(server.upgrade.mock.calls[0]?.[1].data.device).toEqual({
      link: "adb",
      address: PHONE,
      id: "d-7f3a"
    });
  });

  it("upgrades a stale token as unpaired, never refuses it with 401 (bug: a phone that cannot tell unpaired from no computer)", () => {
    const { ctx, server } = started();
    ctx.state.devices.set("d-7f3a", recordOf("d-7f3a"));
    const wrong = { device: "d-7f3a", token: "w".repeat(43) };
    const unknown = { device: "d-0000", token: DEVICE_TOKEN };

    expect(
      handleDeviceUpgrade(ctx, deviceRequest("lan", { query: wrong }), server, "lan")
    ).toBeUndefined();
    expect(
      handleDeviceUpgrade(ctx, deviceRequest("lan", { query: unknown }), server, "lan")
    ).toBeUndefined();

    const devices = server.upgrade.mock.calls.map(call => call[1].data.device);
    expect(devices).toEqual([
      { link: "lan", address: PHONE, unpaired: true },
      { link: "lan", address: PHONE, unpaired: true }
    ]);
    expect(sameToken).toHaveBeenCalledWith("w".repeat(43), DEVICE_TOKEN);
  });

  it("refuses a device id without a token and a token without a device id with 400", () => {
    expect(statusOf("adb", { query: { device: "d-7f3a" } })).toBe(400);
    expect(statusOf("lan", { query: { token: DEVICE_TOKEN } })).toBe(400);
  });

  it("answers 429 to a pairing upgrade from an address that cools down, and lets it in once the cooldown ended", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    try {
      const { ctx, server } = started();
      ctx.state.pairing.cooldown.set(PHONE, 1_010_000);

      const busy = handleDeviceUpgrade(ctx, deviceRequest("lan"), server, "lan");
      expect(busy?.status).toBe(429);
      expect(ctx.log.warn).toHaveBeenCalledWith(
        "hub:refused",
        expect.objectContaining({ status: 429, check: "cooldown" })
      );

      vi.setSystemTime(1_010_000);
      expect(handleDeviceUpgrade(ctx, deviceRequest("lan"), server, "lan")).toBeUndefined();
      expect(ctx.state.pairing.cooldown.has(PHONE)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("logs each refusal once without the URL or a device token", () => {
    const { ctx, server } = started();
    handleDeviceUpgrade(
      ctx,
      deviceRequest("lan", { query: { token: DEVICE_TOKEN } }),
      server,
      "lan"
    );
    handleDeviceUpgrade(
      ctx,
      deviceRequest("lan", {
        headers: { origin: "null" },
        query: { device: "d-1", token: DEVICE_TOKEN }
      }),
      server,
      "lan"
    );

    expect(ctx.log.warn).toHaveBeenCalledTimes(2);
    const logged = JSON.stringify(ctx.log.warn.mock.calls);
    expect(logged).not.toContain(DEVICE_TOKEN);
    expect(logged).not.toContain("token=");
  });
});

describe("the 4401 close of a stale token at open", () => {
  it("closes it 4401 unpaired before any message, with no session, no hub:device and no strike", () => {
    const harness = createHarness();
    const socket = harness.device({ link: "lan", address: PHONE, unpaired: true });

    expect(socket.closes).toEqual([{ code: 4401, reason: "unpaired" }]);
    expect(harness.ctx.state.conns.has(socket.data.conn)).toBe(false);
    harness.handler.message(socket, "{nope");
    harness.close(socket);
    expect(harness.ctx.emit).not.toHaveBeenCalled();
    expect(harness.ctx.state.sessions.size).toBe(0);
    expect(harness.ctx.log.info.mock.calls).toEqual([
      ["hub:device-unpaired", { address: PHONE, link: "lan" }]
    ]);
  });
});

/**
 * Registers an open device connection from an address, paired or not.
 *
 * @param ctx - The ctx.
 * @param address - The peer address.
 * @param id - The device id of a paired connection.
 */
function openDeviceConn(ctx: TestCtx, address: string, id?: string): void {
  const conn = ctx.state.nextConn++;
  ctx.state.conns.set(conn, {
    kind: "agent",
    conn,
    socket: fakeSocket("agent", conn),
    session: undefined,
    bye: false,
    invalid: 0,
    device: { link: "lan", address, id, ended: false, deadline: undefined, pingAt: undefined }
  });
}

describe("review fixes: the per-address cap and the editor port", () => {
  it("answers 429 to a pairing upgrade over the per-address cap of open pairing sockets (bug: one LAN host holding unlimited sockets)", () => {
    const { ctx, server } = started();
    for (let index = 0; index < MAX_PAIRING_SOCKETS; index += 1) openDeviceConn(ctx, PHONE);
    openDeviceConn(ctx, PHONE, "d-7f3a");

    const refused = handleDeviceUpgrade(ctx, deviceRequest("lan"), server, "lan");

    expect(MAX_PAIRING_SOCKETS).toBe(4);
    expect(refused?.status).toBe(429);
    expect(ctx.log.warn).toHaveBeenCalledWith(
      "hub:refused",
      expect.objectContaining({ status: 429, check: "cooldown" })
    );
  });

  it("counts only the open pairing sockets of the same address, and never caps a token reconnect", () => {
    const { ctx, server } = started();
    for (let index = 0; index < MAX_PAIRING_SOCKETS - 1; index += 1) openDeviceConn(ctx, PHONE);
    openDeviceConn(ctx, PHONE, "d-7f3a");
    for (let index = 0; index < MAX_PAIRING_SOCKETS; index += 1)
      openDeviceConn(ctx, "192.168.1.99");

    expect(handleDeviceUpgrade(ctx, deviceRequest("lan"), server, "lan")).toBeUndefined();

    for (let index = 0; index < 2; index += 1) openDeviceConn(ctx, PHONE);
    const reconnect = deviceRequest("lan", { query: { device: "d-0000", token: DEVICE_TOKEN } });
    expect(handleDeviceUpgrade(ctx, reconnect, server, "lan")).toBeUndefined();
  });

  it("keeps the editor port of the normal listener only: a tools socket on the adb listener changes nothing", () => {
    const { ctx, server } = started();
    const tools = { kind: "tools", role: undefined, token: TOKEN };

    const upgraded = handleDeviceUpgrade(
      ctx,
      deviceRequest("adb", { query: tools, headers: { origin: `http://127.0.0.1:${P}` } }),
      server,
      "adb"
    );

    expect(upgraded).toBeUndefined();
    expect(server.upgrade).toHaveBeenCalledTimes(1);
    expect(ctx.state.editorPort).toBeUndefined();
  });
});

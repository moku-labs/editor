/* eslint-disable unicorn/no-null -- null is "no listener" on the wire */
/* eslint-disable sonarjs/no-hardcoded-ip -- the LAN addresses of the fixture phones */
import { describe, expect, it } from "vitest";
import type { Json } from "../../../registry/protocol";
import { initConnect } from "../../init";
import { readDirectory } from "../../protocol";
import { scanOnce } from "../../wire/scan";
import type { TestCtx } from "../helpers";
import { a26Device, createCtx, deviceSession, fakeRunner, LISTEN, MISSING } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// spec 11 C1, C2: the editor methods connect registers on the hub, device mode
// on request and its ownership, the watch rules.
// ─────────────────────────────────────────────────────────────────────────────

/** The tools connection that calls. */
const CALLER = { conn: 3 };

/**
 * Calls a registered editor method.
 *
 * @param ctx - The test ctx (initConnect ran).
 * @param name - The method name.
 * @param params - Its params.
 * @returns The answer.
 */
async function call(ctx: TestCtx, name: string, params?: Json): Promise<Json> {
  const method = ctx.hub.methods.get(name);
  if (method === undefined) throw new Error(`${name} is not registered`);
  return method(params, CALLER);
}

/**
 * A ctx with the methods registered.
 *
 * @param options - Options of createCtx.
 * @returns The ctx.
 */
function ready(options: Parameters<typeof createCtx>[0] = {}): TestCtx {
  const ctx = createCtx(options);
  initConnect(ctx);
  return ctx;
}

describe("connect.wire", () => {
  it("turns device mode on once and marks it connect's; a second call answers the listen", async () => {
    const ctx = ready();
    const [first, second] = await Promise.all([
      call(ctx, "connect.wire"),
      call(ctx, "connect.wire")
    ]);
    expect(first).toEqual({ listen: { port: 47_600, adb: "127.0.0.1:47600", lan: null } });
    expect(second).toEqual(first);
    await call(ctx, "connect.wire");
    expect(ctx.hub.listenDevices).toHaveBeenCalledTimes(1);
    expect(ctx.state.mode).toEqual({ on: true, owner: "connect", listen: LISTEN });
    expect(typeof ctx.hub.confirm).toBe("function");
  });

  it("answers a taken port as port_in_use with the two-line message, and stays off", async () => {
    const ctx = ready();
    ctx.hub.listenDevices.mockRejectedValueOnce(
      Object.assign(
        new Error(
          "[moku-editor] port 47600 is in use.\n  Is another moku-editor perf running? Try --port 47601."
        ),
        { code: "EADDRINUSE" }
      )
    );
    await expect(call(ctx, "connect.wire")).rejects.toMatchObject({
      code: -32_000,
      message:
        "[moku-editor] port 47600 is in use.\n  Is moku-editor perf running? Stop it, or connect from its tools page.",
      data: { reason: "port_in_use", retryable: false }
    });
    expect(ctx.state.mode).toEqual({ on: false, owner: null, listen: null });
  });

  it("answers the listen of a device mode moku-editor perf turned on, calling nothing", async () => {
    const ctx = ready();
    ctx.hub.emit({ kind: "listening", listen: LISTEN });
    await expect(call(ctx, "connect.wire")).resolves.toEqual({ listen: { ...LISTEN } });
    expect(ctx.hub.listenDevices).not.toHaveBeenCalled();
    expect(ctx.state.mode.owner).toBe("other");
  });
});

describe("connect.network", () => {
  it("turns device mode on, then the LAN listener", async () => {
    const ctx = ready();
    await expect(call(ctx, "connect.network")).resolves.toEqual({
      listen: { port: 47_600, adb: "127.0.0.1:47600", lan: "192.168.1.5:47600" }
    });
    expect(ctx.hub.listenDevices.mock.invocationCallOrder[0]).toBeLessThan(
      ctx.hub.listenLan.mock.invocationCallOrder[0] ?? 0
    );
  });

  it("answers no LAN address with the hub's message", async () => {
    const ctx = ready();
    const message =
      "[moku-editor] hub: --lan found no LAN address on this computer.\n  Connect to a Wi-Fi or set pluginConfigs.hub.lanAddress.";
    ctx.hub.listenLan.mockRejectedValueOnce(new Error(message));
    await expect(call(ctx, "connect.network")).rejects.toMatchObject({
      code: -32_000,
      message,
      data: { reason: "no_lan", retryable: false }
    });
  });
});

describe("connect.off", () => {
  it("refuses not_owner while device mode is moku-editor perf's, and device mode stays on", async () => {
    // Bug: the tools page stopping a perf run's phones.
    const ctx = ready();
    ctx.hub.emit({ kind: "listening", listen: LISTEN });
    await expect(call(ctx, "connect.off")).rejects.toMatchObject({
      code: -32_007,
      data: { reason: "not_owner", retryable: false },
      message: expect.stringContaining("device mode belongs to moku-editor perf")
    });
    await expect(call(ctx, "connect.off", { lan: true })).rejects.toMatchObject({ code: -32_007 });
    expect(ctx.hub.stopDevices).not.toHaveBeenCalled();
    expect(ctx.hub.stopLan).not.toHaveBeenCalled();
    expect(ctx.state.mode.on).toBe(true);
  });

  it("stops the LAN listener only with lan, else all of device mode", async () => {
    const ctx = ready();
    await call(ctx, "connect.network");
    await expect(call(ctx, "connect.off", { lan: true })).resolves.toEqual({
      listen: { ...LISTEN }
    });
    expect(ctx.hub.stopDevices).not.toHaveBeenCalled();
    await expect(call(ctx, "connect.off")).resolves.toEqual({ listen: null });
    expect(ctx.hub.stopDevices).toHaveBeenCalledTimes(1);
    expect(ctx.state.mode).toEqual({ on: false, owner: null, listen: null });
    await expect(call(ctx, "connect.off")).resolves.toEqual({ listen: null });
    expect(ctx.hub.stopDevices).toHaveBeenCalledTimes(1);
  });

  it("refuses params it does not know", async () => {
    const ctx = ready();
    await expect(call(ctx, "connect.off", { all: true })).rejects.toMatchObject({ code: -32_602 });
    await expect(call(ctx, "connect.confirm", { ticket: "p-3a1f" })).rejects.toMatchObject({
      code: -32_602,
      data: { field: "code" }
    });
  });
});

describe("connect.scan, confirm and refuse", () => {
  it("renews the scan lease and answers the directory", async () => {
    const ctx = ready();
    const directory = readDirectory(await call(ctx, "connect.scan"));
    expect(directory).toMatchObject({ v: 1, mode: { on: false }, asking: [], linked: [] });
    expect(directory?.wire.map(device => [device.serial, device.phase])).toEqual([
      ["192.168.1.23:37011", "ready"],
      ["R5CX30ABCDE", "ready"],
      ["RZ8T20QWERT", "unauthorized"],
      ["emulator-5554", "offline"]
    ]);
    expect(ctx.state.scanUntil).toBeGreaterThan(Date.now());
  });

  it("answers a pairing typed in the page", async () => {
    const ctx = ready();
    await call(ctx, "connect.network");
    const request = {
      code: "4821",
      model: "SM-A256B",
      address: "192.168.1.23",
      link: "lan",
      engine: null,
      build: null
    } as const;
    const answer = ctx.hub.confirm?.(request, new AbortController().signal);
    const ticket = ctx.state.asking[0]?.ticket;
    await expect(
      call(ctx, "connect.confirm", { ticket: ticket ?? "", code: "4821" })
    ).resolves.toEqual({
      paired: true
    });
    await expect(answer).resolves.toBe(true);

    const second = ctx.hub.confirm?.(request, new AbortController().signal);
    await expect(
      call(ctx, "connect.refuse", { ticket: ctx.state.asking[0]?.ticket ?? "" })
    ).resolves.toEqual({
      refused: true
    });
    await expect(second).resolves.toBe(false);
    await expect(
      call(ctx, "connect.confirm", { ticket: "p-0000", code: "1" })
    ).rejects.toMatchObject({
      code: -32_602
    });
  });
});

describe("connect.watch", () => {
  it("answers not-wired for a LAN phone and ios for an iPhone, and spawns no adb", async () => {
    const ctx = ready();
    await call(ctx, "connect.network");
    ctx.hub.linked.push(
      a26Device({ id: "d-9c1b", link: "lan", address: "192.168.1.23", model: "SM-A256B" }),
      a26Device({ id: "d-1f0e", link: "lan", address: "192.168.1.31", model: "IPHONE15,4" })
    );
    ctx.run.mockClear();
    await expect(call(ctx, "connect.watch", { device: "d-9c1b" })).resolves.toEqual({
      wired: false,
      reason: "not-wired"
    });
    await expect(call(ctx, "connect.watch", { device: "d-1f0e" })).resolves.toEqual({
      wired: false,
      reason: "ios"
    });
    await expect(call(ctx, "connect.watch", { device: "d-0000" })).resolves.toEqual({
      wired: false,
      reason: "not-linked"
    });
    expect(ctx.run).not.toHaveBeenCalled();
    expect(ctx.state.attaches.size).toBe(0);
  });

  it("answers adb-missing without adb, and ambiguous for two wired phones of one model", async () => {
    const missing = ready({ run: fakeRunner(() => MISSING) });
    await call(missing, "connect.wire");
    missing.hub.linked.push(a26Device());
    await scanOnce(missing);
    await expect(call(missing, "connect.watch", { device: "d-7f3a" })).resolves.toEqual({
      wired: false,
      reason: "adb-missing"
    });

    const twins = ready();
    await call(twins, "connect.wire");
    twins.hub.linked.push(a26Device(), a26Device({ id: "d-2b2b" }));
    await scanOnce(twins);
    twins.state.wire.set("R5CX30ZZZZZ", {
      serial: "R5CX30ZZZZZ",
      state: "device",
      transport: "usb",
      facts: { model: "SM-A266B", name: null, os: null },
      asked: true,
      readySince: 0
    });
    await expect(call(twins, "connect.watch", { device: "d-7f3a" })).resolves.toEqual({
      wired: false,
      reason: "ambiguous"
    });
  });

  it("attaches a wired, linked device and ends the lease on unwatch", async () => {
    const ctx = ready();
    await call(ctx, "connect.wire");
    const device = a26Device();
    ctx.hub.linked.push(device);
    ctx.hub.open.push(deviceSession(device));
    await scanOnce(ctx);

    await expect(call(ctx, "connect.watch", { device: "d-7f3a" })).resolves.toEqual({
      wired: true
    });
    expect([...ctx.state.attaches.keys()]).toEqual(["d-7f3a"]);
    expect(ctx.state.watches.get("d-7f3a")?.has(CALLER.conn)).toBe(true);

    await expect(call(ctx, "connect.unwatch", { device: "d-7f3a" })).resolves.toEqual({ ok: true });
    expect(ctx.state.attaches.size).toBe(0);
    expect(ctx.state.watches.has("d-7f3a")).toBe(false);
  });
});

/* eslint-disable unicorn/no-null -- null is "not reported" on a PairRequest */
/* eslint-disable sonarjs/no-hardcoded-ip -- the LAN address of the fixture phone */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startConnect, stopConnect } from "../../lifecycle";
import { turnWireOn } from "../../mode";
import { createPairConfirm } from "../../pairing/confirm";
import { watchDevice } from "../../telemetry/loop";
import { scanOnce } from "../../wire/scan";
import {
  a26,
  a26Device,
  createCtx,
  deviceSession,
  fakeCdp,
  fakeRunner,
  MISSING,
  SERIAL
} from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// spec 11 C2, C9: onStart only for wire "auto"; onStop is state-only teardown.
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("stopConnect", () => {
  it("clears timers, closes CDP, removes the forward, refuses the ticket, and emits and logs nothing", async () => {
    // Bug: a teardown that publishes into a stopping hub, or leaves a forward on the phone.
    const ctx = createCtx({ cdp: fakeCdp(() => ({ usedSize: 1, totalSize: 2 })) });
    await turnWireOn(ctx);
    const device = a26Device();
    ctx.hub.linked.push(device);
    ctx.hub.open.push(deviceSession(device));
    await scanOnce(ctx);
    watchDevice(ctx, "d-7f3a", 1);
    await vi.advanceTimersByTimeAsync(1500);
    const waiting = createPairConfirm(ctx)(
      {
        code: "4821",
        model: null,
        address: "192.168.1.23",
        link: "lan",
        engine: null,
        build: null
      },
      new AbortController().signal
    );
    ctx.emit.mockClear();
    ctx.log.info.mockClear();
    const published = ctx.hub.published.length;

    await stopConnect(ctx);

    await expect(waiting).resolves.toBe(false);
    expect(ctx.cdp.sockets[0]?.closed).toBe(true);
    expect(ctx.run.calls().at(-1)).toEqual(["-s", SERIAL, "forward", "--remove", "tcp:40211"]);
    expect(ctx.state.forwards.size).toBe(0);
    expect(ctx.state.attaches.size).toBe(0);
    expect(ctx.state.watches.size).toBe(0);
    expect(ctx.state.asking).toEqual([]);
    expect(ctx.state.timers).toEqual({ scan: undefined, publish: undefined });

    const calls = ctx.run.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ctx.run.mock.calls.length).toBe(calls);
    expect(ctx.emit).not.toHaveBeenCalled();
    expect(ctx.log.info).not.toHaveBeenCalled();
    expect(ctx.log.warn).not.toHaveBeenCalled();
    expect(ctx.hub.published).toHaveLength(published);
  });

  it("waits at most 500 ms for a forward removal that hangs", async () => {
    const run = fakeRunner(args =>
      args[3] === "--remove" ? new Promise(() => undefined) : a26(args)
    );
    const ctx = createCtx({ run });
    ctx.state.forwards.set(40_211, SERIAL);
    let done = false;
    const stopping = stopConnect(ctx).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(499);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await stopping;
    expect(done).toBe(true);
    expect(ctx.state.forwards.size).toBe(0);
  });
});

describe("startConnect", () => {
  it("turns the adb listener on for wire auto when adb answers", async () => {
    const ctx = createCtx({ config: { wire: "auto" } });
    await startConnect(ctx);
    expect(ctx.run.calls()[0]).toEqual(["version"]);
    expect(ctx.hub.listenDevices).toHaveBeenCalledTimes(1);
    expect(ctx.state.mode.owner).toBe("connect");
    expect(ctx.hub.listenLan).not.toHaveBeenCalled();
  });

  it("logs one info line and stays off for wire auto without adb, or with the port taken", async () => {
    const missing = createCtx({ config: { wire: "auto" }, run: fakeRunner(() => MISSING) });
    await startConnect(missing);
    expect(missing.hub.listenDevices).not.toHaveBeenCalled();
    expect(missing.log.info.mock.calls).toEqual([
      ["connect:auto-wire-off", { reason: "adb-missing" }]
    ]);

    const taken = createCtx({ config: { wire: "auto" } });
    taken.hub.listenDevices.mockRejectedValueOnce(
      Object.assign(new Error("[moku-editor] port 47600 is in use.\n  Try --port 47601."), {
        code: "EADDRINUSE"
      })
    );
    await startConnect(taken);
    expect(taken.log.info.mock.calls).toEqual([
      ["connect:auto-wire-off", { reason: "port_in_use" }]
    ]);
    expect(taken.state.mode.on).toBe(false);
  });

  it("does nothing for wire manual", async () => {
    const ctx = createCtx();
    await startConnect(ctx);
    expect(ctx.run).not.toHaveBeenCalled();
    expect(ctx.hub.listenDevices).not.toHaveBeenCalled();
  });
});

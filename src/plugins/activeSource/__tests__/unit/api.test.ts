/* eslint-disable unicorn/no-null -- null is a JSON value on the wire (device mode off, no latency) */
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorCode, wireError } from "../../../registry/protocol";
import { createActiveSourceApi } from "../../api";
import { startActiveSource, stopActiveSource } from "../../lifecycle";
import type { TestCtx } from "../helpers";
import { changes, createCtx, deviceSession, IPHONE, localSession, settle } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The Connect panel's actions through connect's editor methods, the listeners
// and openConnect (spec 11 § 4 API).
// ─────────────────────────────────────────────────────────────────────────────

let started: TestCtx | undefined;

afterEach(() => {
  if (started !== undefined) stopActiveSource(started);
  started = undefined;
});

/**
 * A started activeSource with the local preview s-1.
 *
 * @returns The ctx, the fake link and the api.
 */
function setup() {
  const made = createCtx({ autoUse: false });
  started = made.ctx;
  startActiveSource(made.ctx);
  made.link.chosen = "s-1";
  made.link.list([localSession("s-1", false)], "s-1");
  return { ...made, api: createActiveSourceApi(made.ctx) };
}

describe("activeSource · connect's actions", () => {
  it("connectWire and connectNetwork answer connect's listen", async () => {
    const { link, api } = setup();

    await expect(api.connectWire()).resolves.toEqual({
      port: 47_600,
      adb: "127.0.0.1:47600",
      lan: null
    });
    await expect(api.connectNetwork()).resolves.toEqual({
      port: 47_600,
      adb: "127.0.0.1:47600",
      lan: "192.168.1.5:47600"
    });
    expect(link.methods()).toEqual(["connect.wire", "connect.network"]);
  });

  it("refuses an answer without a listen with a two-line error", async () => {
    const { link, api } = setup();
    link.callEditor.mockResolvedValueOnce({ listen: "47600" });

    // Bug caught: the panel showing "undefined" as the LAN address.
    await expect(api.connectNetwork()).rejects.toThrow(
      "[moku-editor] connect.network answered without a listen.\n  Restart moku-editor: the tools page and the server are from different builds."
    );
  });

  it("passes connect's wire error through", async () => {
    const { link, api } = setup();
    link.callEditor.mockRejectedValueOnce(
      wireError(errorCode.commandFailed, "port 47600 is in use.", { reason: "command_failed" })
    );

    await expect(api.connectWire()).rejects.toMatchObject({
      code: errorCode.commandFailed,
      message: "[moku-editor] port 47600 is in use."
    });
  });

  it("confirmPairing answers whether the phone paired; refusePairing sends the ticket", async () => {
    const { link, api } = setup();
    link.callEditor.mockResolvedValueOnce({ paired: false });

    await expect(api.confirmPairing("p-3a1f", "4822")).resolves.toBe(false);
    await api.refusePairing("p-3a1f");

    expect(link.callEditor).toHaveBeenCalledWith("connect.confirm", {
      ticket: "p-3a1f",
      code: "4822"
    });
    expect(link.callEditor).toHaveBeenLastCalledWith("connect.refuse", { ticket: "p-3a1f" });
  });

  it("stopDevices sends lan only when asked, and falls back to the local preview with reason stopped", async () => {
    const { ctx, link, api } = setup();
    link.list([localSession("s-1", false), deviceSession("s-9")]);
    await api.useDevice("s-9");

    await api.stopDevices({ lan: true });
    expect(link.callEditor).toHaveBeenLastCalledWith("connect.off", { lan: true });
    expect(api.current()).toMatchObject({ kind: "device" });
    await api.stopDevices();

    expect(link.callEditor).toHaveBeenCalledWith("connect.off", {});
    expect(changes(ctx).at(-1)).toBe("stopped→local:s-1");
  });

  it("stopDevices with lan drops a phone on the network", async () => {
    const { ctx, link, api } = setup();
    link.list([localSession("s-1", false), deviceSession("s-10", IPHONE)]);
    await api.useDevice("s-10");
    expect(api.health().kind).toBe("network");

    await api.stopDevices({ lan: true });
    await settle();

    expect(changes(ctx).at(-1)).toBe("stopped→local:s-1");
  });
});

describe("activeSource · listeners and openConnect", () => {
  it("logs a throwing onChange listener and still calls the others", async () => {
    const { ctx, link, api } = setup();
    link.list([localSession("s-1", false), deviceSession("s-9")]);
    const reasons: string[] = [];
    api.onChange(() => {
      throw new Error("boom");
    });
    const off = api.onChange(change => reasons.push(change.reason));

    await api.useDevice("s-9");
    off();
    await api.useLocal();

    expect(reasons).toEqual(["user"]);
    expect(ctx.log.error).toHaveBeenCalledWith(
      "activeSource:listener-failed",
      {},
      expect.any(Error)
    );
  });

  it("openConnect emits activeSource:connect-requested with the tab", () => {
    const { ctx, api } = setup();

    api.openConnect("network");
    api.openConnect();

    expect(ctx.emit).toHaveBeenCalledWith("activeSource:connect-requested", { tab: "network" });
    expect(ctx.emit).toHaveBeenLastCalledWith("activeSource:connect-requested", { tab: undefined });
  });

  it("dismissNotice closes the notice now", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { link, api } = setup();
    link.list([localSession("s-1", false), deviceSession("s-9")]);
    await api.useDevice("s-9");
    link.list([localSession("s-1", false)]);
    await settle();
    expect(api.notice()).toBeDefined();

    api.dismissNotice();

    expect(api.notice()).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it("directory() answers link's held editor.devices", () => {
    const { link, api } = setup();
    expect(api.directory()).toBeUndefined();
    link.devices = {
      v: 1,
      mode: { on: false, owner: null, listen: null },
      confirmIn: null,
      adb: { available: true },
      wire: [],
      asking: [],
      linked: [],
      at: 1
    };
    expect(api.directory()).toBe(link.devices);
  });
});

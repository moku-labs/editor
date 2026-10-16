/* eslint-disable unicorn/no-null -- null is a JSON value on the wire (device mode off, no latency) */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActiveSourceApi } from "../../api";
import { startActiveSource, stopActiveSource } from "../../lifecycle";
import type { TestCtx } from "../helpers";
import {
  changes,
  createCtx,
  deviceSession,
  directoryOf,
  IPHONE,
  localSession,
  settle
} from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The session list (spec 11 § 4 B3, B6): a device that links becomes the source
// once, a second device only raises a notice, the active device leaving returns
// the page to the local preview with a notice and a marker, and the rejoin
// window brings it back unless the person chose meanwhile.
// ─────────────────────────────────────────────────────────────────────────────

let started: TestCtx | undefined;

/**
 * A started activeSource on a page whose local preview s-1 runs; link has chosen it.
 *
 * @param config - Config overrides.
 * @returns The ctx, the fake link and the api.
 */
function setup(config: Parameters<typeof createCtx>[0] = {}) {
  const made = createCtx(config);
  started = made.ctx;
  startActiveSource(made.ctx);
  made.link.chosen = "s-1";
  made.link.list([localSession("s-1", false)], "s-1");
  return { ...made, api: createActiveSourceApi(made.ctx) };
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"]
  });
  vi.setSystemTime(1_791_986_000_000);
});

afterEach(() => {
  if (started !== undefined) stopActiveSource(started);
  started = undefined;
  vi.useRealTimers();
});

describe("activeSource · a device links (B3)", () => {
  it("switches once to a new device (reason connected), never again for it across a re-list", async () => {
    const { ctx, link, api } = setup();

    link.list([localSession("s-1", false), deviceSession("s-9")]);
    await settle();
    expect(api.current()).toMatchObject({ kind: "device", session: "s-9" });
    await api.useLocal();
    link.list([localSession("s-1", false), deviceSession("s-9")]);
    await settle();

    // Bug caught: the source jumping back to a phone the person left on purpose.
    expect(changes(ctx)).toEqual(["adopted→local:s-1", "connected→device:s-9", "user→local:s-1"]);
    expect(api.markers()[0]).toMatchObject({ kind: "connected", label: "SM-A266B connected" });
  });

  it("with a device already the source, a second device only raises the connected — Use notice", async () => {
    const { ctx, link, api } = setup();
    link.list([localSession("s-1", false), deviceSession("s-9")]);
    await settle();

    link.list([localSession("s-1", false), deviceSession("s-9"), deviceSession("s-10", IPHONE)]);
    await settle();

    expect(api.current()).toMatchObject({ kind: "device", session: "s-9" });
    expect(api.notice()).toEqual({
      device: "d-11c2",
      model: "IPHONE15,4",
      text: "IPHONE15,4 connected — Use",
      until: Date.now() + 12_000,
      back: true
    });
    expect(changes(ctx)).toHaveLength(2);
  });

  it("does not switch with autoUse off", async () => {
    const made = createCtx({ autoUse: false });
    started = made.ctx;
    startActiveSource(made.ctx);
    made.link.chosen = "s-1";
    made.link.list([localSession("s-1", false), deviceSession("s-9")], "s-1");
    await settle();

    expect(made.link.choose).not.toHaveBeenCalled();
    expect(createActiveSourceApi(made.ctx).current()).toEqual({ kind: "local", session: "s-1" });
  });
});

describe("activeSource · the active device leaves (B6) and rejoins", () => {
  it("switches to local with reason lost, resumes, shows the notice for noticeMs and adds the marker", async () => {
    const { ctx, link, api } = setup();
    link.list([localSession("s-1", false), deviceSession("s-9")]);
    await settle();

    link.list([localSession("s-1", true)]);
    await settle();

    expect(changes(ctx).at(-1)).toBe("lost→local:s-1");
    expect(link.commands()).toEqual(["s-1 game.pause", "s-1 game.resume"]);
    expect(api.notice()).toMatchObject({
      device: "d-7f3a",
      text: "SM-A266B disconnected. Showing the local preview.",
      back: false
    });
    expect(api.markers().at(-1)).toMatchObject({
      kind: "lost",
      label: "SM-A266B disconnected here · Local preview resumed",
      device: "d-7f3a"
    });
    await vi.advanceTimersByTimeAsync(12_000);
    expect(api.notice()).toBeUndefined();
  });

  it("reads stopped when the directory says device mode turned off", async () => {
    const { ctx, link } = setup();
    link.list([localSession("s-1", false), deviceSession("s-9")]);
    await settle();

    link.publishDevices(
      directoryOf({ mode: { on: false, owner: null, listen: null }, linked: [] })
    );
    link.list([localSession("s-1", true)]);
    await settle();

    expect(changes(ctx).at(-1)).toBe("stopped→local:s-1");
  });

  it("rejoins the same device id within rejoinMs, closing the notice and pausing again", async () => {
    const { ctx, link, api } = setup();
    link.list([localSession("s-1", false), deviceSession("s-9")]);
    await settle();
    link.list([localSession("s-1", false)]);
    await settle();

    await vi.advanceTimersByTimeAsync(14_000);
    link.list([localSession("s-1", false), deviceSession("s-12")]);
    await settle();

    expect(changes(ctx).at(-1)).toBe("rejoined→device:s-12");
    expect(api.notice()).toBeUndefined();
    expect(link.commands().at(-1)).toBe("s-1 game.pause");
  });

  it("does not rejoin after rejoinMs; the notice, while it shows, says the device is back", async () => {
    const { ctx, link, api } = setup({ noticeMs: 60_000 });
    link.list([localSession("s-1", false), deviceSession("s-9")]);
    await settle();
    link.list([localSession("s-1", false)]);
    await settle();

    await vi.advanceTimersByTimeAsync(15_001);
    link.list([localSession("s-1", false), deviceSession("s-12")]);
    await settle();

    expect(changes(ctx).at(-1)).toBe("lost→local:s-1");
    expect(api.current()).toEqual({ kind: "local", session: "s-1" });
    expect(api.notice()).toMatchObject({ device: "d-7f3a", back: true });
  });

  it("an explicit useLocal between loss and return cancels the rejoin", async () => {
    const { ctx, link, api } = setup();
    link.list([localSession("s-1", false), deviceSession("s-9")]);
    await settle();
    link.list([localSession("s-1", false)]);
    await settle();

    await api.useLocal();
    link.list([localSession("s-1", false), deviceSession("s-12")]);
    await settle();

    // Bug caught: the phone grabbing the page back after the person chose local.
    expect(changes(ctx).at(-1)).toBe("lost→local:s-1");
    expect(api.current()).toEqual({ kind: "local", session: "s-1" });
  });

  it("reconnect() waits without a time limit and rejoins when the device comes back", async () => {
    const { ctx, link, api } = setup();
    link.list([localSession("s-1", false), deviceSession("s-9")]);
    await settle();
    link.list([localSession("s-1", false)]);
    await settle();

    await expect(api.reconnect()).resolves.toBe(false);
    expect(api.notice()?.text).toBe("Waiting for SM-A266B…");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.notice()?.text).toBe("Waiting for SM-A266B…");
    link.list([localSession("s-1", false), deviceSession("s-12")]);
    await settle();

    expect(changes(ctx).at(-1)).toBe("rejoined→device:s-12");
    expect(api.notice()).toBeUndefined();
  });

  it("turns local without a session when link cannot choose the local preview after a loss", async () => {
    const { ctx, link, api } = setup();
    link.list([localSession("s-1", false), deviceSession("s-9")]);
    await settle();
    link.choose.mockRejectedValueOnce(new Error("[moku-editor] link closed."));

    link.list([localSession("s-1", false)]);
    await settle();

    // Bug caught: the page left on a device that is gone because one call failed.
    expect(api.current()).toEqual({ kind: "local", session: null });
    expect(ctx.log.warn).toHaveBeenCalledWith("activeSource:choose-failed", {
      session: "s-1",
      message: "[moku-editor] link closed."
    });
  });
});

describe("activeSource.reconnect", () => {
  it("uses the lost device's newest session at once when it is back, and answers true", async () => {
    const { ctx, link, api } = setup({ rejoinMs: 0 });
    link.list([localSession("s-1", false), deviceSession("s-9")]);
    await settle();
    link.list([localSession("s-1", false)]);
    await settle();
    link.list([localSession("s-1", false), deviceSession("s-12")]);
    await settle();
    expect(api.current()).toEqual({ kind: "local", session: "s-1" });

    await expect(api.reconnect()).resolves.toBe(true);

    expect(changes(ctx).at(-1)).toBe("rejoined→device:s-12");
    await expect(api.reconnect()).resolves.toBe(false);
  });
});

describe("activeSource · a background switch that fails", () => {
  it("is logged and leaves the local preview the source", async () => {
    const { ctx, link, api } = setup();
    link.choose.mockRejectedValueOnce(new Error("[moku-editor] manifest timed out."));

    link.list([localSession("s-1", false), deviceSession("s-9")]);
    await settle();

    // Bug caught: an unhandled rejection on the page, and a source that says device while link reads local.
    expect(ctx.log.warn).toHaveBeenCalledWith("activeSource:switch-failed", {
      session: "s-9",
      reason: "connected",
      message: "[moku-editor] manifest timed out."
    });
    expect(api.current()).toEqual({ kind: "local", session: "s-1" });
  });
});

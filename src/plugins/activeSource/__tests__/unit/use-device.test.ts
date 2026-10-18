import { afterEach, describe, expect, it, vi } from "vitest";
import type { Manifest } from "../../../registry/protocol";
import { errorCode, wireError } from "../../../registry/protocol";
import { createActiveSourceApi } from "../../api";
import { startActiveSource, stopActiveSource } from "../../lifecycle";
import type { TestCtx } from "../helpers";
import {
  A26,
  changes,
  createCtx,
  deviceSession,
  IPHONE,
  localSession,
  MANIFEST,
  pageSession,
  resultOf,
  settle
} from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// useDevice (spec 11 § 4 B4): the local preview pauses before link chooses the
// device, only a pause activeSource made itself is remembered for the resume,
// a refused pause still switches, switches are serialized (the newest wins).
// ─────────────────────────────────────────────────────────────────────────────

let started: TestCtx | undefined;

/**
 * A started activeSource on a page with the local preview s-1 and the Galaxy A26 (s-9), autoUse
 * off so the test makes the switch.
 *
 * @param paused - The hub's readout of the local preview's last heartbeat.
 * @returns The ctx, the fake link and the api.
 */
function setup(paused?: boolean) {
  const made = createCtx({ autoUse: false });
  started = made.ctx;
  startActiveSource(made.ctx);
  made.link.chosen = "s-1";
  made.link.list([localSession("s-1", paused), deviceSession("s-9")], "s-1");
  return { ...made, api: createActiveSourceApi(made.ctx) };
}

afterEach(() => {
  if (started !== undefined) stopActiveSource(started);
  started = undefined;
});

describe("activeSource.useDevice", () => {
  it("pauses the local preview before link chooses the device, then starts the watch lease", async () => {
    const { ctx, link, api } = setup(false);

    await api.useDevice("s-9");

    // Bug caught: one frame of mixed sources — the device chosen while the local game still runs.
    const pause = link.runIn.mock.invocationCallOrder[0] ?? Number.NaN;
    const choose = link.choose.mock.invocationCallOrder.at(-1) ?? Number.NaN;
    expect(link.commands()).toEqual(["s-1 game.pause"]);
    expect(pause).toBeLessThan(choose);
    expect(link.choose).toHaveBeenLastCalledWith("s-9");
    expect(link.callEditor).toHaveBeenCalledWith("connect.watch", { device: "d-7f3a" });
    expect(api.current()).toEqual({ kind: "device", session: "s-9", device: A26 });
    expect(api.preview()).toEqual({ state: "paused-by-source" });
    expect(ctx.state.pausedSession).toBe("s-1");
    expect(changes(ctx)).toContain("user→device:s-9");
  });

  it("holds a local game the person had paused: no game.pause now, no game.resume after useLocal", async () => {
    const { link, api } = setup(true);

    await api.useDevice("s-9");
    expect(api.preview()).toEqual({ state: "held" });
    await api.useLocal();

    // Bug caught: the editor un-pausing a game the developer paused on purpose.
    expect(link.commands()).toEqual([]);
    expect(api.preview()).toEqual({ state: "held" });
    expect(api.current()).toEqual({ kind: "local", session: "s-1" });
  });

  it("remembers the pause only when game.pause answered true", async () => {
    const { ctx, link, api } = setup(false);
    link.runIn.mockResolvedValueOnce(resultOf(false));

    await api.useDevice("s-9");
    await api.useLocal();

    // Bug caught: game.resume sent to a game this plugin never paused.
    expect(ctx.state.pausedSession).toBeUndefined();
    expect(link.commands()).toEqual(["s-1 game.pause"]);
  });

  it("a refused game.pause leaves the preview unpausable with the reason and still switches", async () => {
    const { link, api } = setup(false);
    link.runIn.mockRejectedValueOnce(
      wireError(errorCode.readOnly, "game.pause is not in this build.", { reason: "read_only" })
    );

    await api.useDevice("s-9");

    expect(api.preview()).toEqual({
      state: "unpausable",
      reason: "[moku-editor] game.pause is not in this build."
    });
    expect(api.current()).toMatchObject({ kind: "device", session: "s-9" });
  });

  it("refuses a session without a device with the two-line TypeError, before pausing anything", async () => {
    const { link, api } = setup(false);
    link.list([localSession("s-1", false), deviceSession("s-9"), pageSession("s-2")]);

    await expect(api.useDevice("s-2")).rejects.toThrow(
      new TypeError(
        '[moku-editor] activeSource.useDevice needs a device session, got "s-2".\n  Pass an id from link.sessions() that has a device.'
      )
    );
    expect(link.commands()).toEqual([]);
  });

  it("rejects an unknown id with link's -32003 and pauses nothing", async () => {
    const { link, api } = setup(false);

    await expect(api.useDevice("s-404")).rejects.toMatchObject({
      code: -32_003,
      data: { reason: "choose_session" }
    });
    expect(link.commands()).toEqual([]);
    expect(api.current()).toEqual({ kind: "local", session: "s-1" });
  });

  it("ends two quick switches on the second, even when the first answer comes last", async () => {
    const { ctx, link, api } = setup(false);
    link.list([localSession("s-1", false), deviceSession("s-9"), deviceSession("s-10", IPHONE)]);
    let releaseFirst: ((manifest: Manifest) => void) | undefined;
    link.choose.mockImplementationOnce(session => {
      link.chosen = session;
      return new Promise(resolve => {
        releaseFirst = resolve;
      });
    });

    const first = api.useDevice("s-9");
    await settle();
    const second = api.useDevice("s-10");
    await second;
    releaseFirst?.(MANIFEST);
    await first;

    // Bug caught: a late answer of the first switch winning.
    expect(api.current()).toMatchObject({ kind: "device", session: "s-10" });
    expect(changes(ctx)).toEqual(["adopted→local:s-1", "user→device:s-10"]);
    expect(link.commands()).toEqual(["s-1 game.pause"]);
  });

  it("does nothing when the device is already the source", async () => {
    const { ctx, link, api } = setup(false);
    await api.useDevice("s-9");
    link.choose.mockClear();

    await api.useDevice("s-9");

    expect(link.choose).not.toHaveBeenCalled();
    expect(changes(ctx)).toEqual(["adopted→local:s-1", "user→device:s-9"]);
  });

  it("gives the local preview back when link cannot attach the device after the pause", async () => {
    const { link, api } = setup(false);
    link.choose.mockImplementationOnce(() =>
      Promise.reject(wireError(errorCode.timeout, "manifest timed out.", { reason: "timeout" }))
    );

    await expect(api.useDevice("s-9")).rejects.toMatchObject({ code: errorCode.timeout });
    await vi.waitFor(() => expect(link.commands()).toEqual(["s-1 game.pause", "s-1 game.resume"]));

    // Bug caught: the local preview left paused while it is still the source.
    expect(api.current()).toEqual({ kind: "local", session: "s-1" });
    expect(api.preview()).toEqual({ state: "running" });
  });
});

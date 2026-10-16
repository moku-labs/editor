import { afterEach, describe, expect, it } from "vitest";
import { createActiveSourceApi } from "../../api";
import { startActiveSource, stopActiveSource } from "../../lifecycle";
import type { TestCtx } from "../helpers";
import { changes, createCtx, deviceSession, localSession } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// useLocal (spec 11 § 4 B5): the watch lease ends, link chooses the local
// preview, and game.resume goes only to the session activeSource paused.
// ─────────────────────────────────────────────────────────────────────────────

let started: TestCtx | undefined;

/**
 * A started activeSource with the local preview s-1 and the Galaxy A26 (s-9), autoUse off.
 *
 * @returns The ctx, the fake link and the api.
 */
function setup() {
  const made = createCtx({ autoUse: false });
  started = made.ctx;
  startActiveSource(made.ctx);
  made.link.chosen = "s-1";
  made.link.list([localSession("s-1", false), deviceSession("s-9")], "s-1");
  return { ...made, api: createActiveSourceApi(made.ctx) };
}

afterEach(() => {
  if (started !== undefined) stopActiveSource(started);
  started = undefined;
});

describe("activeSource.useLocal", () => {
  it("unwatches the device, chooses the local preview, resumes it and emits reason user", async () => {
    const { ctx, link, api } = setup();
    await api.useDevice("s-9");

    await api.useLocal();

    expect(link.callEditor).toHaveBeenCalledWith("connect.unwatch", { device: "d-7f3a" });
    expect(link.choose).toHaveBeenLastCalledWith("s-1");
    expect(link.commands()).toEqual(["s-1 game.pause", "s-1 game.resume"]);
    expect(api.preview()).toEqual({ state: "running" });
    expect(changes(ctx)).toEqual(["adopted→local:s-1", "user→device:s-9", "user→local:s-1"]);
    expect(api.markers().at(-1)).toMatchObject({ kind: "user", device: "d-7f3a" });
  });

  it("does not resume a session it paused that has closed since, nor the new local session", async () => {
    const { link, api } = setup();
    await api.useDevice("s-9");
    // The frame reloaded with pauseLocal's pause lost on the way: s-1 is gone, s-2 is the own frame.
    link.sessions = [localSession("s-2", false), deviceSession("s-9")];
    link.own = "s-2";

    await api.useLocal();

    // Bug caught: game.resume popping a pause this plugin never pushed.
    expect(link.commands()).toEqual(["s-1 game.pause"]);
    expect(api.current()).toEqual({ kind: "local", session: "s-2" });
  });

  it("throws the two-line Error on a page without a local preview", async () => {
    const { link, api } = setup();
    link.own = undefined;

    await expect(api.useLocal()).rejects.toThrow(
      new Error(
        "[moku-editor] activeSource.useLocal: this page has no local preview.\n  Open the editor with a game (moku-editor <game>) to have one."
      )
    );
  });

  it("logs a failed game.resume and reads the preview running", async () => {
    const { ctx, link, api } = setup();
    await api.useDevice("s-9");
    link.runIn.mockRejectedValueOnce(new Error("[moku-editor] timeout."));

    await api.useLocal();

    // Bug caught: the preview stuck on "resuming" after a lost answer.
    expect(api.preview()).toEqual({ state: "running" });
    expect(ctx.log.warn).toHaveBeenCalledWith("activeSource:resume-failed", {
      session: "s-1",
      message: "[moku-editor] timeout."
    });
  });
});

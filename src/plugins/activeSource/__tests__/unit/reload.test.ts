import { afterEach, describe, expect, it } from "vitest";
import type { Manifest } from "../../../registry/protocol";
import { createActiveSourceApi } from "../../api";
import { startActiveSource, stopActiveSource } from "../../lifecycle";
import type { TestCtx } from "../helpers";
import { createCtx, deviceSession, localSession, MANIFEST, settle } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// A reload of the local frame while a device is the source (spec 11 § 4 B7):
// the new own session is paused again and becomes the resume target.
// ─────────────────────────────────────────────────────────────────────────────

let started: TestCtx | undefined;

afterEach(() => {
  if (started !== undefined) stopActiveSource(started);
  started = undefined;
});

describe("activeSource · the local frame reloads while a device is the source", () => {
  it("pauses the new own session and resumes that one later", async () => {
    const { ctx, link } = createCtx();
    started = ctx;
    startActiveSource(ctx);
    const api = createActiveSourceApi(ctx);
    link.chosen = "s-1";
    link.list([localSession("s-1", false), deviceSession("s-9")], "s-1");
    await settle();
    expect(api.current()).toMatchObject({ kind: "device", session: "s-9" });

    link.list([deviceSession("s-9")]);
    link.list([deviceSession("s-9"), localSession("s-2")], "s-2");
    await settle();

    // Bug caught: the local game running again behind the device after a hot reload.
    expect(link.commands()).toEqual(["s-1 game.pause", "s-2 game.pause"]);
    expect(ctx.state.pausedSession).toBe("s-2");
    expect(api.preview()).toEqual({ state: "paused-by-source" });

    await api.useLocal();
    expect(link.commands().at(-1)).toBe("s-2 game.resume");
  });

  it("leaves a re-listed own session alone (a heartbeat flip is not a reload)", async () => {
    const { ctx, link } = createCtx();
    started = ctx;
    startActiveSource(ctx);
    link.chosen = "s-1";
    link.list([localSession("s-1", true), deviceSession("s-9")], "s-1");
    await settle();

    link.list([localSession("s-1", false), deviceSession("s-9")]);
    await settle();

    // Bug caught: the editor fighting the person, pausing a game they resumed by hand.
    expect(link.commands()).toEqual([]);
  });

  it("pauses a frame that reloads while the switch to the device is still in flight", async () => {
    const { ctx, link } = createCtx({ autoUse: false });
    started = ctx;
    startActiveSource(ctx);
    const api = createActiveSourceApi(ctx);
    link.chosen = "s-1";
    link.list([localSession("s-1", false), deviceSession("s-9")], "s-1");
    let attach: ((manifest: Manifest) => void) | undefined;
    link.choose.mockImplementationOnce(session => {
      link.chosen = session;
      return new Promise(resolve => {
        attach = resolve;
      });
    });

    const switching = api.useDevice("s-9");
    await settle();
    link.list([deviceSession("s-9"), localSession("s-2")], "s-2");
    await settle();
    attach?.(MANIFEST);
    await switching;

    // Bug caught: a save during the switch leaving the new local frame running behind the phone.
    expect(link.commands()).toEqual(["s-1 game.pause", "s-2 game.pause"]);
    expect(ctx.state.pausedSession).toBe("s-2");
  });
});

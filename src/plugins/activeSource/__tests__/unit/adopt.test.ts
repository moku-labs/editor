/* eslint-disable unicorn/no-null -- the label of a page has no model and no address */
import { afterEach, describe, expect, it } from "vitest";
import type { LinkStatus } from "../../../registry/protocol";
import { createActiveSourceApi } from "../../api";
import { createActiveSourceHooks } from "../../handlers";
import { startActiveSource, stopActiveSource } from "../../lifecycle";
import type { TestCtx } from "../helpers";
import { changes, createCtx, deviceSession, localSession, pageSession, settle } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The first session list and a choice made elsewhere (spec 11 § 4 B2, B8): the
// source follows link's choice with reason adopted, and the pause rule of the
// new kind applies; a choice this plugin is making itself is not adopted.
// ─────────────────────────────────────────────────────────────────────────────

const LIVE: LinkStatus = { kind: "live", frame: 1840 };

let started: TestCtx | undefined;

afterEach(() => {
  if (started !== undefined) stopActiveSource(started);
  started = undefined;
});

/**
 * A started activeSource, autoUse off, with its link:status hook.
 *
 * @returns The ctx, the fake link, the api and the hook.
 */
function setup() {
  const made = createCtx({ autoUse: false });
  started = made.ctx;
  startActiveSource(made.ctx);
  const hooks = createActiveSourceHooks(made.ctx);
  return { ...made, api: createActiveSourceApi(made.ctx), onStatus: hooks["link:status"] };
}

describe("activeSource · adopting link's choice", () => {
  it("takes the first sessions list's choice with reason adopted and no marker", async () => {
    const { ctx, link, api } = setup();
    link.chosen = "s-1";

    link.list([localSession("s-1", false)], "s-1");
    await settle();

    expect(changes(ctx)).toEqual(["adopted→local:s-1"]);
    expect(api.markers()).toEqual([]);
    expect(api.preview()).toEqual({ state: "running" });
  });

  it("adopts a device session someone else chose and pauses the local preview for it", async () => {
    const { ctx, link, api, onStatus } = setup();
    link.chosen = "s-1";
    link.list([localSession("s-1", false), deviceSession("s-9")], "s-1");
    await settle();

    link.chosen = "s-9";
    onStatus({ status: LIVE, session: "s-9" });
    await settle();

    expect(changes(ctx).at(-1)).toBe("adopted→device:s-9");
    expect(link.commands()).toEqual(["s-1 game.pause"]);
    expect(api.preview()).toEqual({ state: "paused-by-source" });
    expect(link.callEditor).toHaveBeenCalledWith("connect.watch", { device: "d-7f3a" });
  });

  it("does not adopt the session its own switch is choosing", async () => {
    const { ctx, link, api, onStatus } = setup();
    link.chosen = "s-1";
    link.list([localSession("s-1", false), deviceSession("s-9")], "s-1");
    await settle();
    link.choose.mockImplementationOnce(async session => {
      link.chosen = session;
      onStatus({ status: { kind: "connecting" }, session });
      await settle();
      return { game: "g", page: "p", embedded: false, sources: [], commands: [] };
    });

    await api.useDevice("s-9");

    // Bug caught: one switch announced twice, once as adopted.
    expect(changes(ctx)).toEqual(["adopted→local:s-1", "user→device:s-9"]);
  });

  it("leaves a lost device to the loss rule: link's pick of the local preview is not an adoption", async () => {
    const { ctx, link, api, onStatus } = setup();
    link.chosen = "s-1";
    link.list([localSession("s-1", false), deviceSession("s-9")], "s-1");
    await api.useDevice("s-9");

    link.sessions = [localSession("s-1", false)];
    link.chosen = "s-1";
    onStatus({ status: LIVE, session: "s-1" });
    link.list([localSession("s-1", false)]);
    await settle();

    expect(changes(ctx).at(-1)).toBe("lost→local:s-1");
  });

  it("adopts another tab's game frame as a page source, named by its game", async () => {
    const { ctx, link, api, onStatus } = setup();
    link.chosen = "s-1";
    link.list([localSession("s-1", false), pageSession("s-5")], "s-1");
    await settle();

    link.chosen = "s-5";
    onStatus({ status: LIVE, session: "s-5" });
    await settle();

    // Bug caught: another tab's frame read as this page's local preview (paused, resumed, Use local).
    expect(changes(ctx).at(-1)).toBe("adopted→page:s-5");
    expect(api.label()).toEqual({
      name: "merge-game 0.0.0",
      model: null,
      kind: "page",
      link: { kind: "local", transport: "frame", address: null }
    });
    expect(link.commands()).toEqual([]);
  });

  it("applies at start the list link already has", () => {
    const made = createCtx({ autoUse: false });
    started = made.ctx;
    made.link.sessions = [localSession("s-1", false)];
    made.link.own = "s-1";
    made.link.chosen = "s-1";

    startActiveSource(made.ctx);

    // Bug caught: a page started after link listed its sessions showing "Not started" until the next list.
    expect(createActiveSourceApi(made.ctx).current()).toEqual({ kind: "local", session: "s-1" });
  });
});

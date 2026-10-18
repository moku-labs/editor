// @vitest-environment happy-dom
import { h } from "preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionInfo } from "../../../registry/protocol";
import { setPicker } from "../../element/select";
import { onWorkspaceChanged } from "../../handlers";
import { startGameView, stopGameView } from "../../lifecycle";
import { calibrate } from "../../scene/calibrate";
import { readScene } from "../../scene/read";
import { DeviceToolbar } from "../../ui/DeviceToolbar";
import { ElementTab } from "../../ui/ElementTab";
import { createCtx, manifestOf, sceneCapture, type TestCtx, useScene } from "../helpers";
import { find, type Mounted, mount } from "../ui";

// Spec 11 § 5.5 G1 (spec 09 R4 for the Game workspace): on a session whose SessionInfo.device is
// present, gameView watches no scene source and calibrates nothing; the element tools say to
// switch to the local preview.

/** What the Element tab and the picker say on a device session (spec 11 § 5.5). */
const SWITCH_TEXT = "Element tools read the local preview. Switch the source to Local preview.";

/** The three scene sources gameView watches while Game is shown. */
const SCENE_SOURCES = ["game.ui", "game.entities", "game.projections"];

/** This page's local preview: a browser session in the game frame. */
const LOCAL: SessionInfo = {
  id: "s-1",
  game: "timber 0.4.0",
  page: "http://127.0.0.1:3000/game.html?mokuFrame=f-1",
  embedded: true,
  connectedAt: 1_791_986_000_000
};

/** A Galaxy A26 linked by wire: a device session. */
const PHONE: SessionInfo = {
  id: "s-9",
  game: "timber 0.4.0",
  page: "http://localhost/index.html",
  embedded: false,
  connectedAt: 1_791_986_090_000,
  device: {
    id: "d-7f3a",
    model: "SM-A266B",
    link: "adb",
    address: "127.0.0.1",
    port: 47_600,
    engine: "0.15.0+9c41e0",
    build: "debug-20261016T090000Z"
  }
};

let ctx: TestCtx;
let views: Mounted[];

/**
 * Attaches a session the way link does: the chosen id changes, then the manifest listeners run,
 * before link resubscribes the watches it holds. Undefined is the chosen session closing.
 *
 * @param session - The session to attach, undefined for none.
 */
function attach(session: SessionInfo | undefined): void {
  ctx.link.sessionValue = session?.id;
  const manifest = session === undefined ? undefined : manifestOf();
  for (const listener of ctx.link.manifestListeners) listener(manifest);
}

/**
 * Mounts a component of gameView and keeps it for the unmount after the test.
 *
 * @param component - ElementTab or DeviceToolbar.
 * @returns The mounted view.
 */
function show(component: typeof ElementTab | typeof DeviceToolbar): Mounted {
  const view = mount(h(component, { ctx }));
  views.push(view);
  return view;
}

beforeEach(() => {
  ctx = createCtx();
  useScene(ctx);
  ctx.link.sessionsValue = [LOCAL, PHONE];
  views = [];
});

afterEach(() => {
  for (const view of views) view.unmount();
  stopGameView(ctx);
  document.body.innerHTML = "";
});

describe("gameView on a device session (G1)", () => {
  it("sends no scene watch to the phone: neither a restored #game nor entering Game watches", () => {
    attach(PHONE);
    ctx.workspace.activeValue = "game";

    startGameView(ctx);
    onWorkspaceChanged(ctx)({ ws: "game" });

    expect(ctx.link.watch).not.toHaveBeenCalled();
  });

  it("drops the scene watches and the picker when the phone becomes the source, before link resubscribes them", () => {
    ctx.workspace.activeValue = "game";
    startGameView(ctx);
    expect(ctx.link.active().map(record => record.id)).toEqual(SCENE_SOURCES);
    ctx.state.picker = { on: true, hover: "ui:boardScreen" };

    attach(PHONE);

    expect(ctx.link.active()).toEqual([]);
    expect(ctx.state.picker).toEqual({ on: false, hover: undefined });
  });

  it("watches the scene again when the local preview is the source once more and Game is shown", () => {
    ctx.workspace.activeValue = "game";
    attach(PHONE);
    startGameView(ctx);

    attach(LOCAL);

    expect(ctx.link.active().map(record => record.id)).toEqual(SCENE_SOURCES);
  });

  it("starts no scene watch back on the local preview while another workspace is shown", () => {
    attach(PHONE);
    startGameView(ctx);

    attach(LOCAL);

    expect(ctx.link.watch).not.toHaveBeenCalled();
  });

  it("calibrates nothing: no game.rect is read from the phone", async () => {
    attach(PHONE);
    ctx.state.sources.ui = sceneCapture("scene-board.txt").ui;

    await calibrate(ctx);

    expect(ctx.link.read).not.toHaveBeenCalled();
    expect(ctx.state.calibrationRead).toBe(false);
  });

  it("refuses scene() with the switch to the local preview and reads nothing from the phone", async () => {
    attach(PHONE);

    await expect(readScene(ctx)).rejects.toThrow(
      "[moku-editor] Element tools read the local preview.\n  Switch the source to Local preview."
    );
    expect(ctx.link.read).not.toHaveBeenCalled();
  });

  it("Select element shows the Element tab and leaves the picker off", () => {
    attach(PHONE);

    setPicker(ctx, true);

    expect(ctx.workspace.show).toHaveBeenCalledWith("game");
    expect(ctx.state.tab).toBe("element");
    expect(ctx.state.picker.on).toBe(false);
  });

  it("the Element tab and the picker button say to switch to the local preview", () => {
    attach(PHONE);
    ctx.state.selected = { kind: "ui", path: "boardScreen" };

    const tab = show(ElementTab);
    const pick = find(show(DeviceToolbar).root, "[data-part='pick']");

    expect(find(tab.root, "[data-part='element']").textContent).toBe(SWITCH_TEXT);
    expect(pick.getAttribute("title")).toBe(SWITCH_TEXT);
    expect(pick.getAttribute("aria-disabled")).toBe("true");
  });
});

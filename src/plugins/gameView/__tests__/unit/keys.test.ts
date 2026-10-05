// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sidePanelState } from "../../../panels/shared/side-panel";
import type { SelectionInfo } from "../../../registry/protocol";
import { addEscapeLayer, unwind } from "../../../workspace/keys/escape";
import type { EscEntry, KeyBinding, WorkspaceCtx } from "../../../workspace/types";
import { escapeClosers, keyBindings } from "../../keys";
import { createCtx, flush, manifestOf, PNG, type TestCtx } from "../helpers";

const COIN = { kind: "ui", path: "boardScreen/hudRow/coinPill" } as const;
const AREA: SelectionInfo = {
  ref: COIN,
  name: "area",
  type: "area",
  rect: { x: 0, y: 0, w: 40, h: 40 },
  area: { x: 0, y: 0, w: 40, h: 40 },
  items: [],
  at: 1
};

// eslint-disable-next-line unicorn/no-null -- null is the wire's "nothing selected"
const NOTHING = null;

let ctx: TestCtx;

/**
 * The last `link.notify` call gameView made.
 *
 * @returns Its method and params, undefined before any.
 */
function lastPublished(): unknown[] | undefined {
  return ctx.link.notify.mock.lastCall;
}

/**
 * The closer of the selection layer.
 *
 * @returns The closer.
 */
function selectionCloser(): { readonly close: () => boolean } {
  const found = escapeClosers(ctx).find(closer => closer.layer === "selection");
  if (found === undefined) throw new Error("no selection layer");
  return found;
}

/**
 * The binding of a key.
 *
 * @param bindings - Bindings.
 * @param key - A key of it.
 * @returns The binding.
 */
function bindingOf(bindings: readonly KeyBinding[], key: string): KeyBinding {
  const found = bindings.find(binding => [binding.keys].flat().includes(key));
  if (found === undefined) throw new Error(`no binding ${key}`);
  return found;
}

/** Opens a contact sheet of two shots. */
function openSheetState(): void {
  ctx.state.series.sheet = {
    indexPath: ".moku/captures/series-a/index.json",
    index: {
      label: "a",
      durationMs: 100,
      intervalMs: 50,
      fromFrame: 1,
      shots: [
        { file: "001.png", frame: 1, atMs: 0, bug: false },
        { file: "002.png", frame: 4, atMs: 50, bug: false }
      ]
    },
    images: [PNG, PNG],
    version: "v1",
    big: undefined
  };
}

beforeEach(() => {
  ctx = createCtx();
});

describe("keyBindings", () => {
  it("binds the backslash in Game to collapse or expand the Element panel", () => {
    localStorage.clear();
    const side = bindingOf(keyBindings(ctx), "\\");
    expect(side.workspace).toBe("game");
    side.run(new KeyboardEvent("keydown", { key: "\\" }));
    expect(sidePanelState("game.side").collapsed).toBe(true);
    side.run(new KeyboardEvent("keydown", { key: "\\" }));
    expect(sidePanelState("game.side").collapsed).toBe(false);
  });

  it("binds M in Game to the Sound switch, only when the game has game.mute (round 2b R11)", async () => {
    const sound = bindingOf(keyBindings(ctx), "m");
    expect(sound.workspace).toBe("game");
    expect(sound.when?.()).toBe(false);

    ctx.link.manifestValue = manifestOf([["game.mute", "cosmetic"]]);
    expect(sound.when?.()).toBe(true);
    sound.run(new KeyboardEvent("keydown", { key: "m" }));
    await flush();
    expect(ctx.panels.run).toHaveBeenCalledWith("game.mute", { muted: true });
  });

  it("binds ⇧⌘C and I globally to toggle the picker, which shows Game", () => {
    const pick = bindingOf(keyBindings(ctx), "i");
    expect(pick.keys).toEqual(["mod+shift+c", "i"]);
    expect(pick.workspace).toBeUndefined();
    expect(pick.when).toBeUndefined();

    pick.run(new KeyboardEvent("keydown", { key: "i" }));
    expect(ctx.state.picker.on).toBe(true);
    expect(ctx.workspace.show).toHaveBeenCalledWith("game");
  });

  it("binds ← → and B in Game only while the contact sheet is open", () => {
    const bindings = keyBindings(ctx);
    const next = bindingOf(bindings, "arrowright");
    const back = bindingOf(bindings, "arrowleft");
    const bug = bindingOf(bindings, "b");
    for (const binding of [next, back, bug]) {
      expect(binding.workspace).toBe("game");
      expect(binding.when?.()).toBe(false);
    }

    openSheetState();
    expect(next.when?.()).toBe(true);
    next.run(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    next.run(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(ctx.state.series.sheet?.big).toBe(1);
    back.run(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    expect(ctx.state.series.sheet?.big).toBe(0);
    bug.run(new KeyboardEvent("keydown", { key: "b" }));
    expect(ctx.state.series.sheet?.index.shots[0]?.bug).toBe(true);
  });

  it("B does nothing on the grid (no large view)", () => {
    openSheetState();
    bindingOf(keyBindings(ctx), "b").run(new KeyboardEvent("keydown", { key: "b" }));
    expect(ctx.state.series.sheet?.index.shots.map(shot => shot.bug)).toEqual([false, false]);
  });
});

describe("escapeClosers", () => {
  it("hands the layers in rank order: contactSheet, seriesPopover, captureCard, picker, selection", () => {
    expect(escapeClosers(ctx).map(closer => closer.layer)).toEqual([
      "contactSheet",
      "seriesPopover",
      "captureCard",
      "picker",
      "selection"
    ]);
  });

  it("every closer returns false when gameView has nothing open there", () => {
    ctx.workspace.activeValue = "game";
    expect(escapeClosers(ctx).map(closer => closer.close())).toEqual([
      false,
      false,
      false,
      false,
      false
    ]);
  });

  it("every closer closes its layer and returns true", () => {
    ctx.workspace.activeValue = "game";
    openSheetState();
    ctx.state.series.popover = true;
    ctx.state.card = { path: "a.png", frame: 1, device: "iPhone 15 portrait", image: PNG };
    ctx.state.picker.on = true;
    ctx.state.selected = COIN;

    expect(escapeClosers(ctx).map(closer => closer.close())).toEqual([
      true,
      true,
      true,
      true,
      true
    ]);
    expect(ctx.state.series.sheet).toBeUndefined();
    expect(ctx.state.series.popover).toBe(false);
    expect(ctx.state.card).toBeUndefined();
    expect(ctx.state.picker.on).toBe(false);
    expect(ctx.state.selected).toBeUndefined();
  });
});

describe("Esc on the selection layer (U10)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("clears the selected element in Game and publishes null", () => {
    ctx.workspace.activeValue = "game";
    ctx.state.selected = COIN;

    expect(selectionCloser().close()).toBe(true);
    expect(ctx.state.selected).toBeUndefined();
    expect(ctx.state.selection).toBeUndefined();
    expect(lastPublished()).toEqual(["selection", NOTHING]);
  });

  it("clears a published area selection", () => {
    ctx.workspace.activeValue = "game";
    ctx.state.selection = AREA;

    expect(selectionCloser().close()).toBe(true);
    expect(ctx.state.selection).toBeUndefined();
    expect(lastPublished()).toEqual(["selection", NOTHING]);
  });

  it("returns false and publishes nothing when nothing is selected", () => {
    ctx.workspace.activeValue = "game";
    expect(selectionCloser().close()).toBe(false);
    expect(ctx.link.notify).not.toHaveBeenCalled();
  });

  it("returns false outside the Game workspace and keeps the selection", () => {
    ctx.workspace.activeValue = "flow";
    ctx.state.selected = COIN;

    expect(selectionCloser().close()).toBe(false);
    expect(ctx.state.selected).toEqual(COIN);
    expect(ctx.link.notify).not.toHaveBeenCalled();
  });

  it.each([
    ["an input", "<input>"],
    ["a textarea", "<textarea></textarea>"],
    ["contenteditable", "<div contenteditable='true' tabindex='0'></div>"]
  ])("returns false while focus is in %s", (_, html) => {
    ctx.workspace.activeValue = "game";
    ctx.state.selected = COIN;
    document.body.innerHTML = html;
    (document.body.firstElementChild as HTMLElement).focus();

    expect(selectionCloser().close()).toBe(false);
    expect(ctx.state.selected).toEqual(COIN);
  });

  it("comes last: an open popover closes on the first Esc, the next Esc clears", () => {
    ctx.workspace.activeValue = "game";
    ctx.state.series.popover = true;
    ctx.state.selected = COIN;
    const closers: EscEntry[] = [];
    const workspace = { state: { keys: { escape: closers } } } as unknown as Pick<
      WorkspaceCtx,
      "state"
    >;
    for (const { layer, close } of escapeClosers(ctx)) {
      addEscapeLayer(workspace, layer, close);
    }

    expect(unwind(workspace)).toBe(true);
    expect(ctx.state.series.popover).toBe(false);
    expect(ctx.state.selected).toEqual(COIN);

    expect(unwind(workspace)).toBe(true);
    expect(ctx.state.selected).toBeUndefined();
    expect(lastPublished()).toEqual(["selection", NOTHING]);
    expect(unwind(workspace)).toBe(false);
  });
});

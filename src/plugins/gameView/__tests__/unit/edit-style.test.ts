// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SelectionInfo } from "../../../registry/protocol";
import {
  clearEdits,
  copyEdits,
  dropSessionEdits,
  editStyle,
  listEdits,
  resolveEdits
} from "../../element/edit-style";
import { selectElement } from "../../element/select";
import { onLinkStatus } from "../../handlers";
import { completePick } from "../../reference/pick";
import { readFreshScene } from "../../scene/read";
import { rebuildScene } from "../../scene/rebuild";
import { subscribe } from "../../state";
import type { ElementEdits } from "../../types";
import { stubCanvas } from "../canvas";
import { createCtx, DAY, JPEG, manifestOf, type TestCtx, TODAY, useScene } from "../helpers";
import { boardCaptureStyled, boardCaptureWith, boardScene, sceneOf } from "../ui";

// ─────────────────────────────────────────────────────────────────────────────
// Pending style edits (U8, D-67) on the state: editStyle records an edit of the
// selected element (`from` is the scene value), a new scene snapshot drops the
// edits it shows, a new session drops the entries kept by node id, clearEdits
// drops them on request, copyEdits puts the agent text on the clipboard. Every
// change of the selected element's edits publishes the selection again.
// ─────────────────────────────────────────────────────────────────────────────

const COIN = { kind: "ui", path: "boardScreen/hudRow/coinPill" } as const;
const HOME = { kind: "ui", path: "boardScreen/hudRow/home" } as const;

/** The coin pill without its ui key: the scene names it `row#1`. */
const BARE_ROW = { kind: "ui", path: "boardScreen/hudRow/row#1" } as const;

let ctx: TestCtx;

/**
 * Every value gameView published, in order.
 *
 * @returns The params of each `notify("selection", …)`.
 */
function published(): (SelectionInfo | null)[] {
  return ctx.link.notify.mock.calls.map(([, params]) => params);
}

/**
 * The edits kept for a key.
 *
 * @param key - The ui key or the node id.
 * @returns The entry.
 */
function kept(key: string): ElementEdits | undefined {
  return ctx.state.edits.get(key);
}

beforeEach(() => {
  vi.setSystemTime(TODAY);
  ctx = createCtx();
  useScene(ctx);
  ctx.state.scene = boardScene();
  selectElement(ctx, COIN);
  ctx.link.notify.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("editStyle", () => {
  it("the first edit takes `from` from the scene and files the element under its ui key", () => {
    const listener = vi.fn();
    subscribe(ctx.state, listener);
    editStyle(ctx, "width", 320);

    expect(kept("coinPill")).toEqual({
      label: "coinPill",
      byId: false,
      edits: [{ path: "width", from: 290, to: 320 }]
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("reads a nested value by its dotted path and a string as it is", () => {
    editStyle(ctx, "padding.left", 90);
    editStyle(ctx, "justify", "start");
    expect(kept("coinPill")?.edits).toEqual([
      { path: "padding.left", from: 84, to: 90 },
      { path: "justify", from: "center", to: "start" }
    ]);
  });

  it("names where the index says the element is written, when it answered", () => {
    ctx.state.found.set("coinPill", {
      kind: "defined",
      path: "src/hud/Hud.tsx",
      line: 12,
      range: [12, 1, 12, 40]
    });
    editStyle(ctx, "width", 320);
    expect(kept("coinPill")?.source).toEqual({ path: "src/hud/Hud.tsx", line: 12 });
  });

  it("a second edit of the path replaces `to` and keeps the first `from`", () => {
    editStyle(ctx, "width", 320);
    editStyle(ctx, "width", 340);
    expect(kept("coinPill")?.edits).toEqual([{ path: "width", from: 290, to: 340 }]);
  });

  it("a `to` equal to the scene value removes the edit; the last one removes the entry", () => {
    editStyle(ctx, "width", 320);
    editStyle(ctx, "height", 80);
    editStyle(ctx, "width", 290);
    expect(kept("coinPill")?.edits).toEqual([{ path: "height", from: 76, to: 80 }]);

    editStyle(ctx, "height", 76);
    expect(ctx.state.edits.size).toBe(0);
  });

  it("does nothing without a selection, for a node the scene lacks, or for a path that is no value", () => {
    const listener = vi.fn();
    subscribe(ctx.state, listener);
    editStyle(ctx, "padding", 4);
    editStyle(ctx, "nowhere", 4);
    editStyle(ctx, "width", 290);

    ctx.state.selected = { kind: "ui", path: "nowhere" };
    editStyle(ctx, "width", 320);
    ctx.state.selected = undefined;
    editStyle(ctx, "width", 320);

    expect(ctx.state.edits.size).toBe(0);
    expect(listener).not.toHaveBeenCalled();
    expect(published()).toEqual([]);
  });

  it("files an element without a ui key under its node id, labelled with its name", () => {
    ctx.state.scene = sceneOf(boardCaptureWith("coinPill", node => delete node.key));
    selectElement(ctx, BARE_ROW);
    editStyle(ctx, "width", 320);
    expect(kept("ui:boardScreen/hudRow/row#1")).toEqual({
      label: "row",
      byId: true,
      edits: [{ path: "width", from: 290, to: 320 }]
    });
  });
});

describe("the published selection follows the edits", () => {
  it("editStyle publishes the selection with `edits`; removing the last one publishes without", () => {
    editStyle(ctx, "width", 320);
    expect(published()).toHaveLength(1);
    expect(published()[0]).toMatchObject({
      ref: COIN,
      key: "coinPill",
      edits: [{ path: "width", from: 290, to: 320 }]
    });
    expect(ctx.state.selection).toEqual(published()[0]);

    editStyle(ctx, "width", 290);
    expect(published()).toHaveLength(2);
    expect(published()[1]).toMatchObject({ ref: COIN, key: "coinPill" });
    expect(published()[1]).not.toHaveProperty("edits");
  });

  it("selecting an element with edits publishes them; another element has none", () => {
    editStyle(ctx, "width", 320);
    selectElement(ctx, HOME);
    expect(published().at(-1)).not.toHaveProperty("edits");
    selectElement(ctx, COIN);
    expect(published().at(-1)?.edits).toEqual([{ path: "width", from: 290, to: 320 }]);
  });

  it("after a pick the card, the crop and the line stay; only the edits change", async () => {
    ctx.link.manifestValue = manifestOf([["editor.capture", "read"]]);
    ctx.panels.answers.set("editor.capture", {
      image: JPEG,
      frame: 1842,
      device: { w: 393, h: 852, orientation: "portrait" }
    });
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(() => Promise.resolve()) } });
    stubCanvas({ width: 1179, height: 2556 });
    const node = ctx.state.scene?.nodes.get("ui:boardScreen/hudRow/coinPill");
    if (node === undefined || ctx.state.scene === undefined) throw new Error("fixture");
    editStyle(ctx, "width", 320);
    const { info } = await completePick(ctx, node, ctx.state.scene);
    expect(info.edits).toEqual([{ path: "width", from: 290, to: 320 }]);

    editStyle(ctx, "height", 80);
    expect(published().at(-1)).toMatchObject({
      card: `${DAY}/coinPill-f1842.md`,
      crop: `${DAY}/coinPill-f1842-crop.jpg`,
      line: info.line,
      frame: 1842,
      edits: [
        { path: "width", from: 290, to: 320 },
        { path: "height", from: 76, to: 80 }
      ]
    });

    clearEdits(ctx);
    expect(published().at(-1)).toMatchObject({ card: `${DAY}/coinPill-f1842.md`, line: info.line });
    expect(published().at(-1)).not.toHaveProperty("edits");
  });
});

describe("listEdits", () => {
  it("lists every element, the selected one first; a copy of the list", () => {
    editStyle(ctx, "width", 320);
    selectElement(ctx, HOME);
    editStyle(ctx, "radius", 40);
    expect(listEdits(ctx).map(entry => entry.label)).toEqual(["home", "coinPill"]);

    selectElement(ctx, COIN);
    expect(listEdits(ctx).map(entry => entry.label)).toEqual(["coinPill", "home"]);
    selectElement(ctx, undefined);
    expect(listEdits(ctx).map(entry => entry.label)).toEqual(["coinPill", "home"]);
    expect(listEdits(ctx)).not.toBe(listEdits(ctx));
  });

  it("names the source the index answered since the edit was made", () => {
    editStyle(ctx, "width", 320);
    expect(listEdits(ctx)[0]).not.toHaveProperty("source");
    ctx.state.found.set("coinPill", {
      kind: "defined",
      path: "src/hud/Hud.tsx",
      line: 14,
      range: [14, 1, 14, 40]
    });
    expect(listEdits(ctx)[0]?.source).toEqual({ path: "src/hud/Hud.tsx", line: 14 });
  });
});

describe("clearEdits", () => {
  beforeEach(() => {
    editStyle(ctx, "width", 320);
    selectElement(ctx, HOME);
    editStyle(ctx, "radius", 40);
    ctx.link.notify.mockClear();
  });

  it('"selected" drops the edits of the selected element and publishes it without them', () => {
    clearEdits(ctx, "selected");
    expect([...ctx.state.edits.keys()]).toEqual(["coinPill"]);
    expect(published()).toHaveLength(1);
    expect(published()[0]).toMatchObject({ ref: HOME });
    expect(published()[0]).not.toHaveProperty("edits");

    clearEdits(ctx, "selected");
    expect(published()).toHaveLength(1);
  });

  it('"all" is the default: every edit goes', () => {
    const listener = vi.fn();
    subscribe(ctx.state, listener);
    clearEdits(ctx);
    expect(ctx.state.edits.size).toBe(0);
    expect(published()).toHaveLength(1);
    expect(listener).toHaveBeenCalledTimes(1);

    clearEdits(ctx, "all");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('"all" publishes nothing when the selected element had no edits', () => {
    selectElement(ctx, { kind: "ui", path: "boardScreen/hudRow/settings" });
    ctx.link.notify.mockClear();
    clearEdits(ctx);
    expect(ctx.state.edits.size).toBe(0);
    expect(published()).toEqual([]);
  });

  it('"selected" without a selection does nothing', () => {
    selectElement(ctx, undefined);
    clearEdits(ctx, "selected");
    expect(ctx.state.edits.size).toBe(2);
  });
});

describe("copyEdits", () => {
  it("puts the agent text on the clipboard, toasts the count and answers the text", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    ctx.state.found.set("coinPill", {
      kind: "defined",
      path: "src/hud/Hud.tsx",
      line: 12,
      range: [12, 1, 12, 40]
    });
    editStyle(ctx, "width", 320);
    editStyle(ctx, "padding.left", 90);

    const text = await copyEdits(ctx);
    expect(text).toBe(
      "@moku coinPill · src/hud/Hud.tsx:12\nwidth: 290 -> 320\npadding.left: 84 -> 90"
    );
    expect(writeText).toHaveBeenCalledWith(text);
    expect(ctx.workspace.toast).toHaveBeenCalledWith("✓ 2 edits copied");
  });

  it("says 1 edit for one; the selected element's block comes first", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    editStyle(ctx, "width", 320);
    expect(await copyEdits(ctx)).toBe("@moku coinPill\nwidth: 290 -> 320");
    expect(ctx.workspace.toast).toHaveBeenCalledWith("✓ 1 edit copied");

    selectElement(ctx, HOME);
    editStyle(ctx, "radius", 40);
    expect(await copyEdits(ctx)).toBe(
      "@moku home\nradius: 60 -> 40\n\n@moku coinPill\nwidth: 290 -> 320"
    );
  });

  it("is undefined without edits: nothing on the clipboard, no toast", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await copyEdits(ctx)).toBeUndefined();
    expect(writeText).not.toHaveBeenCalled();
    expect(ctx.workspace.toast).not.toHaveBeenCalled();
  });

  it("is undefined when the clipboard refuses; the refusal is toasted", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: () => Promise.reject(new Error("Document is not focused.")) }
    });
    editStyle(ctx, "width", 320);
    expect(await copyEdits(ctx)).toBeUndefined();
    expect(ctx.workspace.toast).toHaveBeenCalledWith("Copy failed · Document is not focused.");
  });
});

describe("an edit resolves itself on a new scene snapshot", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    editStyle(ctx, "width", 320);
    editStyle(ctx, "padding.left", 90);
    ctx.link.notify.mockClear();
  });

  it("a rebuilt scene whose value equals `to` drops that edit and publishes the selection again", () => {
    const next = boardCaptureStyled("coinPill", { width: 320 });
    ctx.state.sources = { ui: next.ui, entities: next.entities, projections: next.projections };
    rebuildScene(ctx, 1850);

    expect(kept("coinPill")?.edits).toEqual([{ path: "padding.left", from: 84, to: 90 }]);
    expect(published()).toHaveLength(1);
    expect(published()[0]?.edits).toEqual([{ path: "padding.left", from: 84, to: 90 }]);
  });

  it("the last edit resolved deletes the entry; the next published selection has no edits", () => {
    const next = boardCaptureStyled("coinPill", { width: 320, padding: { right: 24, left: 90 } });
    ctx.state.sources = { ui: next.ui, entities: next.entities, projections: next.projections };
    rebuildScene(ctx, 1850);

    expect(ctx.state.edits.size).toBe(0);
    expect(published()).toHaveLength(1);
    expect(published()[0]).toMatchObject({ ref: COIN, frame: 1850 });
    expect(published()[0]).not.toHaveProperty("edits");
  });

  it("a scene read once more (a picker click, scene() outside Game) resolves too", async () => {
    const next = boardCaptureStyled("coinPill", { width: 320 });
    useScene(ctx, next);
    await readFreshScene(ctx);
    expect(kept("coinPill")?.edits).toEqual([{ path: "padding.left", from: 84, to: 90 }]);
  });

  it("a scene with other values keeps the edits and publishes nothing", () => {
    const next = boardCaptureStyled("coinPill", { width: 300 });
    ctx.state.sources = { ui: next.ui, entities: next.entities, projections: next.projections };
    rebuildScene(ctx, 1850);
    expect(kept("coinPill")?.edits).toHaveLength(2);
    expect(published()).toEqual([]);
  });

  it("an element that is not in the scene keeps its edits; another element resolves without a publish", () => {
    selectElement(ctx, HOME);
    ctx.link.notify.mockClear();
    resolveEdits(ctx, sceneOf(boardCaptureWith("coinPill", node => delete node.key)));
    expect(kept("coinPill")?.edits).toHaveLength(2);

    resolveEdits(ctx, sceneOf(boardCaptureStyled("coinPill", { width: 320 })));
    expect(kept("coinPill")?.edits).toHaveLength(1);
    expect(published()).toEqual([]);
  });

  it("two keyed elements both resolve against one snapshot", () => {
    selectElement(ctx, HOME);
    editStyle(ctx, "radius", 40);
    ctx.link.notify.mockClear();
    const scene = sceneOf(boardCaptureStyled("coinPill", { width: 320 }));
    const home = scene.nodes.get("ui:boardScreen/hudRow/home");
    if (home === undefined) throw new Error("fixture");
    const nodes = new Map(scene.nodes).set("ui:boardScreen/hudRow/home", {
      ...home,
      style: { ...home.style, radius: 40 }
    });

    resolveEdits(ctx, { ...scene, nodes });

    expect(kept("coinPill")?.edits).toEqual([{ path: "padding.left", from: 84, to: 90 }]);
    expect(kept("home")).toBeUndefined();
    expect(published()).toHaveLength(1);
    expect(published()[0]).toMatchObject({ ref: HOME });
    expect(published()[0]).not.toHaveProperty("edits");
  });
});

describe("a game reload", () => {
  it("drops the entries kept by node id and keeps the keyed ones", () => {
    editStyle(ctx, "width", 320);
    ctx.state.scene = sceneOf(boardCaptureWith("home", node => delete node.key));
    selectElement(ctx, { kind: "ui", path: "boardScreen/hudRow/button#0" });
    editStyle(ctx, "radius", 40);
    expect([...ctx.state.edits.keys()]).toEqual(["coinPill", "ui:boardScreen/hudRow/button#0"]);
    ctx.link.notify.mockClear();

    const hook = onLinkStatus(ctx);
    hook({ status: { kind: "live", frame: 1 }, session: "s-1" });
    expect(ctx.state.edits.size).toBe(2);
    hook({ status: { kind: "live", frame: 2 }, session: "s-2" });

    expect([...ctx.state.edits.keys()]).toEqual(["coinPill"]);
    // The selected element lost its edits: the selection is published without them.
    expect(published()).toHaveLength(1);
    expect(published()[0]).not.toHaveProperty("edits");
  });

  it("publishes nothing when the selected element keeps its edits", () => {
    editStyle(ctx, "width", 320);
    ctx.state.edits.set("entity:7", {
      label: "i7",
      byId: true,
      edits: [{ path: "alpha", from: 1, to: 0.5 }]
    });
    ctx.link.notify.mockClear();
    dropSessionEdits(ctx);
    expect([...ctx.state.edits.keys()]).toEqual(["coinPill"]);
    expect(published()).toEqual([]);
  });
});

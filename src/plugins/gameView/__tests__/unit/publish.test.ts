// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SelectionInfo } from "../../../registry/protocol";
import { pickAt, pickProxy, selectElement } from "../../element/select";
import { completePick } from "../../reference/pick";
import { stubCanvas } from "../canvas";
import { createCtx, flush, JPEG, manifestOf, type TestCtx, useScene } from "../helpers";
import { boardScene } from "../ui";

// ─────────────────────────────────────────────────────────────────────────────
// The editor page publishes its selection (U4, D-33): every change of
// state.selected sends a SelectionInfo through link.notify("selection", …),
// null when nothing is selected; first without the source while its search
// runs, then again with it. A completed pick publishes its card, crop and line.
// ─────────────────────────────────────────────────────────────────────────────

const COIN = { kind: "ui", path: "boardScreen/hudRow/coinPill" } as const;

/** The source file of the coin pill. */
const HUD = { "src/hud/Hud.tsx": '<Pill key="coinPill" style={coinPill} />\n' };

let ctx: TestCtx;

/**
 * Every value gameView published, in order.
 *
 * @returns The params of each `notify("selection", …)`.
 */
function published(): (SelectionInfo | null)[] {
  return ctx.link.notify.mock.calls.map(([, params]) => params);
}

beforeEach(() => {
  ctx = createCtx(HUD);
  useScene(ctx);
  ctx.state.scene = boardScene();
  ctx.state.sources = { projections: { hud: { coinPill: 1, boardScreen: 2 } } };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("selectElement publishes", () => {
  it("the selected node at once, then again with its source when the search found it", async () => {
    selectElement(ctx, COIN);
    expect(ctx.link.notify).toHaveBeenCalledTimes(1);
    expect(ctx.link.notify.mock.calls[0]?.[0]).toBe("selection");
    expect(published()[0]).toEqual({
      ref: COIN,
      key: "coinPill",
      projection: "hud",
      name: "coinPill",
      type: "row",
      rect: { x: 235, y: 74, w: 290, h: 76 },
      session: "s-1",
      frame: 1841,
      at: expect.any(Number)
    });

    await flush();
    expect(published()).toHaveLength(2);
    expect(published()[1]).toMatchObject({
      key: "coinPill",
      source: { path: "src/hud/Hud.tsx", line: 1 }
    });
    expect(ctx.state.selection).toEqual(published()[1]);
  });

  it("a source found before goes out with the first publish, and once", async () => {
    ctx.state.found.set("coinPill", { kind: "defined", path: "src/a.tsx", line: 9 });
    selectElement(ctx, COIN);
    await flush();
    expect(published()).toHaveLength(1);
    expect(published()[0]?.source).toEqual({ path: "src/a.tsx", line: 9 });
  });

  it("null when the selection is cleared; a late source of the old one is dropped", async () => {
    selectElement(ctx, COIN);
    selectElement(ctx, undefined);
    await flush();
    expect(published()).toHaveLength(2);
    expect(published()[1]).toBeNull();
    expect(ctx.state.selection).toBeUndefined();
  });

  it("a key no file names publishes once; an entity needs no search", async () => {
    selectElement(ctx, { kind: "ui", path: "boardScreen/hudRow/energyPill" });
    selectElement(ctx, { kind: "entity", id: 1_048_628 });
    await flush();
    expect(published().map(info => info?.name)).toEqual(["energyPill", "i1"]);
  });

  it("a ref the scene does not have is published bare", () => {
    ctx.state.scene = undefined;
    selectElement(ctx, COIN);
    expect(published()[0]).toEqual({
      ref: COIN,
      name: "coinPill",
      type: "ui",
      session: "s-1",
      at: expect.any(Number)
    });
  });

  it("a publish that fails is a warning; the selection is made all the same", () => {
    ctx.link.notify.mockImplementation(() => {
      throw new Error("[moku-editor] not json");
    });
    selectElement(ctx, COIN);
    expect(ctx.state.selected).toEqual(COIN);
    expect(ctx.log.warn).toHaveBeenCalledWith("gameView: selection publish failed", {
      message: "[moku-editor] not json"
    });
  });

  it("a failed source search keeps the first publish and logs at debug", async () => {
    vi.spyOn(ctx.link.api, "manifest").mockImplementation(() => {
      throw new Error("[moku-editor] no manifest");
    });
    selectElement(ctx, COIN);
    await flush();
    expect(published()).toHaveLength(1);
    expect(ctx.log.debug).toHaveBeenCalledWith("gameView: selection source failed", {
      message: "[moku-editor] no manifest"
    });
  });
});

describe("a pick publishes its card, crop and line", () => {
  beforeEach(() => {
    ctx.link.manifestValue = manifestOf([
      ["game.bookmark", "read"],
      ["editor.capture", "read"]
    ]);
    ctx.panels.answers.set("editor.capture", {
      image: JPEG,
      frame: 1842,
      device: { w: 393, h: 852, orientation: "portrait" }
    });
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(() => Promise.resolve()) } });
    stubCanvas({ width: 1179, height: 2556 });
  });

  it("a proxy click: the element first, the pick last with its files and frame", async () => {
    await pickProxy(ctx, "ui:boardScreen/hudRow/coinPill");
    const last = published().at(-1);
    expect(published()[0]?.card).toBeUndefined();
    expect(last).toMatchObject({
      ref: COIN,
      source: { path: "src/hud/Hud.tsx", line: 1 },
      card: ".moku/captures/coinPill-f1842.md",
      crop: ".moku/captures/coinPill-f1842-crop.jpg",
      line: expect.stringMatching(/^@moku coinPill row · /),
      frame: 1842
    });
    expect(ctx.state.selection).toEqual(last);
  });

  it("a picker click publishes the same way", async () => {
    ctx.workspace.box = { left: 0, top: 0, width: 1080, height: 1440, scale: 1, docked: "stage" };
    ctx.state.picker.on = true;
    await pickAt(ctx, { x: 540, y: 990 });
    expect(published().at(-1)).toMatchObject({
      ref: { kind: "entity", id: 1_048_628 },
      card: ".moku/captures/i1-f1842.md",
      frame: 1842
    });
  });

  it("a pick of a node that is no longer selected publishes nothing", async () => {
    selectElement(ctx, { kind: "entity", id: 1_048_628 });
    await flush();
    const before = published().length;
    const node = ctx.state.scene?.nodes.get("ui:boardScreen/hudRow/coinPill");
    if (node === undefined || ctx.state.scene === undefined) throw new Error("fixture");
    const result = await completePick(ctx, node, ctx.state.scene);
    expect(published()).toHaveLength(before);
    expect(result.info.card).toBe(".moku/captures/coinPill-f1842.md");
  });
});

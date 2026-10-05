// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SelectParams } from "../../../registry/protocol";
import { answerSelect } from "../../element/select-request";
import { initGameView, stopGameView } from "../../lifecycle";
import { stubCanvas } from "../canvas";
import { createCtx, JPEG, manifestOf, type TestCtx, useScene } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// MCP moku_select reaches the editor page as the editor-channel request
// `select` (U4, D-33): gameView finds the element by key (projection-qualified
// too) or by ref on a fresh scene, inspects it (Game, Element tab), completes
// the pick without the clipboard when `card` is not false, and answers its
// SelectionInfo. A rect wins and picks an area (U9). Not found → -32602.
// ─────────────────────────────────────────────────────────────────────────────

let ctx: TestCtx;
let writeText: ReturnType<typeof vi.fn>;

/**
 * The params of a select, as link checked them.
 *
 * @param params - The fields.
 * @returns The params.
 */
function select(params: SelectParams): ReturnType<typeof answerSelect> {
  return answerSelect(ctx, params);
}

beforeEach(() => {
  ctx = createCtx();
  useScene(ctx);
  ctx.link.manifestValue = manifestOf(
    [
      ["game.bookmark", "read"],
      ["editor.capture", "read"]
    ],
    ["game.rect"]
  );
  ctx.panels.answers.set("editor.capture", {
    image: JPEG,
    frame: 1842,
    device: { w: 393, h: 852, orientation: "portrait" }
  });
  writeText = vi.fn(() => Promise.resolve());
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  stubCanvas({ width: 1179, height: 2556 });
});

afterEach(() => {
  stopGameView(ctx);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("answerSelect by key", () => {
  it("reads a fresh scene, inspects the element and completes the pick without the clipboard", async () => {
    ctx.state.tab = "device";
    const info = await select({ key: "coinPill" });

    expect(ctx.link.read).toHaveBeenCalledWith("game.ui");
    expect(ctx.state.selected).toEqual({ kind: "ui", path: "boardScreen/hudRow/coinPill" });
    expect(ctx.state.tab).toBe("element");
    expect(ctx.workspace.show).toHaveBeenCalledWith("game");
    expect(writeText).not.toHaveBeenCalled();
    expect(ctx.state.card?.reference).toBe(info.line);
    expect(info).toMatchObject({
      ref: { kind: "ui", path: "boardScreen/hudRow/coinPill" },
      key: "coinPill",
      projection: "hud",
      name: "coinPill",
      type: "row",
      card: ".moku/captures/coinPill-f1842.md",
      crop: ".moku/captures/coinPill-f1842-crop.jpg",
      frame: 1842
    });
    expect(ctx.state.selection).toEqual(info);
  });

  it("takes a projection-qualified key; card false selects without a pick", async () => {
    const info = await select({ key: "hud/infoBar", card: false });
    expect(ctx.panels.run).not.toHaveBeenCalled();
    expect(info).toMatchObject({ key: "infoBar", projection: "hud", frame: 1841 });
    expect(info.card).toBeUndefined();
    expect(ctx.state.selected).toEqual({ kind: "ui", path: "boardScreen/infoBar" });
  });

  it("answers -32602 No element with key <key> when no ui node has it", async () => {
    await expect(select({ key: "hud/nowhere" })).rejects.toMatchObject({
      code: -32_602,
      message: expect.stringMatching(/^\[moku-editor\] No element with key hud\/nowhere\./),
      data: { reason: "invalid_input", field: "key", retryable: false }
    });
    expect(ctx.state.selected).toBeUndefined();
  });
});

describe("answerSelect by ref", () => {
  it("selects an entity by id", async () => {
    const info = await select({ ref: { kind: "entity", id: 1_048_628 }, card: false });
    expect(info).toMatchObject({ name: "i1", type: "Sprite", projection: "board.items" });
  });

  it("answers -32602 for a ref not in the scene, and for the empty ref of an empty area", async () => {
    await expect(select({ ref: { kind: "ui", path: "nowhere" } })).rejects.toMatchObject({
      code: -32_602,
      message: expect.stringMatching(/^\[moku-editor\] No element with ref ui:nowhere\./)
    });
    await expect(select({ ref: { kind: "ui", path: "" } })).rejects.toMatchObject({
      code: -32_602,
      message: expect.stringMatching(/^\[moku-editor\] area selection has no element\./)
    });
  });

  it("answers -32602 without a key, a ref or a rect", async () => {
    await expect(select({ card: true })).rejects.toMatchObject({
      code: -32_602,
      message: expect.stringMatching(/needs a key, a ref or a rect/)
    });
  });

  it("passes the link's error when no game answers the scene", async () => {
    ctx.link.values.delete("game.ui");
    await expect(select({ key: "infoBar" })).rejects.toThrow("no value for game.ui");
  });
});

describe("answerSelect by rect (U9)", () => {
  it("the rect wins over key and ref: the elements in the area, the area card", async () => {
    const info = await select({ rect: { x: 30, y: 45, w: 520, h: 135 }, key: "infoBar" });
    expect(ctx.workspace.show).toHaveBeenCalledWith("game");
    expect(info).toMatchObject({
      name: "area",
      type: "area",
      area: { x: 30, y: 45, w: 520, h: 135 },
      card: ".moku/captures/area-f1842.md",
      crop: ".moku/captures/area-f1842-crop.jpg"
    });
    expect(info.items?.map(item => item.key)).toEqual(["home", "coinPill"]);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("card false: the area without a card", async () => {
    const info = await select({ rect: { x: 30, y: 45, w: 520, h: 135 }, card: false });
    expect(ctx.panels.run).not.toHaveBeenCalled();
    expect(info.card).toBeUndefined();
    expect(info.items).toHaveLength(2);
  });
});

describe("the select handler of link", () => {
  it("onInit adds it; it answers; stop removes it", async () => {
    initGameView(ctx);
    expect(ctx.link.handle).toHaveBeenCalledWith("select", expect.any(Function));
    const handler = ctx.link.handle.mock.calls[0]?.[1];
    const info = await handler?.({ key: "infoBar", card: false });
    expect(info?.key).toBe("infoBar");

    const remove = ctx.link.handle.mock.results[0]?.value;
    stopGameView(ctx);
    expect(remove).toHaveBeenCalledTimes(1);
  });
});

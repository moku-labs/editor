// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SceneNode } from "../../../panels/shared/scene";
import type { Json, RunResult } from "../../../registry/protocol";
import { pickAt, pickProxy } from "../../element/select";
import { completePick, listBookmarks, pickToast } from "../../reference/pick";
import { CROP_JPEG, stubCanvas } from "../canvas";
import { createCtx, JPEG, manifestOf, PNG, type TestCtx, useScene } from "../helpers";
import { boardScene } from "../ui";

// ─────────────────────────────────────────────────────────────────────────────
// A completed pick (round 2 R2): game.bookmark (kept, newest first, 20 at
// most), editor.capture, the crop and the full frame under capturesDir, the
// card file with the full block (round 2b R13), then one reference line on the
// clipboard with one toast. A game without a command or a failing step leaves
// its lines and its toast word out.
// ─────────────────────────────────────────────────────────────────────────────

/** The commands of a game that can bookmark and capture. */
const COMMANDS: readonly (readonly [string, "read" | "cosmetic" | "cheat"])[] = [
  ["game.bookmark", "read"],
  ["editor.capture", "read"],
  ["editor.series", "read"],
  ["editor.seriesStop", "read"]
];

/** The bookmark value merge-game answers on the board. */
const BOOKMARK: Json = { path: "board/awaitIntent", state: { coins: 40 } };

let ctx: TestCtx;
let writeText: ReturnType<typeof vi.fn>;

/**
 * A run result with a frame and the tainted flag.
 *
 * @param value - The value.
 * @param frame - The frame of the state.
 * @param tainted - The tainted flag.
 * @returns The result.
 */
function ran(value: Json, frame: number, tainted = false): Promise<RunResult> {
  return Promise.resolve({ value, state: { path: "board/awaitIntent", frame, tainted } });
}

/**
 * The coin pill of the board scene.
 *
 * @returns The node.
 */
function coinPill(): SceneNode {
  const node = ctx.state.scene?.nodes.get("ui:boardScreen/hudRow/coinPill");
  if (node === undefined) throw new Error("fixture");
  return node;
}

beforeEach(() => {
  ctx = createCtx();
  useScene(ctx);
  ctx.state.scene = boardScene();
  ctx.link.manifestValue = manifestOf(COMMANDS);
  ctx.link.values.set("game.history", [
    { path: "home", outcome: "play", frame: 1700 },
    { path: "board/merge", outcome: "merged", frame: 1830 }
  ]);
  ctx.panels.answers.set("game.bookmark", () => ran(BOOKMARK, 1841, true));
  ctx.panels.answers.set("editor.capture", () =>
    ran({ image: JPEG, frame: 1842, device: { w: 393, h: 852, orientation: "portrait" } }, 1842)
  );
  writeText = vi.fn(() => Promise.resolve());
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  stubCanvas({ width: 1179, height: 2556 });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("completePick", () => {
  it("bookmarks, saves the crop, the full frame and the card, copies one line and toasts", async () => {
    const { block: text } = await completePick(ctx, coinPill(), boardScene());

    expect(ctx.panels.run.mock.calls.map(call => call[0])).toEqual([
      "game.bookmark",
      "editor.capture"
    ]);
    expect(ctx.link.files.dataUrl(".moku/captures/coinPill-f1842-crop.jpg")).toBe(CROP_JPEG);
    expect(ctx.link.files.dataUrl(".moku/captures/f1842-full.jpg")).toBe(JPEG);
    const card = ctx.link.files.text(".moku/captures/coinPill-f1842.md");
    expect(card).toContain(`\`\`\`text\n${text}\n\`\`\``);
    expect(card).toContain("![element](coinPill-f1842-crop.jpg)\n![frame](f1842-full.jpg)\n");
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(String(writeText.mock.calls[0]?.at(0))).toMatch(
      /^@moku coinPill row · board\/awaitIntent · ref \d+,\d+ \d+×\d+ · \.moku\/captures\/coinPill-f1842\.md$/
    );
    expect(ctx.workspace.toast).toHaveBeenCalledWith("Reference, shot and bookmark copied");
    // The capture card of the pick (round 2b R14): the crop, and its Reference line.
    expect(ctx.state.card).toMatchObject({
      path: ".moku/captures/coinPill-f1842-crop.jpg",
      frame: 1842,
      device: "iPhone 15 portrait",
      image: CROP_JPEG,
      reference: String(writeText.mock.calls[0]?.at(0))
    });

    const lines = text.split("\n");
    expect(lines[0]).toBe("@moku coinPill · row · board/awaitIntent · f1842");
    expect(lines).toContain("flow: board > awaitIntent · last: board/merge → merged (f1830)");
    expect(lines).toContain("restore: bookmark coinPill-f1841");
    expect(lines).toContain(
      "shot: .moku/captures/coinPill-f1842-crop.jpg · frame: .moku/captures/f1842-full.jpg"
    );
    expect(lines.find(entry => entry.startsWith("game: "))).toMatch(
      /^game: merge-game 0\.0\.0 · s-1 · f1842 · \d\d:\d\d:\d\d · live · tainted$/
    );
    expect(lines).toContain("device: iPhone 15 393×852 portrait · dpr 3 · safe 59/0/34/0");
  });

  it("keeps the bookmark with its value, newest first, at most 20", async () => {
    await completePick(ctx, coinPill(), boardScene());
    expect(listBookmarks(ctx)).toEqual([
      {
        id: "coinPill-f1841",
        frame: 1841,
        key: "coinPill",
        at: expect.any(Number),
        value: BOOKMARK
      }
    ]);

    for (let index = 0; index < 21; index += 1) await completePick(ctx, coinPill(), boardScene());
    // The id is free among the kept bookmarks: the oldest dropped, its id comes back.
    const ids = listBookmarks(ctx).map(entry => entry.id);
    expect(ids).toHaveLength(20);
    expect(ids[0]).toBe("coinPill-f1841");
    expect(ids[1]).toBe("coinPill-f1841-21");
    expect(ids.at(-1)).toBe("coinPill-f1841-3");
    expect(listBookmarks(ctx)).not.toBe(ctx.state.bookmarks);
  });

  it("names the next files of the same frame -2", async () => {
    await completePick(ctx, coinPill(), boardScene());
    await completePick(ctx, coinPill(), boardScene());
    expect(
      ctx.link.files
        .paths()
        .filter(path => path.startsWith(".moku/captures/"))
        .toSorted()
    ).toEqual([
      ".moku/captures/coinPill-f1842-2-crop.jpg",
      ".moku/captures/coinPill-f1842-2.md",
      ".moku/captures/coinPill-f1842-crop.jpg",
      ".moku/captures/coinPill-f1842.md",
      ".moku/captures/f1842-2-full.jpg",
      ".moku/captures/f1842-full.jpg"
    ]);
  });

  it("names an entity's files and bookmark by its node name", async () => {
    const item = boardScene().nodes.get("entity:1048628");
    if (item === undefined) throw new Error("fixture");
    await completePick(ctx, item, boardScene());
    expect(listBookmarks(ctx)[0]?.id).toBe(`${item.name.replaceAll(/[^\w-]+/g, "-")}-f1841`);
  });

  it("without game.bookmark: no bookmark, no restore line, the toast says shot only", async () => {
    ctx.link.manifestValue = manifestOf(COMMANDS.filter(([id]) => id !== "game.bookmark"));
    const { block: text } = await completePick(ctx, coinPill(), boardScene());
    expect(ctx.panels.run.mock.calls.map(call => call[0])).toEqual(["editor.capture"]);
    expect(text).not.toContain("restore:");
    expect(ctx.workspace.toast).toHaveBeenCalledWith("Reference and shot copied");
  });

  it("without editor.capture: no pictures, no shot line, the toast says bookmark only", async () => {
    ctx.link.manifestValue = manifestOf(COMMANDS.filter(([id]) => id !== "editor.capture"));
    const { block: text } = await completePick(ctx, coinPill(), boardScene());
    expect(ctx.state.card).toBeUndefined();
    expect(ctx.link.files.paths()).toEqual([".moku/captures/coinPill-f1841.md"]);
    expect(ctx.link.files.text(".moku/captures/coinPill-f1841.md")).not.toContain("![");
    expect(text).not.toContain("shot:");
    expect(text.split("\n")[0]).toBe("@moku coinPill · row · board/awaitIntent · f1841");
    expect(ctx.workspace.toast).toHaveBeenCalledWith("Reference and bookmark copied");
  });

  it("logs a failed bookmark and a capture without a picture; the reference is copied all the same", async () => {
    ctx.panels.answers.set("game.bookmark", { code: -32_000, message: "[moku-editor] refused" });
    ctx.panels.answers.set("editor.capture", {});
    const { block: text } = await completePick(ctx, coinPill(), boardScene());
    expect(ctx.log.warn).toHaveBeenCalledWith("gameView: pick bookmark failed", {
      message: "[moku-editor] refused"
    });
    expect(ctx.log.warn).toHaveBeenCalledWith("gameView: pick shot failed", {
      message: "[moku-editor] editor.capture returned no image.\n  Update the game's capturePlugin."
    });
    expect(text.split("\n")[0]).toBe("@moku coinPill · row · board/awaitIntent · f1841");
    expect(ctx.workspace.toast).toHaveBeenCalledWith("Reference copied");
    expect(listBookmarks(ctx)).toEqual([]);
  });

  it("saves the full frame without a crop when the crop fails or the scene is not calibrated", async () => {
    vi.spyOn(HTMLImageElement.prototype, "decode").mockRejectedValue(new Error("broken image"));
    const { block: text } = await completePick(ctx, coinPill(), boardScene());
    expect(ctx.log.warn).toHaveBeenCalledWith("gameView: pick crop failed", {
      message: "broken image"
    });
    expect(text.split("\n").at(-1)).toBe("frame: .moku/captures/f1842-full.jpg");
    const pictures = (): string[] => ctx.link.files.paths().filter(path => path.endsWith(".jpg"));
    expect(pictures()).toEqual([".moku/captures/f1842-full.jpg"]);

    const uncalibrated = { ...boardScene(), calibrated: false };
    await completePick(ctx, coinPill(), uncalibrated);
    expect(pictures().some(path => path.includes("-crop."))).toBe(false);
  });

  it("toasts a clipboard that refuses and still keeps the pick", async () => {
    writeText.mockRejectedValue(new Error("Document is not focused."));
    await completePick(ctx, coinPill(), boardScene());
    expect(ctx.workspace.toast).toHaveBeenCalledWith("Copy failed · Document is not focused.");
    expect(ctx.state.pick).toMatchObject({
      nodeId: "ui:boardScreen/hudRow/coinPill",
      frame: 1842,
      bookmark: "coinPill-f1841",
      crop: ".moku/captures/coinPill-f1842-crop.jpg",
      full: ".moku/captures/f1842-full.jpg",
      tainted: true
    });
  });
});

describe("completePick contract (A8, A19)", () => {
  it("returns the block, the line, the card, the crop, the full frame, the frame and the selection", async () => {
    const result = await completePick(ctx, coinPill(), boardScene());
    expect(result).toMatchObject({
      line: String(writeText.mock.calls[0]?.at(0)),
      card: ".moku/captures/coinPill-f1842.md",
      crop: ".moku/captures/coinPill-f1842-crop.jpg",
      full: ".moku/captures/f1842-full.jpg",
      frame: 1842
    });
    expect(result.block.split("\n")[0]).toBe("@moku coinPill · row · board/awaitIntent · f1842");
    expect(result.info).toMatchObject({
      ref: { kind: "ui", path: "boardScreen/hudRow/coinPill" },
      key: "coinPill",
      name: "coinPill",
      type: "row",
      card: ".moku/captures/coinPill-f1842.md",
      crop: ".moku/captures/coinPill-f1842-crop.jpg",
      line: result.line,
      session: "s-1",
      frame: 1842
    });
  });

  it("copy false (MCP select): nothing on the clipboard, no toast, the capture card still shows", async () => {
    const result = await completePick(ctx, coinPill(), boardScene(), { copy: false });
    expect(writeText).not.toHaveBeenCalled();
    expect(ctx.workspace.toast).not.toHaveBeenCalled();
    expect(ctx.state.card).toMatchObject({ path: result.crop, reference: result.line });
  });

  it("names the full frame after the picture the game answered: a PNG stays .png", async () => {
    ctx.panels.answers.set("editor.capture", () =>
      ran({ image: PNG, frame: 1842, device: { w: 393, h: 852, orientation: "portrait" } }, 1842)
    );
    const result = await completePick(ctx, coinPill(), boardScene());
    expect(result.full).toBe(".moku/captures/f1842-full.png");
    expect(ctx.link.files.dataUrl(".moku/captures/f1842-full.png")).toBe(PNG);
    expect(result.crop).toBe(".moku/captures/coinPill-f1842-crop.jpg");
  });
});

describe("the card file of a pick (round 2b R13)", () => {
  it("copies the line without a card path when the card cannot be written", async () => {
    ctx.link.files.failWrites(
      ".moku/captures/coinPill-f1842.md",
      Object.assign(new Error("[moku-editor] disk full"), { code: -32_000 })
    );
    await completePick(ctx, coinPill(), boardScene());
    expect(ctx.log.warn).toHaveBeenCalledWith("gameView: reference card failed", {
      message: "[moku-editor] disk full"
    });
    expect(String(writeText.mock.calls[0]?.at(0))).not.toContain(".md");
  });
});

describe("pickToast", () => {
  it("names what went on the clipboard besides the reference", () => {
    expect(pickToast(true, true)).toBe("Reference, shot and bookmark copied");
    expect(pickToast(true, false)).toBe("Reference and shot copied");
    expect(pickToast(false, true)).toBe("Reference and bookmark copied");
    expect(pickToast(false, false)).toBe("Reference copied");
  });
});

describe("the two ways to pick", () => {
  it("a picker click selects the element and completes the pick", async () => {
    ctx.workspace.box = { left: 0, top: 0, width: 1080, height: 1440, scale: 1, docked: "stage" };
    ctx.state.picker.on = true;
    await pickAt(ctx, { x: 540, y: 990 });
    expect(ctx.state.selected).toEqual({ kind: "entity", id: 1_048_628 });
    expect(ctx.state.pick?.nodeId).toBe("entity:1048628");
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(ctx.workspace.toast).toHaveBeenCalledWith("Reference, shot and bookmark copied");
  });

  it("a proxy click selects its node and completes the pick; an unknown id does nothing", async () => {
    await pickProxy(ctx, "ui:boardScreen/hudRow/coinPill");
    expect(ctx.state.selected).toEqual({ kind: "ui", path: "boardScreen/hudRow/coinPill" });
    expect(ctx.state.pick?.bookmark).toBe("coinPill-f1841");

    await pickProxy(ctx, "ui:nowhere");
    expect(writeText).toHaveBeenCalledTimes(1);
  });
});

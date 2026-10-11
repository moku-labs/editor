// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stopGameView } from "../../lifecycle";
import { copySelectedReference } from "../../reference/pick";
import { createCtx, DAY, type TestCtx, TODAY, useScene } from "../helpers";
import { boardScene } from "../ui";

// ─────────────────────────────────────────────────────────────────────────────
// Copy reference (round 2 R2, round 2b R13): writes the reference card of the
// selection and puts its one line on the clipboard. The Element tab's footer
// and the api run it; it copies whatever "Copy on select" says (U5).
// ─────────────────────────────────────────────────────────────────────────────

let ctx: TestCtx;

beforeEach(() => {
  vi.setSystemTime(TODAY);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  ctx = createCtx();
  useScene(ctx);
  ctx.state.scene = boardScene();
});

afterEach(() => {
  vi.useRealTimers();
  stopGameView(ctx);
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("copySelectedReference", () => {
  it("writes the card of the selection, copies its one line, toasts and returns it", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    ctx.state.selected = { kind: "ui", path: "boardScreen/hudRow/coinPill" };
    ctx.state.found.set("coinPill", {
      kind: "defined",
      path: "src/hud/Hud.tsx",
      line: 2,
      range: [2, 1, 2, 42]
    });

    const line = await copySelectedReference(ctx);
    expect(line).toMatch(
      /^@moku coinPill row · board\/awaitIntent · src\/hud\/Hud\.tsx:2 · ref \d+,\d+ \d+×\d+ · \.moku\/captures\/\d{4}-\d{2}-\d{2}\/coinPill-f1841\.md$/
    );
    expect(writeText).toHaveBeenCalledWith(line);
    expect(ctx.workspace.toast).toHaveBeenCalledWith("✓ Reference copied");

    // "Copy reference" always copies: the Copy on select preference is about a pick (U5).
    ctx.workspace.copyOnSelectValue = false;
    await copySelectedReference(ctx);
    expect(writeText).toHaveBeenCalledTimes(2);
    const card = ctx.link.files.text(`${DAY}/coinPill-f1841.md`);
    expect(card.split("\n").slice(0, 6)).toEqual([
      "# @moku coinPill row",
      "",
      "```text",
      "@moku coinPill · row · board/awaitIntent · f1841",
      "path: boardScreen/hudRow/coinPill",
      "source: src/hud/Hud.tsx:2 · texture: ui.hud-pill"
    ]);

    // The same node and frame again: the same card, written again.
    await copySelectedReference(ctx);
    expect(ctx.link.files.paths().filter(path => path.endsWith(".md"))).toEqual([
      `${DAY}/coinPill-f1841.md`
    ]);
  });

  it("writes the card beside the pictures of a pick taken on another day, so its links work", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(() => Promise.resolve()) } });
    ctx.state.selected = { kind: "ui", path: "boardScreen/hudRow/coinPill" };
    ctx.state.pick = {
      nodeId: "ui:boardScreen/hudRow/coinPill",
      frame: 1841,
      bookmark: undefined,
      crop: ".moku/captures/2026-10-04/coinPill-f1841-crop.jpg",
      full: ".moku/captures/2026-10-04/f1841-full.jpg",
      tainted: undefined
    };

    const line = await copySelectedReference(ctx);
    expect(line).toMatch(/ · \.moku\/captures\/2026-10-04\/coinPill-f1841\.md$/);
    const card = ctx.link.files.text(".moku/captures/2026-10-04/coinPill-f1841.md");
    expect(card).toContain("![element](coinPill-f1841-crop.jpg)");
    expect(card).toContain("![frame](f1841-full.jpg)");
  });

  it("toasts when the clipboard refuses or does not exist, and returns the block all the same", async () => {
    ctx.state.selected = { kind: "ui", path: "boardScreen/hudRow/coinPill" };
    vi.stubGlobal("navigator", {
      clipboard: { writeText: () => Promise.reject(new Error("Document is not focused.")) }
    });
    expect(await copySelectedReference(ctx)).toMatch(/^@moku coinPill/);
    expect(ctx.workspace.toast).toHaveBeenCalledWith("Copy failed · Document is not focused.");

    vi.stubGlobal("navigator", {});
    await copySelectedReference(ctx);
    expect(ctx.workspace.toast).toHaveBeenLastCalledWith(
      "Copy failed · The clipboard is not available."
    );
  });

  it("is undefined without a selection, or for one the scene does not have", async () => {
    expect(await copySelectedReference(ctx)).toBeUndefined();
    ctx.state.selected = { kind: "ui", path: "nowhere" };
    expect(await copySelectedReference(ctx)).toBeUndefined();
  });

  it("reads the scene when there is none yet, and gives up when that read fails", async () => {
    ctx.state.scene = undefined;
    ctx.state.selected = { kind: "ui", path: "boardScreen/hudRow/coinPill" };
    vi.stubGlobal("navigator", {});
    expect(await copySelectedReference(ctx)).toMatch(/^@moku coinPill/);

    ctx.state.scene = undefined;
    ctx.link.values.delete("game.ui");
    expect(await copySelectedReference(ctx)).toBeUndefined();
    expect(ctx.log.debug).toHaveBeenCalledWith("gameView: copy reference read failed", {
      message: "no value for game.ui"
    });
  });
});

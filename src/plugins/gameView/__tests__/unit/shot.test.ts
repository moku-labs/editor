import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errorCode, wireError } from "../../../registry/protocol";
import { hideCard, takeScreenshot } from "../../capture/shot";
import { createCtx, JPEG, manifestOf, PNG, type TestCtx, useScene } from "../helpers";

const PATH = ".moku/captures/2026-09-24/1012-board.png";
let ctx: TestCtx;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 24, 10, 12, 30));
  ctx = createCtx();
  useScene(ctx);
  ctx.panels.answers.set("editor.capture", {
    image: PNG,
    frame: 1841,
    device: { w: 393, h: 852, orientation: "portrait" }
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("takeScreenshot", () => {
  it("runs editor.capture through panels.run, writes the PNG, toasts and shows the card", async () => {
    const shot = await takeScreenshot(ctx);

    expect(ctx.panels.run).toHaveBeenCalledWith("editor.capture");
    expect(ctx.link.run).not.toHaveBeenCalled();
    expect(shot).toEqual({ path: PATH, frame: 1841, device: "iPhone 15 portrait", image: PNG });
    expect(ctx.link.files.dataUrl(PATH)).toBe(PNG);
    expect(ctx.workspace.toast).toHaveBeenCalledWith("✓ Screenshot saved", PATH);
    expect(ctx.state.card).toEqual(shot);
  });

  it("puts shot: <path> on the clipboard; a refused clipboard is only logged", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await takeScreenshot(ctx);
    expect(writeText).toHaveBeenCalledWith(`shot: ${PATH}`);

    writeText.mockRejectedValue(new Error("Document is not focused."));
    const shot = await takeScreenshot(ctx);
    vi.unstubAllGlobals();
    expect(shot?.path).toBe(".moku/captures/2026-09-24/1012-board-2.png");
    expect(ctx.log.debug).toHaveBeenCalledWith("gameView: clipboard refused", {
      message: "Document is not focused."
    });
    expect(ctx.workspace.toast).not.toHaveBeenCalledWith(expect.stringContaining("Copy failed"));
  });

  it("names the file after the picture: editor.capture's JPEG becomes a .jpg (D-34)", async () => {
    ctx.panels.answers.set("editor.capture", {
      image: JPEG,
      frame: 1841,
      device: { w: 393, h: 852, orientation: "portrait" }
    });
    const shot = await takeScreenshot(ctx);
    expect(shot?.path).toBe(".moku/captures/2026-09-24/1012-board.jpg");
    expect(ctx.link.files.dataUrl(".moku/captures/2026-09-24/1012-board.jpg")).toBe(JPEG);
  });

  it("works before the Game panel's first render: nothing registered, it runs at once", async () => {
    expect(ctx.panels.registered).toHaveLength(0);
    const shot = await takeScreenshot(ctx);
    expect(shot?.path).toBe(PATH);
  });

  it("names the file game without a position and avoids a taken name", async () => {
    ctx.link.values.delete("game.position");
    ctx.link.files.put(".moku/captures/2026-09-24/1012-game.png", "");

    const shot = await takeScreenshot(ctx);
    expect(shot?.path).toBe(".moku/captures/2026-09-24/1012-game-2.png");
  });

  it("writes into the day folder and counts only the names taken in that day", async () => {
    ctx.link.files.put(".moku/captures/2026-09-23/1012-board.png", "");
    ctx.link.files.put(".moku/captures/1012-board.png", "");
    const shot = await takeScreenshot(ctx);
    expect(shot?.path).toBe(PATH);
    expect(ctx.link.files.paths()).toContain(".moku/captures/2026-09-23/1012-board.png");
  });

  it("names the device in the orientation of the shot", async () => {
    ctx.workspace.device = { preset: "pixel-8", orientation: "landscape" };
    ctx.panels.answers.set("editor.capture", {
      image: PNG,
      frame: 3,
      device: { w: 915, h: 412, orientation: "landscape" }
    });
    const shot = await takeScreenshot(ctx);
    expect(shot?.device).toBe("Pixel 8 landscape");
  });

  it.each([
    { kind: "empty" as const },
    { kind: "connecting" as const }
  ])("refuses with a toast while the link is $kind", async status => {
    ctx.link.current = status;
    expect(await takeScreenshot(ctx)).toBeUndefined();
    expect(ctx.panels.run).not.toHaveBeenCalled();
    expect(ctx.workspace.toast).toHaveBeenCalledWith("No game to capture. Connect a game first.");
  });

  it("refuses when the game did not add editor.capture", async () => {
    ctx.link.manifestValue = manifestOf([["editor.overlay", "cosmetic"]]);
    expect(await takeScreenshot(ctx)).toBeUndefined();
    expect(ctx.panels.run).not.toHaveBeenCalled();
    expect(ctx.workspace.toast).toHaveBeenCalledWith("No game to capture. Connect a game first.");
  });

  it("toasts a wire error without the [moku-editor] prefix and warns with its code", async () => {
    ctx.panels.answers.set(
      "editor.capture",
      wireError(errorCode.timeout, "[moku-editor] The game did not answer in time.", {
        reason: "timeout",
        retryable: true
      })
    );

    expect(await takeScreenshot(ctx)).toBeUndefined();
    expect(ctx.workspace.toast).toHaveBeenCalledWith(
      "Screenshot failed · The game did not answer in time."
    );
    expect(ctx.log.warn).toHaveBeenCalledWith("gameView: capture failed", {
      code: -32_002,
      message: "[moku-editor] The game did not answer in time."
    });
    expect(ctx.link.files.writes).toEqual([]);
  });

  it("treats a value without an image as a failure", async () => {
    ctx.panels.answers.set("editor.capture", { frame: 1 });
    expect(await takeScreenshot(ctx)).toBeUndefined();
    expect(ctx.workspace.toast).toHaveBeenCalledWith(
      expect.stringMatching(/^Screenshot failed · /)
    );
    expect(ctx.link.files.writes).toEqual([]);
  });
});

describe("the capture card", () => {
  it("hides after captureCardMs unless hovered or focused, re-checking every 2 s", async () => {
    const shot = await takeScreenshot(ctx);
    ctx.state.cardHeld = true;

    await vi.advanceTimersByTimeAsync(10_000);
    expect(ctx.state.card).toEqual(shot);
    ctx.state.cardHeld = false;
    await vi.advanceTimersByTimeAsync(1999);
    expect(ctx.state.card).toEqual(shot);
    await vi.advanceTimersByTimeAsync(1);
    expect(ctx.state.card).toBeUndefined();
  });

  it("hideCard hides at once and tells whether a card was shown", async () => {
    expect(hideCard(ctx)).toBe(false);
    await takeScreenshot(ctx);
    expect(hideCard(ctx)).toBe(true);
    expect(ctx.state.card).toBeUndefined();
    expect(ctx.state.timers.card).toBeUndefined();
  });
});

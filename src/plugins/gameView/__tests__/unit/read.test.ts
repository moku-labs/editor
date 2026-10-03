import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errorCode, wireError } from "../../../registry/protocol";
import { locateElement, readScene } from "../../scene/read";
import { startSceneWatches } from "../../scene/watch";
import { createCtx, flush, sceneCapture, type TestCtx, useScene } from "../helpers";

const BOARD = sceneCapture("scene-board.txt");
let ctx: TestCtx;

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  ctx = createCtx();
  useScene(ctx);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readScene", () => {
  it("returns the watched scene while Game is shown, without a read", async () => {
    startSceneWatches(ctx);
    ctx.link.send("game.ui", BOARD.ui);
    ctx.link.send("game.entities", BOARD.entities);
    ctx.link.send("game.projections", BOARD.projections);
    await flush();
    const watched = ctx.state.scene;
    ctx.link.read.mockClear();

    const scene = await readScene(ctx);

    expect(scene).toBe(watched);
    expect(ctx.link.read).not.toHaveBeenCalled();
  });

  it("reads the three sources once while Game is hidden, calibrates and builds", async () => {
    const scene = await readScene(ctx);

    expect(ctx.link.read.mock.calls.map(call => call[0]).toSorted()).toEqual([
      "game.entities",
      "game.projections",
      "game.rect",
      "game.ui"
    ]);
    expect(scene.calibrated).toBe(true);
    expect(scene.frame).toBe(1841);
    expect(scene.nodes.get("ui:boardScreen/boardSlot")?.rect).toEqual({
      x: 55,
      y: 801,
      w: 970,
      h: 970
    });
    expect(ctx.state.scene).toBe(scene);
    expect(ctx.link.watch).not.toHaveBeenCalled();
  });

  it("rejects with the link's WireError when no game is connected", async () => {
    const noSession = wireError(errorCode.noSession, "[moku-editor] No game session.", {
      reason: "no_session"
    });
    ctx.link.read.mockRejectedValue(noSession);

    await expect(readScene(ctx)).rejects.toBe(noSession);
  });

  it("rejects a value of the wrong shape with a [moku-editor] error", async () => {
    ctx.link.values.set("game.entities", "nope");
    await expect(readScene(ctx)).rejects.toThrow(
      "[moku-editor] game.entities has the wrong shape at $."
    );
  });
});

describe("locateElement", () => {
  it("gives the page rect of an element from the scene", async () => {
    expect(await locateElement(ctx, { kind: "entity", id: 1_048_628 })).toEqual({
      x: 428.5,
      y: 880.5,
      w: 223,
      h: 223
    });
  });

  it("is undefined for an unknown element", async () => {
    expect(await locateElement(ctx, { kind: "ui", path: "nope" })).toBeUndefined();
  });
});

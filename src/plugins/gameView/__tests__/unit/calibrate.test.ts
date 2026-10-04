import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Json } from "../../../registry/protocol";
import { calibrate, calibrationTargetOf, recalibrate } from "../../scene/calibrate";
import { startSceneWatches } from "../../scene/watch";
import { createCtx, flush, manifestOf, sceneCapture, type TestCtx, useScene } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The calibration of finding 3: the target (a full-screen keyed node first),
// a new read when the target, its drawn rect or the root rect changes, the
// wait for the first ui snapshot after a device change, and the discard of a
// read that a newer snapshot overtook (one retry).
// ─────────────────────────────────────────────────────────────────────────────

const BOARD = sceneCapture("scene-board.txt");
const SETTINGS = sceneCapture("scene-settings.txt");
let ctx: TestCtx;

/**
 * A ui node of the wire.
 *
 * @param type - Node type.
 * @param rect - Natural rect `[x, y, w, h]`.
 * @param key - Its key, omitted for none.
 * @param children - Its children.
 * @returns The node.
 */
function uiNode(
  type: string,
  rect: readonly [number, number, number, number],
  key?: string,
  children: readonly Json[] = []
): Json {
  const [x, y, w, h] = rect;
  const node: { [name: string]: Json } = { type, rect: { x, y, w, h }, children: [...children] };
  if (key !== undefined) node.key = key;
  return node;
}

/**
 * A screen with an unkeyed root and one keyed Play button of a given width.
 *
 * @param w - The width of the button.
 * @returns The game.ui value.
 */
function playScreen(w: number): Json {
  return uiNode("column", [0, 0, 1080, 1440], undefined, [
    uiNode("button", [10, 10, w, 50], "play")
  ]);
}

/** The game.rect reads so far: their keys. */
function rectReads(): (string | undefined)[] {
  return ctx.link.read.mock.calls
    .filter(call => call[0] === "game.rect")
    .map(call => {
      const input = call[1];
      return typeof input === "object" && input !== null && !Array.isArray(input)
        ? String(input.key)
        : undefined;
    });
}

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

describe("calibrationTargetOf", () => {
  it("takes the keyed root when it covers the screen, with the root rect", () => {
    expect(calibrationTargetOf(BOARD.ui)).toEqual({
      key: "boardScreen",
      drawn: { x: 0, y: 0, w: 1080, h: 1440 },
      root: { x: 0, y: 0, w: 1080, h: 1440 }
    });
  });

  it("takes the topmost popup root under the synthetic root", () => {
    expect(calibrationTargetOf(SETTINGS.ui)?.key).toBe("settingsScreen");
  });

  it("prefers a full-screen keyed node over the first keyed one when the root has no key", () => {
    const ui = uiNode("screen", [0, 0, 1080, 2340], undefined, [
      uiNode("button", [40, 40, 120, 120], "settings"),
      uiNode("image", [0, 0, 1080, 2340], "homeBackground")
    ]);
    expect(calibrationTargetOf(ui)).toEqual({
      key: "homeBackground",
      drawn: { x: 0, y: 0, w: 1080, h: 2340 },
      root: { x: 0, y: 0, w: 1080, h: 2340 }
    });
  });

  it("falls back to the first keyed node with a width", () => {
    const ui = uiNode("screen", [0, 0, 1080, 2340], undefined, [
      uiNode("button", [40, 40, 0, 120], "empty"),
      uiNode("button", [40, 40, 120, 120], "settings")
    ]);
    expect(calibrationTargetOf(ui)?.key).toBe("settings");
  });

  it("is undefined without a keyed node or for a wrong shape", () => {
    expect(calibrationTargetOf(uiNode("screen", [0, 0, 10, 10]))).toBeUndefined();
    expect(calibrationTargetOf("nope")).toBeUndefined();
  });
});

describe("recalibration while watching", () => {
  it("reads again when the next screen has another target: screen A, then screen B", async () => {
    startSceneWatches(ctx);
    ctx.link.send("game.ui", BOARD.ui);
    ctx.link.send("game.entities", BOARD.entities);
    ctx.link.send("game.projections", BOARD.projections);
    await flush();
    expect(ctx.state.calibration).toEqual({ scale: 1, x: 0, y: 0 });

    ctx.link.values.set("game.rect", { x: 0, y: 0, w: 412, h: 549.3 });
    ctx.link.send("game.ui", SETTINGS.ui);
    await flush();

    expect(rectReads()).toEqual(["boardScreen", "settingsScreen"]);
    expect(ctx.state.calibration?.scale).toBeCloseTo(412 / 1080);
    expect(ctx.state.calibrationRun.used?.key).toBe("settingsScreen");
  });

  it("reads again when the root rect changes, never for the same snapshot again", async () => {
    startSceneWatches(ctx);
    ctx.link.send("game.ui", BOARD.ui);
    await flush();
    ctx.link.send("game.ui", BOARD.ui);
    await flush();
    expect(rectReads()).toEqual(["boardScreen"]);

    const taller = uiNode("screen", [0, 0, 1080, 2340], "boardScreen");
    ctx.link.values.set("game.rect", { x: 0, y: 0, w: 412, h: 892.7 });
    ctx.link.send("game.ui", taller);
    await flush();

    expect(rectReads()).toEqual(["boardScreen", "boardScreen"]);
    expect(ctx.state.calibration?.scale).toBeCloseTo(412 / 1080);
  });

  it("reads again when the target's drawn rect changes", async () => {
    const ui = playScreen;
    ctx.link.values.set("game.rect", { x: 10, y: 10, w: 100, h: 50 });
    startSceneWatches(ctx);
    ctx.link.send("game.ui", ui(100));
    await flush();
    ctx.link.send("game.ui", ui(200));
    await flush();
    expect(rectReads()).toEqual(["play", "play"]);
    expect(ctx.state.calibration?.scale).toBeCloseTo(0.5);
  });

  it("after a device change waits for the next ui snapshot before it reads game.rect", async () => {
    startSceneWatches(ctx);
    ctx.link.send("game.ui", BOARD.ui);
    await flush();
    expect(rectReads()).toHaveLength(1);

    recalibrate(ctx);
    await flush();
    expect(rectReads()).toHaveLength(1);
    expect(ctx.state.calibrationRun.waiting).toBe(true);

    ctx.link.values.set("game.rect", { x: 0, y: 0, w: 540, h: 720 });
    ctx.link.send("game.ui", BOARD.ui);
    await flush();

    expect(rectReads()).toHaveLength(2);
    expect(ctx.state.calibration).toEqual({ scale: 0.5, x: 0, y: 0 });
    expect(ctx.state.calibrationRun.waiting).toBe(false);
  });

  it("discards a read a newer ui snapshot overtook and reads once more", async () => {
    const answers: ((value: Json) => void)[] = [];
    ctx.link.read.mockImplementation(id =>
      id === "game.rect"
        ? new Promise<Json>(resolve => answers.push(resolve))
        : Promise.reject(new Error(`no value for ${id}`))
    );
    startSceneWatches(ctx);
    ctx.link.send("game.ui", BOARD.ui);
    await flush();
    ctx.link.send("game.ui", SETTINGS.ui);
    await flush();
    expect(answers).toHaveLength(1);

    answers[0]?.({ x: 0, y: 0, w: 2160, h: 2880 });
    await flush();
    expect(ctx.state.calibration).toBeUndefined();
    expect(rectReads()).toEqual(["boardScreen", "settingsScreen"]);

    // The retry is overtaken too: it is kept, and the newer target is read next.
    ctx.link.send("game.ui", BOARD.ui);
    answers[1]?.({ x: 0, y: 0, w: 540, h: 720 });
    await flush();
    expect(ctx.state.calibration).toEqual({ scale: 0.5, x: 0, y: 0 });
    expect(rectReads()).toEqual(["boardScreen", "settingsScreen", "boardScreen"]);

    answers[2]?.({ x: 0, y: 0, w: 270, h: 360 });
    await flush();
    expect(ctx.state.calibration).toEqual({ scale: 0.25, x: 0, y: 0 });
    expect(ctx.state.calibrationRun.used?.key).toBe("boardScreen");
  });

  it("while a read is in flight a second calibrate does not read", async () => {
    ctx.state.sources.ui = BOARD.ui;
    const first = calibrate(ctx);
    const second = calibrate(ctx);
    await Promise.all([first, second]);
    expect(rectReads()).toEqual(["boardScreen"]);
  });
});

describe("the rect source of the manifest (U11)", () => {
  it("reads game.locate with { key } when the manifest lists it (game 0.4)", async () => {
    ctx.link.manifestValue = manifestOf(undefined, ["game.ui", "game.locate"]);
    ctx.link.values.set("game.locate", { x: 0, y: 0, w: 540, h: 720 });
    ctx.state.sources.ui = BOARD.ui;

    await calibrate(ctx);

    expect(ctx.link.read).toHaveBeenCalledWith("game.locate", { key: "boardScreen" });
    expect(rectReads()).toEqual([]);
    expect(ctx.state.calibration).toEqual({ scale: 0.5, x: 0, y: 0 });
  });

  it("reads game.rect when the manifest lists only game.rect (game 0.1)", async () => {
    ctx.state.sources.ui = BOARD.ui;

    await calibrate(ctx);

    expect(rectReads()).toEqual(["boardScreen"]);
    expect(ctx.state.calibration).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it("reads nothing and warns nothing when the manifest lists neither", async () => {
    ctx.link.manifestValue = manifestOf(undefined, ["game.ui"]);
    startSceneWatches(ctx);
    ctx.link.send("game.ui", BOARD.ui);
    await flush();
    ctx.link.send("game.ui", BOARD.ui);
    await flush();

    expect(ctx.link.read).not.toHaveBeenCalled();
    expect(ctx.log.warn).not.toHaveBeenCalled();
    expect(ctx.state.calibration).toBeUndefined();
    expect(ctx.state.calibrationRead).toBe(true);
    expect(ctx.state.calibrationRun.used?.key).toBe("boardScreen");
  });
});

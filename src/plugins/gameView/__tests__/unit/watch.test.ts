import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errorCode, wireError } from "../../../registry/protocol";
import { recalibrate } from "../../scene/calibrate";
import { projectionsBehind, startSceneWatches, stopSceneWatches } from "../../scene/watch";
import { subscribe } from "../../state";
import { createCtx, flush, sceneCapture, type TestCtx, useScene } from "../helpers";

const BOARD = sceneCapture("scene-board.txt");
let ctx: TestCtx;
let frames: FrameRequestCallback[];

/** Runs every queued animation frame. */
function flushFrames(): void {
  const run = frames;
  frames = [];
  for (const callback of run) callback(0);
}

/**
 * A link that lost its game or its socket: a retryable wire error with the reason.
 *
 * @param reason - "link_closed" or "game_reloaded".
 * @returns A thrower for `link.values`.
 */
function lost(reason: "link_closed" | "game_reloaded"): () => never {
  return () => {
    throw wireError(errorCode.timeout, "The link closed.", { reason, retryable: true });
  };
}

/**
 * A read in the reconnect window of a server restart: the hub has no game session yet. A thrower
 * for `link.values`.
 *
 * @throws {Error} Always: the -32003 `no_session` wire error.
 */
function noSession(): never {
  throw wireError(errorCode.noSession, "No game session.", { reason: "no_session" });
}

/** The link status inside an expected reload (Hot reload switch, server restart). */
const RELOADING = {
  kind: "lost",
  reason: "socket_closed",
  lastFrame: 1825,
  retryInMs: 1000,
  reloading: true
} as const;

/** Sends the three board values. */
function sendBoard(): void {
  ctx.link.send("game.ui", BOARD.ui);
  ctx.link.send("game.entities", BOARD.entities);
  ctx.link.send("game.projections", BOARD.projections);
}

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  ctx = createCtx();
  useScene(ctx);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("startSceneWatches", () => {
  it("watches game.ui, game.entities and game.projections; a second start is a no-op", () => {
    startSceneWatches(ctx);
    startSceneWatches(ctx);

    expect(ctx.link.watch.mock.calls.map(call => call[0])).toEqual([
      "game.ui",
      "game.entities",
      "game.projections"
    ]);
    expect(ctx.link.active()).toHaveLength(3);
  });

  it("stores every value and rebuilds the scene once per animation frame for a burst", async () => {
    const rendered = vi.fn();
    subscribe(ctx.state, rendered);
    startSceneWatches(ctx);

    sendBoard();
    ctx.link.send("game.ui", BOARD.ui);
    await flush();
    expect(frames).toHaveLength(1);
    expect(ctx.state.sources.ui).toBe(BOARD.ui);

    rendered.mockClear();
    flushFrames();
    expect(ctx.state.scene?.frame).toBe(1841);
    expect(ctx.state.scene?.nodes.has("ui:boardScreen/boardSlot")).toBe(true);
    expect(rendered).toHaveBeenCalledTimes(1);
  });

  it("takes the frame of the link status when the last value arrived", async () => {
    startSceneWatches(ctx);
    ctx.link.current = { kind: "paused", frame: 2000 };
    sendBoard();
    await flush();
    flushFrames();
    expect(ctx.state.scene?.frame).toBe(2000);
  });

  it("reads game.rect once per session for the calibration, not once per value", async () => {
    startSceneWatches(ctx);
    sendBoard();
    ctx.link.send("game.ui", BOARD.ui);
    ctx.link.send("game.ui", BOARD.ui);
    await flush();
    flushFrames();

    const rectReads = ctx.link.read.mock.calls.filter(call => call[0] === "game.rect");
    expect(rectReads).toEqual([["game.rect", { key: "boardScreen" }]]);
    expect(ctx.state.calibration).toEqual({ scale: 1, x: 0, y: 0 });
    expect(ctx.state.calibrationRead).toBe(true);
    expect(ctx.state.scene?.calibrated).toBe(true);
  });

  it("reads game.rect again after a device change, once the next ui snapshot arrived", async () => {
    startSceneWatches(ctx);
    sendBoard();
    await flush();
    ctx.link.values.set("game.rect", { x: 0, y: 0, w: 540, h: 720 });

    recalibrate(ctx);
    ctx.link.send("game.entities", BOARD.entities);
    await flush();
    expect(ctx.link.read.mock.calls.filter(call => call[0] === "game.rect")).toHaveLength(1);

    ctx.link.send("game.ui", BOARD.ui);
    await flush();
    flushFrames();

    expect(ctx.link.read.mock.calls.filter(call => call[0] === "game.rect")).toHaveLength(2);
    expect(ctx.state.calibration).toEqual({ scale: 0.5, x: 0, y: 0 });
    expect(ctx.state.scene?.nodes.get("ui:boardScreen/boardSlot")?.rect).toEqual({
      x: 27.5,
      y: 400.5,
      w: 485,
      h: 485
    });
  });

  it("marks the calibration read but leaves it undefined without a keyed element", async () => {
    startSceneWatches(ctx);
    ctx.link.send("game.ui", { type: "screen", rect: { x: 0, y: 0, w: 10, h: 10 }, children: [] });
    await flush();
    expect(ctx.state.calibrationRead).toBe(true);
    expect(ctx.state.calibration).toBeUndefined();
    expect(ctx.link.read).not.toHaveBeenCalled();
  });

  it.each([
    "link_closed",
    "game_reloaded"
  ] as const)("logs a calibration read that failed with %s at debug, not warn (U11)", async reason => {
    ctx.link.values.set("game.rect", lost(reason));
    startSceneWatches(ctx);
    sendBoard();
    await flush();
    expect(ctx.state.calibration).toBeUndefined();
    expect(ctx.log.warn).not.toHaveBeenCalled();
    expect(ctx.log.debug).toHaveBeenCalledWith("gameView: calibration failed", {
      key: "boardScreen",
      message: "[moku-editor] The link closed."
    });
  });

  it("logs a calibration read that failed during an expected reload at debug, not warn", async () => {
    ctx.link.values.set("game.rect", noSession);
    ctx.link.current = RELOADING;
    startSceneWatches(ctx);
    sendBoard();
    await flush();

    expect(ctx.state.calibration).toBeUndefined();
    expect(ctx.log.warn).not.toHaveBeenCalled();
    expect(ctx.log.debug).toHaveBeenCalledWith("gameView: calibration failed", {
      key: "boardScreen",
      message: "[moku-editor] No game session."
    });
  });

  it("warns for the same read failure outside an expected reload", async () => {
    ctx.link.values.set("game.rect", noSession);
    startSceneWatches(ctx);
    sendBoard();
    await flush();

    expect(ctx.log.warn).toHaveBeenCalledWith("gameView: calibration failed", {
      key: "boardScreen",
      message: "[moku-editor] No game session."
    });
  });

  it("keeps the calibration undefined and warns when game.rect fails", async () => {
    ctx.link.values.delete("game.rect");
    startSceneWatches(ctx);
    sendBoard();
    await flush();
    expect(ctx.state.calibration).toBeUndefined();
    expect(ctx.log.warn).toHaveBeenCalledWith("gameView: calibration failed", {
      key: "boardScreen",
      message: "no value for game.rect"
    });
  });

  it("keeps the last scene and warns when a value has the wrong shape", async () => {
    startSceneWatches(ctx);
    sendBoard();
    await flush();
    flushFrames();
    const scene = ctx.state.scene;

    ctx.link.send("game.entities", "not a list");
    flushFrames();

    expect(ctx.state.scene).toBe(scene);
    expect(ctx.log.warn).toHaveBeenCalledWith(
      "gameView: scene shape",
      expect.objectContaining({ error: "shape", source: "game.entities" })
    );
  });

  it("reads no frame source on a timer: only game.rect is ever read while watching", async () => {
    vi.useFakeTimers();
    startSceneWatches(ctx);
    sendBoard();
    await vi.advanceTimersByTimeAsync(10_000);
    flushFrames();
    vi.useRealTimers();

    expect(ctx.link.read.mock.calls.map(call => call[0])).toEqual(["game.rect"]);
  });
});

describe("stopSceneWatches", () => {
  it("unwatches all three and drops a frame and a calibration still pending", async () => {
    startSceneWatches(ctx);
    sendBoard();

    stopSceneWatches(ctx);
    stopSceneWatches(ctx);
    await flush();
    flushFrames();

    expect(ctx.link.active()).toHaveLength(0);
    expect(ctx.state.watching).toEqual([]);
    expect(ctx.state.scene).toBeUndefined();
  });

  it("schedules with setTimeout where requestAnimationFrame does not exist", async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("requestAnimationFrame", undefined);
    vi.useFakeTimers();
    startSceneWatches(ctx);
    sendBoard();
    await vi.advanceTimersByTimeAsync(20);
    vi.useRealTimers();
    expect(ctx.state.scene?.frame).toBe(1841);
    expect(ctx.state.scene?.nodes.has("ui:boardScreen/boardSlot")).toBe(true);
    expect(ctx.state.scene?.nodes.size).toBe(104);
  });
});

describe("recalibrate while hidden", () => {
  it("only clears the flag when no watch is open", () => {
    ctx.state.calibrationRead = true;
    recalibrate(ctx);
    expect(ctx.state.calibrationRead).toBe(false);
    expect(ctx.link.read).not.toHaveBeenCalled();
    expect(ctx.state.sources).toEqual({});
  });
});

describe("projections behind the entities", () => {
  it("tells when a projection entity has no key in the map", () => {
    const entity = { id: 7, owner: { kind: "projection", name: "board.cells" } };
    const plugin = { id: 8, owner: { kind: "plugin", name: "ui" } };

    expect(projectionsBehind([entity], {})).toBe(true);
    expect(projectionsBehind([entity], { "board.cells": { c0_0: 7 } })).toBe(false);
    expect(projectionsBehind([plugin], {})).toBe(false);
    expect(projectionsBehind({ wrong: true }, {})).toBe(false);
    expect(projectionsBehind(BOARD.entities, BOARD.projections)).toBe(false);
  });

  it("reads game.projections once when the watched map is the screen before", async () => {
    startSceneWatches(ctx);
    ctx.link.send("game.ui", BOARD.ui);
    ctx.link.send("game.projections", {});
    ctx.link.send("game.entities", BOARD.entities);
    await flush();
    flushFrames();
    await flush();
    flushFrames();

    expect(ctx.link.read.mock.calls.filter(call => call[0] === "game.projections")).toHaveLength(1);
    expect(ctx.state.sources.projections).toEqual(BOARD.projections);
    const names = [...(ctx.state.scene?.nodes.values() ?? [])].map(node => node.name);
    expect(names).toContain("sawmill");
  });

  it.each([
    "link_closed",
    "game_reloaded"
  ] as const)("logs a projections read that failed with %s at debug, not warn (U11)", async reason => {
    ctx.link.values.set("game.projections", lost(reason));
    startSceneWatches(ctx);
    ctx.link.send("game.ui", BOARD.ui);
    ctx.link.send("game.projections", {});
    ctx.link.send("game.entities", BOARD.entities);
    await flush();

    expect(ctx.state.sources.projections).toEqual({});
    expect(ctx.log.warn).not.toHaveBeenCalledWith(
      "gameView: projections read failed",
      expect.anything()
    );
    expect(ctx.log.debug).toHaveBeenCalledWith("gameView: projections read failed", {
      message: "[moku-editor] The link closed."
    });
  });

  it("logs a projections read that failed during an expected reload at debug", async () => {
    ctx.link.values.set("game.projections", noSession);
    ctx.link.current = RELOADING;
    startSceneWatches(ctx);
    ctx.link.send("game.ui", BOARD.ui);
    ctx.link.send("game.projections", {});
    ctx.link.send("game.entities", BOARD.entities);
    await flush();

    expect(ctx.log.warn).not.toHaveBeenCalledWith(
      "gameView: projections read failed",
      expect.anything()
    );
    expect(ctx.log.debug).toHaveBeenCalledWith("gameView: projections read failed", {
      message: "[moku-editor] No game session."
    });
  });

  it("warns and keeps the old map when the read fails", async () => {
    ctx.link.values.delete("game.projections");
    startSceneWatches(ctx);
    ctx.link.send("game.ui", BOARD.ui);
    ctx.link.send("game.projections", {});
    ctx.link.send("game.entities", BOARD.entities);
    await flush();

    expect(ctx.state.sources.projections).toEqual({});
    expect(ctx.log.warn).toHaveBeenCalledWith("gameView: projections read failed", {
      message: "no value for game.projections"
    });
  });
});

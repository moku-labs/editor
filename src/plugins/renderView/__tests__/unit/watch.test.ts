// @vitest-environment happy-dom
/* eslint-disable unicorn/no-null -- null is a JSON value on the wire */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHandlers } from "../../handlers";
import { startRenderView, stopRenderView } from "../../lifecycle";
import {
  calibrate,
  frameOf,
  readCatalogue,
  startScene,
  startTracker,
  stopScene
} from "../../watch";
import {
  ASSETS,
  boardCapture,
  createCtx,
  deliverBoard,
  EFFECTS,
  type FrameQueue,
  flush,
  MANIFEST_TEXT,
  manifestOf,
  RENDER,
  serveManifest,
  stubFrames,
  type TestCtx
} from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// watch.ts over a scripted link: the tracker (game.render, game.assets) for the
// session, the scene watches only while Render is shown, one scene build per
// animation frame, the calibration and the manifest. No timer reads a source.
// ─────────────────────────────────────────────────────────────────────────────

let ctx: TestCtx;
let frames: FrameQueue;

/** A game.assets value with bundles of 1.5 MB. */
function assets(names: string[]) {
  return {
    textureMb: 1,
    budgetMb: 192,
    bundles: names.map(name => ({ name, tier: "scene", mb: 1.5, lastUsed: 1 }))
  };
}

beforeEach(() => {
  ctx = createCtx();
  frames = stubFrames();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("tracker", () => {
  it("starts in onStart, survives workspace switches, stops in onStop", () => {
    const hooks = createHandlers(ctx);
    startRenderView(ctx);

    expect(ctx.link.active().map(record => record.id)).toEqual(["game.render", "game.assets"]);

    hooks["workspace:changed"]({ ws: "render" });
    hooks["workspace:changed"]({ ws: "flow" });
    expect(ctx.link.active().map(record => record.id)).toEqual(["game.render", "game.assets"]);

    stopRenderView(ctx);
    expect(ctx.link.active()).toEqual([]);
    expect(ctx.state.tracker).toEqual([]);
  });

  it("is started once", () => {
    startTracker(ctx);
    startTracker(ctx);

    expect(ctx.link.active("game.render")).toHaveLength(1);
  });

  it("keeps one FPS sample per delivered value, trimmed to fpsSamples, at the link frame", () => {
    ctx = createCtx({ fpsSamples: 2 });
    startTracker(ctx);
    const listener = vi.fn();
    ctx.state.listeners.add(listener);

    ctx.link.send("game.render", { ...(RENDER as object), fps: 58 });
    ctx.link.current = { kind: "live", frame: 1900 };
    ctx.link.send("game.render", { ...(RENDER as object), fps: 59 });
    ctx.link.send("game.render", { ...(RENDER as object), fps: 60 });

    expect(ctx.state.fps).toEqual([59, 60]);
    expect(ctx.state.firstFrame).toBe(1841);
    expect(ctx.state.lastFrame).toBe(1900);
    expect(ctx.state.render?.fps).toBe(60);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("logs a shape error and keeps the last value", () => {
    startTracker(ctx);
    ctx.link.send("game.render", RENDER);
    ctx.link.send("game.render", { fps: "fast" });
    ctx.link.send("game.assets", 7);

    expect(ctx.state.render?.fps).toBe(60);
    expect(ctx.state.error).toBe("game.assets: unexpected shape");
    expect(ctx.log.warn).toHaveBeenCalledWith("renderView: unexpected source shape", {
      id: "game.render"
    });
    expect(ctx.log.warn).toHaveBeenCalledWith("renderView: unexpected source shape", {
      id: "game.assets"
    });
  });

  it("records the bundles that leave game.assets in the release log, newest first, trimmed", () => {
    ctx = createCtx({ releaseLogMax: 2 });
    startTracker(ctx);
    ctx.link.send("game.render", RENDER);

    ctx.link.send("game.assets", assets(["a", "b", "c", "d"]));
    ctx.link.send("game.assets", assets(["b", "c", "d"]));
    ctx.link.current = { kind: "live", frame: 1900 };
    ctx.link.send("game.render", RENDER);
    ctx.link.send("game.assets", assets(["d"]));

    expect(ctx.state.releases).toEqual([
      { frame: 1900, bundle: "b", tier: "scene", mb: 1.5 },
      { frame: 1900, bundle: "c", tier: "scene", mb: 1.5 }
    ]);
    expect([...ctx.state.loaded.keys()]).toEqual(["d"]);
  });

  it("uses the link frame for a release before any game.render", () => {
    startTracker(ctx);
    ctx.link.send("game.assets", ASSETS);
    ctx.link.send("game.assets", { textureMb: 0, budgetMb: 192, bundles: [] });

    expect(ctx.state.releases.map(entry => [entry.frame, entry.bundle])).toEqual([
      [1841, "board"],
      [1841, "ui"]
    ]);
  });
});

/**
 * Attaches a manifest and lets the deferred effects start run.
 *
 * @param manifest - The manifest, undefined for a lost session.
 */
async function attach(manifest: Parameters<TestCtx["link"]["attach"]>[0]): Promise<void> {
  ctx.link.attach(manifest);
  await flush();
}

describe("effects watch", () => {
  const WITH_EFFECTS = manifestOf(["game.render", "game.assets", "game.effects"]);
  const WITHOUT_EFFECTS = manifestOf(["game.render", "game.assets"]);

  it("starts when the manifest lists game.effects, not when it does not", async () => {
    startRenderView(ctx);
    expect(ctx.link.active("game.effects")).toEqual([]);

    await attach(WITHOUT_EFFECTS);
    expect(ctx.link.active("game.effects")).toEqual([]);
    expect(ctx.state.effectsWatch).toBeUndefined();

    ctx.link.attach(WITH_EFFECTS);
    expect(ctx.link.active("game.effects")).toEqual([]);
    await attach(WITH_EFFECTS);
    expect(ctx.link.active("game.effects")).toHaveLength(1);
    expect(ctx.state.effectsWatch).toBeTypeOf("function");
  });

  it("starts when the manifest is there before onStart", async () => {
    ctx.link.manifestValue = WITH_EFFECTS;
    startRenderView(ctx);
    await flush();

    expect(ctx.link.active().map(record => record.id)).toEqual([
      "game.render",
      "game.assets",
      "game.effects"
    ]);
  });

  it("does not start when stopped or when a newer manifest lacks it before the start", async () => {
    startRenderView(ctx);
    ctx.link.attach(WITH_EFFECTS);
    ctx.link.attach(WITHOUT_EFFECTS);
    await flush();
    expect(ctx.link.active("game.effects")).toEqual([]);

    ctx.link.attach(WITH_EFFECTS);
    stopRenderView(ctx);
    await flush();
    expect(ctx.link.active()).toEqual([]);
  });

  it("keeps one notify per good value and the value in state", async () => {
    startRenderView(ctx);
    await attach(WITH_EFFECTS);
    const listener = vi.fn();
    ctx.state.listeners.add(listener);

    ctx.link.send("game.effects", EFFECTS);

    expect(ctx.state.effects).toEqual({
      particles: 18,
      emitters: 1,
      filters: 24,
      renderPasses: 49
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stops and clears effects at once on a manifest without game.effects", async () => {
    startRenderView(ctx);
    await attach(WITH_EFFECTS);
    ctx.link.send("game.effects", EFFECTS);
    const listener = vi.fn();
    ctx.state.listeners.add(listener);

    ctx.link.attach(WITHOUT_EFFECTS);

    expect(ctx.link.active("game.effects")).toEqual([]);
    expect(ctx.state.effectsWatch).toBeUndefined();
    expect(ctx.state.effects).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps the watch and the value when the session is lost (undefined manifest)", async () => {
    startRenderView(ctx);
    await attach(WITH_EFFECTS);
    ctx.link.send("game.effects", EFFECTS);

    await attach(undefined);

    expect(ctx.link.active("game.effects")).toHaveLength(1);
    expect(ctx.state.effects?.particles).toBe(18);
  });

  it("warns once for a bad value and keeps the last good value", async () => {
    startRenderView(ctx);
    await attach(WITH_EFFECTS);
    ctx.link.send("game.effects", EFFECTS);

    ctx.link.send("game.effects", { particles: -1, emitters: 1, filters: 24, renderPasses: 49 });

    expect(ctx.state.effects?.particles).toBe(18);
    expect(ctx.state.error).toBe("game.effects: unexpected shape");
    expect(ctx.log.warn).toHaveBeenCalledTimes(1);
    expect(ctx.log.warn).toHaveBeenCalledWith("renderView: unexpected source shape", {
      id: "game.effects"
    });

    ctx.link.send("game.effects", EFFECTS);
    expect(ctx.state.error).toBeUndefined();
  });

  it("stop removes the effects watch and the manifest listener", async () => {
    startRenderView(ctx);
    await attach(WITH_EFFECTS);
    expect(ctx.link.listeners.size).toBe(1);
    expect(ctx.link.active("game.effects")).toHaveLength(1);

    stopRenderView(ctx);

    expect(ctx.link.active()).toEqual([]);
    expect(ctx.link.listeners.size).toBe(0);
    expect(ctx.state.effectsWatch).toBeUndefined();

    await attach(WITH_EFFECTS);
    expect(ctx.link.active()).toEqual([]);
  });
});

describe("scene watches", () => {
  it("start on entering Render and stop on leaving", () => {
    startScene(ctx);
    startScene(ctx);
    expect(ctx.link.active().map(record => record.id)).toEqual([
      "game.ui",
      "game.entities",
      "game.projections"
    ]);

    stopScene(ctx);
    expect(ctx.link.active()).toEqual([]);
    expect(ctx.state.sources).toEqual({});
  });

  it("build one scene per animation frame for a burst, calibrated once", async () => {
    startScene(ctx);
    const capture = boardCapture();

    ctx.link.send("game.ui", capture.ui);
    ctx.link.send("game.entities", capture.entities);
    ctx.link.send("game.projections", capture.projections);
    ctx.link.send("game.ui", capture.ui);
    await flush();

    expect(frames.pending()).toBe(1);
    expect(ctx.link.api.read).toHaveBeenCalledTimes(1);
    expect(ctx.link.api.read).toHaveBeenCalledWith("game.rect", { key: "boardScreen" });
    expect(ctx.state.calibration).toEqual({ scale: 1, x: 0, y: 0 });

    frames.flush();
    expect(ctx.state.scene?.nodes.size).toBe(104);
    expect(ctx.state.scene?.calibrated).toBe(true);
    expect(ctx.state.scene?.frame).toBe(1841);
    expect(ctx.state.tree.open).toEqual(new Set(["ui:boardScreen", "entity:1048640"]));
    expect(ctx.state.seen.get("board.cell")).toEqual({ lastSeen: 1841, unusedSince: undefined });
  });

  it("drops a build queued before the scene watches stopped", async () => {
    startScene(ctx);
    const capture = boardCapture();
    ctx.link.send("game.ui", capture.ui);
    ctx.link.send("game.entities", capture.entities);
    ctx.link.send("game.projections", capture.projections);
    stopScene(ctx);
    await flush();
    frames.flush();

    expect(ctx.state.scene).toBeUndefined();
  });

  it("logs a scene shape error and keeps the last scene", async () => {
    startScene(ctx);
    await deliverBoard(ctx, frames);
    ctx.link.send("game.entities", "broken");
    frames.flush();

    expect(ctx.state.scene?.nodes.size).toBe(104);
    expect(ctx.state.error).toMatch(/^game\.entities: unexpected shape/);
    expect(ctx.log.warn).toHaveBeenCalledWith("renderView: unexpected source shape", {
      id: "game.entities"
    });
  });

  it("re-calibrates after a device change only", async () => {
    startRenderView(ctx);
    createHandlers(ctx)["workspace:changed"]({ ws: "render" });
    await deliverBoard(ctx, frames);
    vi.mocked(ctx.link.api.read).mockClear();

    ctx.workspace.prefs("iphone-15", "portrait");
    await flush();
    ctx.workspace.prefs("iphone-15", "portrait");
    await flush();
    expect(ctx.link.api.read).toHaveBeenCalledTimes(1);

    ctx.workspace.prefs("iphone-15", "landscape");
    await flush();
    expect(ctx.link.api.read).toHaveBeenCalledTimes(2);
  });
});

describe("frameOf", () => {
  it("reads the frame of every link status", () => {
    expect(frameOf({ kind: "live", frame: 3 }, 0)).toBe(3);
    expect(frameOf({ kind: "paused", frame: 4 }, 0)).toBe(4);
    expect(frameOf({ kind: "silent", since: 1, lastFrame: 5 }, 0)).toBe(5);
    expect(frameOf({ kind: "lost", reason: "bye", lastFrame: 6, retryInMs: 1 }, 0)).toBe(6);
    expect(frameOf({ kind: "connecting" }, 9)).toBe(9);
  });
});

describe("calibrate", () => {
  it("does nothing before game.ui", async () => {
    await calibrate(ctx);
    expect(ctx.link.api.read).not.toHaveBeenCalled();
    expect(ctx.state.calibrationAsked).toBe(false);
  });

  it("keeps no calibration without a keyed element or when game.rect fails", async () => {
    ctx.state.sources.ui = { type: "screen", rect: { x: 0, y: 0, w: 10, h: 10 }, children: [] };
    await calibrate(ctx);
    expect(ctx.state.calibration).toBeUndefined();
    expect(ctx.state.calibrationAsked).toBe(true);

    ctx.state.sources.ui = boardCapture().ui;
    vi.mocked(ctx.link.api.read).mockRejectedValueOnce(new Error("[moku-editor] timeout"));
    await calibrate(ctx);
    expect(ctx.state.calibration).toBeUndefined();
    expect(ctx.log.warn).toHaveBeenCalledWith("renderView: calibration failed", {
      key: "boardScreen",
      message: "[moku-editor] timeout"
    });

    vi.mocked(ctx.link.api.read).mockResolvedValueOnce(null);
    await calibrate(ctx);
    expect(ctx.state.calibration).toBeUndefined();
  });
});

describe("readCatalogue", () => {
  it("tries the paths in order and parses the first manifest found", async () => {
    serveManifest(ctx, "public/manifest.json");

    const catalogue = await readCatalogue(ctx);

    expect(catalogue?.path).toBe("public/manifest.json");
    expect(catalogue?.textures.get("ui.hud-pill")?.gpuMb).toBe(4);
    expect(vi.mocked(ctx.link.api.files.read).mock.calls.map(call => call[0])).toEqual([
      "manifest.json",
      "public/manifest.json"
    ]);
  });

  it("is null when no path holds a manifest of version 1", async () => {
    serveManifest(ctx, "web/manifest.json", JSON.stringify({ version: 2 }));
    expect(await readCatalogue(ctx)).toBeNull();

    serveManifest(ctx, "manifest.json", MANIFEST_TEXT);
    expect(await readCatalogue(ctx)).not.toBeNull();
  });
});

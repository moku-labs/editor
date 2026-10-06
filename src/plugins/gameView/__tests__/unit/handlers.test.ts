import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createHandlers,
  onInspect,
  onLinkStatus,
  onOpenSheet,
  onWorkspaceChanged
} from "../../handlers";
import type { TextureCatalogue } from "../../types";
import { createCtx, flush, type TestCtx, useScene } from "../helpers";

const CATALOGUE: TextureCatalogue = {
  path: "manifest.json",
  textures: new Map(),
  bundles: new Map()
};
let ctx: TestCtx;

/** Puts a scene, a calibration and a manifest into the state. */
function seed(): void {
  ctx.state.scene = {
    frame: 1,
    calibrated: true,
    nodes: new Map(),
    roots: [],
    paintOrder: [],
    referencedTextures: new Set(),
    entityCount: 0
  };
  ctx.state.calibration = { scale: 1, x: 0, y: 0 };
  ctx.state.calibrationRead = true;
  ctx.state.manifest = CATALOGUE;
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

describe("createHandlers", () => {
  it("hooks link:status, link:project, workspace:changed, workspace:open-sheet, workspace:inspect and workspace:reference", () => {
    expect(Object.keys(createHandlers(ctx)).toSorted()).toEqual([
      "link:project",
      "link:status",
      "workspace:changed",
      "workspace:inspect",
      "workspace:open-sheet",
      "workspace:reference"
    ]);
  });
});

describe("link:status", () => {
  it("keeps the scene while silent or lost", () => {
    const hook = onLinkStatus(ctx);
    hook({ status: { kind: "live", frame: 1 }, session: "s-1" });
    seed();
    const { scene } = ctx.state;
    hook({ status: { kind: "silent", since: 1, lastFrame: 1 }, session: "s-1" });
    hook({ status: { kind: "lost", reason: "game_reloaded", lastFrame: 1, retryInMs: 1000 } });
    expect(ctx.state.scene).toBe(scene);
    expect(ctx.state.calibration).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it("live after lost drops the scene, the calibration and the manifest", () => {
    const hook = onLinkStatus(ctx);
    hook({ status: { kind: "live", frame: 1 }, session: "s-1" });
    seed();
    hook({
      status: { kind: "lost", reason: "game_reloaded", lastFrame: 1, retryInMs: 1000 },
      session: "s-1"
    });
    hook({ status: { kind: "live", frame: 2 }, session: "s-1" });
    expect(ctx.state.scene).toBeUndefined();
    expect(ctx.state.calibration).toBeUndefined();
    expect(ctx.state.calibrationRead).toBe(false);
    expect(ctx.state.manifest).toBeUndefined();
  });

  it("drops them on a session change, keeps them for the same session", () => {
    const hook = onLinkStatus(ctx);
    hook({ status: { kind: "live", frame: 1 }, session: "s-1" });
    seed();
    const { scene } = ctx.state;
    hook({ status: { kind: "paused", frame: 2 }, session: "s-1" });
    expect(ctx.state.scene).toBe(scene);
    hook({ status: { kind: "live", frame: 3 }, session: "s-2" });
    expect(ctx.state.scene).toBeUndefined();
    expect(ctx.state.link).toEqual({ status: "live", session: "s-2", reloading: false });
  });

  it("empty turns the picker off, closes the popover and ends a running series early", () => {
    ctx.state.picker = { on: true, hover: "ui:a" };
    ctx.state.series.popover = true;
    ctx.state.series.recording = {
      folder: "f/",
      label: "a",
      startedAt: 0,
      durationMs: 2000,
      intervalMs: 100,
      planned: 20,
      phase: "recording",
      written: 0,
      stopRequested: false
    };
    onLinkStatus(ctx)({ status: { kind: "empty" } });
    expect(ctx.state.picker).toEqual({ on: false, hover: undefined });
    expect(ctx.state.series.popover).toBe(false);
    expect(ctx.state.series.recording?.stopRequested).toBe(true);
  });
});

describe("workspace:changed", () => {
  it("entering Game starts the scene watches; leaving stops them and turns the picker off", () => {
    const hook = onWorkspaceChanged(ctx);
    hook({ ws: "game" });
    expect(ctx.link.active()).toHaveLength(3);

    ctx.state.picker = { on: true, hover: "ui:a" };
    hook({ ws: "flow" });
    expect(ctx.link.active()).toHaveLength(0);
    expect(ctx.state.picker).toEqual({ on: false, hover: undefined });
  });

  it("a highlight box stays when Game is left", () => {
    ctx.state.treeHover = { kind: "ui", path: "boardScreen" };
    onWorkspaceChanged(ctx)({ ws: "files" });
    expect(ctx.state.treeHover).toEqual({ kind: "ui", path: "boardScreen" });
  });
});

describe("workspace:open-sheet and workspace:inspect", () => {
  it("open-sheet opens the contact sheet of the index", async () => {
    const index = {
      label: "a",
      durationMs: 50,
      intervalMs: 50,
      fromFrame: 1,
      shots: [{ file: "001.png", frame: 1, atMs: 0, bug: false }]
    };
    ctx.link.files.put(".moku/captures/series-a/index.json", JSON.stringify(index));
    onOpenSheet(ctx)({ index: ".moku/captures/series-a/index.json" });
    await flush();
    expect(ctx.state.series.sheet?.index).toEqual(index);
  });

  it("inspect shows Game, then selects the element on the Element tab", () => {
    ctx.state.tab = "device";
    onInspect(ctx)({ ref: { kind: "entity", id: 1_048_628 } });
    expect(ctx.workspace.show).toHaveBeenCalledWith("game");
    expect(ctx.state.selected).toEqual({ kind: "entity", id: 1_048_628 });
    expect(ctx.state.tab).toBe("element");
  });
});

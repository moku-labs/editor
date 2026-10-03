// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { ToolsEvents } from "../../../../config";
import type { ElementRef } from "../../../panels/shared/scene";
import { createHandlers } from "../../handlers";
import { startTracker } from "../../watch";
import {
  ASSETS,
  createCtx,
  deliverBoard,
  type FrameQueue,
  flush,
  RENDER,
  serveManifest,
  stubFrames,
  type TestCtx
} from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// handlers.ts: workspace:changed starts and stops the scene watches, link:status
// keeps or clears the session data, workspace:reveal reveals.
// ─────────────────────────────────────────────────────────────────────────────

let ctx: TestCtx;
let frames: FrameQueue;
let hooks: ReturnType<typeof createHandlers>;

beforeEach(() => {
  ctx = createCtx();
  frames = stubFrames();
  hooks = createHandlers(ctx);
  serveManifest(ctx);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Fills the session data: tracker values, a scene, a release, a catalogue. */
async function fill(): Promise<void> {
  startTracker(ctx);
  hooks["workspace:changed"]({ ws: "render" });
  await deliverBoard(ctx, frames);
  ctx.link.send("game.render", RENDER);
  ctx.link.send("game.assets", ASSETS);
  ctx.link.send("game.assets", { textureMb: 0, budgetMb: 192, bundles: [] });
  await flush();
}

describe("workspace:changed", () => {
  it("entering Render starts the scene watches and refreshes once per session", async () => {
    hooks["workspace:changed"]({ ws: "render" });
    await flush();

    expect(ctx.state.active).toBe(true);
    expect(ctx.link.active().map(record => record.id)).toEqual([
      "game.ui",
      "game.entities",
      "game.projections"
    ]);
    expect(ctx.state.catalogue?.path).toBe("manifest.json");

    hooks["workspace:changed"]({ ws: "flow" });
    hooks["workspace:changed"]({ ws: "render" });
    await flush();
    expect(ctx.link.api.files.read).toHaveBeenCalledTimes(1);
  });

  it("leaving Render stops the scene watches and clears the box", async () => {
    hooks["workspace:changed"]({ ws: "render" });
    await deliverBoard(ctx, frames);
    ctx.state.box = { kind: "ui", path: "boardScreen/boardSlot" };

    hooks["workspace:changed"]({ ws: "game" });

    expect(ctx.state.active).toBe(false);
    expect(ctx.link.active()).toEqual([]);
    expect(ctx.state.box).toBeUndefined();
  });
});

describe("link:status", () => {
  it("keeps the data while silent or lost", async () => {
    hooks["link:status"]({ status: { kind: "live", frame: 1841 }, session: "s-1" });
    await fill();
    hooks["link:status"]({ status: { kind: "silent", since: 1, lastFrame: 1841 } });
    hooks["link:status"]({
      status: { kind: "lost", reason: "bye", lastFrame: 1841, retryInMs: 1 }
    });

    expect(ctx.state.fps).toEqual([60]);
    expect(ctx.state.scene).toBeDefined();
  });

  it("clears the session data after a session change, then refreshes while active", async () => {
    hooks["link:status"]({ status: { kind: "live", frame: 1 }, session: "s-1" });
    await fill();
    expect(ctx.state.releases).toHaveLength(2);
    vi.mocked(ctx.link.api.files.read).mockClear();

    hooks["link:status"]({ status: { kind: "paused", frame: 5 }, session: "s-2" });

    expect(ctx.state.session).toBe("s-2");
    expect(ctx.state.fps).toEqual([]);
    expect(ctx.state.loaded.size).toBe(0);
    expect(ctx.state.releases).toEqual([]);
    expect(ctx.state.seen.size).toBe(0);
    expect(ctx.state.firstFrame).toBeUndefined();
    expect(ctx.state.calibration).toBeUndefined();
    await flush();
    expect(ctx.link.api.files.read).toHaveBeenCalledTimes(1);
    expect(ctx.state.catalogue?.path).toBe("manifest.json");
  });

  it("does not clear on the same session and does not refresh while hidden", async () => {
    hooks["link:status"]({ status: { kind: "live", frame: 1 }, session: "s-1" });
    await fill();
    hooks["link:status"]({ status: { kind: "live", frame: 9 }, session: "s-1" });
    expect(ctx.state.fps).toEqual([60]);

    hooks["workspace:changed"]({ ws: "flow" });
    vi.mocked(ctx.link.api.files.read).mockClear();
    hooks["link:status"]({ status: { kind: "live", frame: 9 }, session: "s-3" });
    await flush();
    expect(ctx.link.api.files.read).not.toHaveBeenCalled();
    expect(ctx.state.catalogue).toBeUndefined();
  });

  it("clears all data on empty", async () => {
    await fill();
    hooks["link:status"]({ status: { kind: "empty" } });

    expect(ctx.state.render).toBeUndefined();
    expect(ctx.state.assets).toBeUndefined();
    expect(ctx.state.scene).toBeUndefined();
    expect(ctx.state.catalogue).toBeUndefined();
    expect(ctx.state.releases).toEqual([]);
    expect(ctx.state.lastFrame).toBeUndefined();
    expect(ctx.state.session).toBeUndefined();
  });

  it("ignores connecting", async () => {
    await fill();
    hooks["link:status"]({ status: { kind: "connecting" } });
    expect(ctx.state.render).toBeDefined();
  });
});

describe("workspace:reveal", () => {
  it("reveals the ref", async () => {
    hooks["workspace:changed"]({ ws: "render" });
    await deliverBoard(ctx, frames);
    const ref: ElementRef = { kind: "entity", id: 3_145_728 };

    hooks["workspace:reveal"]({ ref });

    expect(ctx.workspace.show).toHaveBeenCalledWith("render");
    expect(ctx.state.tree.selected).toBe("entity:3145728");
    expectTypeOf<ToolsEvents["workspace:reveal"]>().toEqualTypeOf<{ ref: ElementRef }>();
  });
});

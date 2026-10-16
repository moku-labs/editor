// @vitest-environment happy-dom

import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRenderViewApi } from "../../api";
import { createHandlers } from "../../handlers";
import { startRenderView } from "../../lifecycle";
import {
  ASSETS,
  createCtx,
  deliverBoard,
  type FrameQueue,
  RENDER,
  serveManifest,
  stubFrames,
  type TestCtx
} from "../helpers";
import { click, type Mounted, mountRender } from "../mission-ui";

// ─────────────────────────────────────────────────────────────────────────────
// components/scene/SceneDetails.tsx (spec 09 § M9 Scene details, M16
// ui-scene): the scene cards live in one section collapsed by default — none of
// them renders until it opens — and reveal(ref) opens it before it acts.
// ─────────────────────────────────────────────────────────────────────────────

let ctx: TestCtx;
let frames: FrameQueue;
let view: Mounted;

beforeEach(async () => {
  ctx = createCtx();
  frames = stubFrames();
  serveManifest(ctx);
  startRenderView(ctx);
  createHandlers(ctx)["workspace:changed"]({ ws: "render" });
  await deliverBoard(ctx, frames);
  ctx.link.send("game.render", RENDER);
  ctx.link.send("game.assets", ASSETS);
  view = mountRender(ctx);
});

afterEach(() => {
  view.unmount();
  vi.unstubAllGlobals();
});

describe("Scene details", () => {
  it("is collapsed by default and renders none of the scene cards until it opens", () => {
    const toggle = view.q("[data-render='scene'] [data-part='toggle']");
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    for (const card of ["tree", "textures", "bundles", "pools", "releases"]) {
      expect(view.q(`[data-render='${card}']`)).toBeNull();
    }
    expect(view.q("[data-scene-meta]")?.textContent).toContain("frame 1841");

    click(toggle);

    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(view.q("[data-render='tree']")).not.toBeNull();
    expect(view.q("[data-render='releases']")).not.toBeNull();
  });

  it("counts the scene in its header in words: one bundle reads '1 bundle', never '1 bundles'", () => {
    expect(view.q("[data-scene-meta]")?.textContent).toContain("12 textures · 2 bundles");

    act(() => {
      ctx.link.send("game.assets", {
        textureMb: 4,
        budgetMb: 192,
        bundles: [{ name: "board", tier: "scene", mb: 4, lastUsed: 12 }]
      });
      ctx.link.send("game.render", {
        fps: 60,
        frameMs: 3.4,
        textures: 1,
        textureMb: 4,
        views: 180,
        pooled: 24
      });
    });

    const meta = view.q("[data-scene-meta]")?.textContent ?? "";
    expect(meta).toContain("1 texture · 1 bundle");
    expect(meta).not.toContain("1 bundles");
  });

  it("reveal(ref) opens it before it selects the row", () => {
    const api = createRenderViewApi(ctx);

    act(() => api.reveal({ kind: "entity", id: 3_145_728 }));

    expect(ctx.state.mission.sceneOpen).toBe(true);
    expect(
      view.q("[role='treeitem'][data-id='entity:3145728']")?.getAttribute("aria-selected")
    ).toBe("true");
  });
});

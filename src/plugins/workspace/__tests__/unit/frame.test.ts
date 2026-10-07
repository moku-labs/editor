// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"navigation":{"disableChildFrameNavigation":true}}}
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFrameLayer,
  createGameFrame,
  ensureOverlay,
  followTransitions,
  removeFrameLayer,
  syncFrame,
  taggedGameUrl
} from "../../frame/frame";
import type { GameFrame } from "../../types";
import { createCtx, rectOf, stubRect, type TestCtx, tagged } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The single game frame: one layer in document.body, docking by geometry only
// ─────────────────────────────────────────────────────────────────────────────

let ctx: TestCtx;
let frame: GameFrame;

/**
 * The frame box element.
 *
 * @returns The element.
 */
function boxElement(): HTMLElement {
  const element = document.querySelector<HTMLElement>("[data-frame-box]");
  if (element === null) throw new Error("no frame box");
  return element;
}

beforeEach(() => {
  ctx = createCtx({ defaultWorkspace: "flow" });
  // The geometry below is the iPhone 15's (393×852, radius 55), not the default device's.
  ctx.state.device = { preset: "iphone-15", orientation: "portrait" };
  frame = createGameFrame(ctx);
});

afterEach(() => {
  removeFrameLayer(ctx.state);
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("createFrameLayer", () => {
  it("creates the layer, the box, the iframe and the overlay once, in document.body", () => {
    const overlay = frame.overlay();
    createFrameLayer(ctx);
    createFrameLayer(ctx);

    const layers = document.querySelectorAll("[data-frame-layer]");
    expect(layers).toHaveLength(1);
    expect(layers[0]?.parentElement).toBe(document.body);
    const iframe = document.querySelector<HTMLIFrameElement>("iframe[data-game-frame]");
    expect(iframe?.title).toBe("Game");
    expect(iframe?.getAttribute("allow")).toBe("autoplay; fullscreen");
    expect(iframe?.getAttribute("src")).toBe(taggedGameUrl(ctx));
    expect(iframe?.getAttribute("src")).toBe(tagged(frame.url));
    expect(iframe?.parentElement).toBe(boxElement());
    expect(overlay.parentElement).toBe(boxElement());
    expect(frame.overlay()).toBe(overlay);
    expect(ctx.state.frame.iframe).toBe(iframe);
  });

  it("the overlay holds one spinner of an expected reload, hidden unless the link reloads (U9 B6)", () => {
    const spinners = frame.overlay().querySelectorAll<HTMLElement>("[data-frame-reloading]");
    expect(spinners).toHaveLength(1);
    expect(spinners[0]?.hidden).toBe(true);
    expect(spinners[0]?.getAttribute("aria-hidden")).toBe("true");
    expect(ensureOverlay(ctx.state).querySelectorAll("[data-frame-reloading]")).toHaveLength(1);

    const reloading = createCtx();
    reloading.state.link = {
      kind: "lost",
      reason: "bye",
      lastFrame: 310,
      retryInMs: 1000,
      reloading: true
    };
    const spinner = ensureOverlay(reloading.state).querySelector<HTMLElement>(
      "[data-frame-reloading]"
    );
    expect(spinner?.hidden).toBe(false);
  });

  it("removeFrameLayer takes the layer out and forgets it", () => {
    createFrameLayer(ctx);
    removeFrameLayer(ctx.state);
    expect(document.querySelector("[data-frame-layer]")).toBeNull();
    expect(ctx.state.frame.iframe).toBeUndefined();
    expect(frame.box()).toBeUndefined();
  });
});

describe("syncFrame — docking table", () => {
  beforeEach(() => {
    createFrameLayer(ctx);
  });

  it("is a no-op before the layer exists", () => {
    removeFrameLayer(ctx.state);
    syncFrame(ctx);
    expect(frame.box()).toBeUndefined();
  });

  it("outside Game with a visible preview: fit without cap, centred in the preview body", () => {
    const body = document.createElement("div");
    stubRect(body, rectOf(1000, 500, 196.5, 426));
    ctx.state.frame.previewBody = body;
    syncFrame(ctx);

    const box = frame.box();
    expect(box).toMatchObject({ docked: "preview", scale: 0.5, left: 1000, top: 500 });
    expect(box?.width).toBeCloseTo(196.5);
    const element = boxElement();
    expect(element.style.width).toBe("393px");
    expect(element.style.height).toBe("852px");
    expect(element.style.transform).toContain("scale(0.5)");
    expect(element.style.visibility).toBe("visible");
    expect(element.dataset.docked).toBe("preview");
    expect(element.style.getPropertyValue("--frame-scale")).toBe("0.5");
    expect(ctx.state.frame.iframe?.tabIndex).toBe(0);
  });

  it("marks the frame box while Reference mode is on", () => {
    ctx.state.frame.previewBody = document.createElement("div");
    ctx.state.reference = true;
    syncFrame(ctx);
    expect(boxElement().dataset.reference).toBe("");
    ctx.state.reference = false;
    syncFrame(ctx);
    expect(boxElement().dataset.reference).toBeUndefined();
  });

  it("outside Game with the preview hidden: hidden", () => {
    ctx.state.frame.previewBody = document.createElement("div");
    ctx.state.previews.flow.visible = false;
    syncFrame(ctx);
    expect(frame.box()?.docked).toBe("hidden");
    expect(boxElement().style.visibility).toBe("hidden");
    expect(ctx.state.frame.iframe?.tabIndex).toBe(-1);
  });

  it("in Game without a stage dock: hidden; with a dock: the stage slot, fit capped at 1", () => {
    ctx.state.active = "game";
    syncFrame(ctx);
    expect(frame.box()?.docked).toBe("hidden");

    const slot = document.createElement("div");
    stubRect(slot, rectOf(100, 100, 2000, 2000));
    const release = frame.dock(slot, { fit: "fit" });
    expect(frame.box()).toMatchObject({ docked: "stage", scale: 1, width: 393, height: 852 });
    expect(frame.box()?.left).toBeCloseTo(100 + (2000 - 393) / 2);
    expect(ctx.state.frame.iframe?.tabIndex).toBe(0);

    release();
    expect(frame.box()?.docked).toBe("hidden");
    release();
  });

  it("actual size keeps scale 1 and clips to the clip element in local px", () => {
    ctx.state.active = "game";
    const slot = document.createElement("div");
    stubRect(slot, rectOf(0, 0, 300, 400));
    const clip = document.createElement("div");
    stubRect(clip, rectOf(0, 0, 300, 400));
    frame.dock(slot, { fit: "actual", clip });

    const box = frame.box();
    expect(box?.scale).toBe(1);
    expect(box?.left).toBeCloseTo((300 - 393) / 2);
    expect(boxElement().style.clipPath).toBe(
      `inset(${(852 - 400) / 2}px ${(393 - 300) / 2}px ${(852 - 400) / 2}px ${(393 - 300) / 2}px)`
    );
  });

  it("a landscape device swaps the box size", () => {
    ctx.state.device = { preset: "iphone-15", orientation: "landscape" };
    ctx.state.active = "game";
    const slot = document.createElement("div");
    stubRect(slot, rectOf(0, 0, 4000, 4000));
    frame.dock(slot, { fit: "fit" });
    expect(boxElement().style.width).toBe("852px");
    expect(boxElement().style.height).toBe("393px");
  });

  it("rounds the docked screen by the preset radius in local px (radius × scale on screen)", () => {
    ctx.state.active = "game";
    const slot = document.createElement("div");
    stubRect(slot, rectOf(0, 0, 393, 426));
    const clip = document.createElement("div");
    stubRect(clip, rectOf(-100, -100, 2000, 2000));
    frame.dock(slot, { fit: "fit", clip });
    expect(frame.box()?.scale).toBeCloseTo(0.5);
    expect(boxElement().style.clipPath).toBe("inset(0px 0px 0px 0px round 55px 55px 55px 55px)");

    ctx.state.device = { preset: "desktop", orientation: "portrait" };
    syncFrame(ctx);
    expect(boxElement().style.clipPath).toBe("inset(0px 0px 0px 0px)");
  });

  it("the pinned preview clips with the same rounded screen", () => {
    ctx.state.active = "flow";
    const body = document.createElement("div");
    stubRect(body, rectOf(0, 0, 150, 256));
    ctx.state.frame.previewBody = body;
    createFrameLayer(ctx);
    syncFrame(ctx);
    expect(frame.box()?.docked).toBe("preview");
    expect(boxElement().style.clipPath).toContain("round 55px");
  });

  it("an unfolded foldable docks its inner screen; folded, its cover", () => {
    ctx.state.active = "game";
    ctx.state.device = { preset: "galaxy-z-fold-6", orientation: "portrait", folded: false };
    const slot = document.createElement("div");
    stubRect(slot, rectOf(0, 0, 4000, 4000));
    frame.dock(slot, { fit: "fit" });
    expect(boxElement().style.width).toBe("707px");
    expect(boxElement().style.height).toBe("823px");

    ctx.state.device = { preset: "galaxy-z-fold-6", orientation: "portrait" };
    syncFrame(ctx);
    expect(boxElement().style.width).toBe("369px");
    expect(boxElement().style.height).toBe("905px");
  });

  it("a newer dock replaces an older one; the older release does nothing", () => {
    ctx.state.active = "game";
    const releaseOld = frame.dock(document.createElement("div"), { fit: "fit" });
    const slot = document.createElement("div");
    stubRect(slot, rectOf(10, 10, 393, 852));
    frame.dock(slot, { fit: "fit" });
    releaseOld();
    expect(frame.box()).toMatchObject({ docked: "stage", left: 10, top: 10 });
  });

  it("the iframe node never changes across switches and docks", () => {
    const iframe = ctx.state.frame.iframe;
    const src = iframe?.getAttribute("src");
    const slot = document.createElement("div");
    ctx.state.frame.previewBody = document.createElement("div");
    for (let index = 0; index < 10; index += 1) {
      ctx.state.active = index % 2 === 0 ? "game" : "flow";
      const release = frame.dock(slot, { fit: "fit" });
      syncFrame(ctx);
      release();
    }
    expect(document.querySelector("iframe[data-game-frame]")).toBe(iframe);
    expect(iframe?.getAttribute("src")).toBe(src);
    expect(iframe?.parentElement).toBe(boxElement());
  });
});

describe("dock observers", () => {
  it("re-syncs when the slot or clip resizes and disconnects on release", () => {
    const observers: { callback: () => void; disconnect: ReturnType<typeof vi.fn> }[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        readonly disconnect = vi.fn();
        constructor(callback: () => void) {
          observers.push({ callback, disconnect: this.disconnect });
        }
        observe(): void {}
      }
    );
    createFrameLayer(ctx);
    ctx.state.active = "game";
    const slot = document.createElement("div");
    const release = frame.dock(slot, { fit: "fit" });
    expect(observers).toHaveLength(1);

    stubRect(slot, rectOf(0, 0, 393, 852));
    observers[0]?.callback();
    expect(frame.box()?.scale).toBe(1);

    release();
    expect(observers[0]?.disconnect).toHaveBeenCalledTimes(1);
  });
});

describe("followTransitions", () => {
  it("runs a rAF sync loop from transitionrun to transitionend", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => frames.push(fn));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    createFrameLayer(ctx);
    const body = document.createElement("div");
    ctx.state.frame.previewBody = body;
    const element = document.createElement("section");
    const remove = followTransitions(ctx, element);

    element.dispatchEvent(new Event("transitionrun"));
    element.dispatchEvent(new Event("transitionrun"));
    expect(frames).toHaveLength(1);
    stubRect(body, rectOf(5, 5, 393, 852));
    frames[0]?.(0);
    expect(frame.box()).toMatchObject({ left: 5, top: 5 });
    expect(frames).toHaveLength(2);

    element.dispatchEvent(new Event("transitionend"));
    frames[1]?.(16);
    expect(frames).toHaveLength(2);

    remove();
    element.dispatchEvent(new Event("transitionrun"));
    expect(frames).toHaveLength(2);
  });
});

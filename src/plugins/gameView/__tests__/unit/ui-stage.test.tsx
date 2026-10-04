// @vitest-environment happy-dom

import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { updateSidePanel } from "../../../panels/shared/side-panel/store";
import type { LinkStatus } from "../../../registry/protocol";
import { stopGameView } from "../../lifecycle";
import { notify } from "../../state";
import { Stage } from "../../ui/Stage";
import { createCtx, manifestOf, type TestCtx } from "../helpers";
import { find, findAll, type Mounted, mount } from "../ui";

let ctx: TestCtx;
let view: Mounted | undefined;

/**
 * Mounts the stage with a link status.
 *
 * @param status - The status.
 * @returns The mounted stage.
 */
function stage(status?: LinkStatus): Mounted {
  view?.unmount();
  view = mount(<Stage ctx={ctx} status={status ?? { kind: "live", frame: 1841 }} />);
  return view;
}

/**
 * The badge texts.
 *
 * @param mounted - The stage.
 * @returns The texts.
 */
function badges(mounted: Mounted): string[] {
  return findAll(mounted.root, "[data-part='badge']").map(badge => badge.textContent ?? "");
}

beforeEach(() => {
  ctx = createCtx();
  ctx.workspace.activeValue = "game";
});

afterEach(() => {
  view?.unmount();
  view = undefined;
  stopGameView(ctx);
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("Stage", () => {
  it("docks the frame over its slot, clipped by the whole stage, and creates the overlay root", () => {
    const mounted = stage();
    const slot = find(mounted.root, "[data-part='slot']");
    const clip = find(mounted.root, "[data-game='stage'] > [data-part='clip']");
    expect(clip.getAttribute("aria-hidden")).toBe("true");
    expect(clip.style.right).toBe("0px");
    expect(ctx.workspace.dock).toHaveBeenCalledWith(slot, { fit: "fit", clip });
    expect(ctx.state.overlayRoot?.parentElement).toBe(ctx.workspace.overlayElement);
  });

  it("re-docks on a zoom change and releases on unmount; the iframe is never touched", () => {
    const mounted = stage();
    act(() => {
      ctx.state.zoom = "100";
      notify(ctx.state);
    });
    expect(ctx.workspace.release).toHaveBeenCalledTimes(1);
    expect(ctx.workspace.dock).toHaveBeenLastCalledWith(
      find(mounted.root, "[data-part='slot']"),
      expect.objectContaining({ fit: "actual" })
    );
    mounted.unmount();
    view = undefined;
    expect(ctx.workspace.release).toHaveBeenCalledTimes(2);
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("sizes the slot W·k × H·k from the measured stage", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1200,
      bottom: 800,
      width: 1200,
      height: 800,
      toJSON: () => ({})
    });
    const mounted = stage();
    const slot = find(mounted.root, "[data-part='slot']");
    const k = (800 - 56 - 26) / 852;
    expect(Number.parseFloat(slot.style.width)).toBeCloseTo(393 * k, 3);
    expect(Number.parseFloat(slot.style.height)).toBeCloseTo(852 * k, 3);
  });

  it("uses the device size at 100 %", () => {
    ctx.state.zoom = "100";
    const slot = find(stage().root, "[data-part='slot']");
    expect(slot.style.width).toBe("393px");
    expect(slot.style.height).toBe("852px");
  });

  it("draws the bezel for the device kind and orientation", () => {
    ctx.workspace.device = { preset: "ipad-mini", orientation: "landscape" };
    const bezel = find(stage().root, "[data-part='bezel']");
    expect(bezel.dataset.kind).toBe("tablet");
    expect(bezel.dataset.orientation).toBe("landscape");
  });

  it("shows the link badges (F12) and marks stale data", () => {
    expect(badges(stage({ kind: "paused", frame: 1841 }))).toEqual(["Paused · frame 1841"]);
    vi.spyOn(Date, "now").mockReturnValue(20_000);
    const silent = stage({ kind: "silent", since: 12_000, lastFrame: 12 });
    expect(badges(silent)).toEqual(["No heartbeat for 8 s · showing frame 12"]);
    expect(find(silent.root, "[data-game='stage']").dataset.stale).toBe("silent");
    const lost = stage({ kind: "lost", reason: "game_reloaded", lastFrame: 12, retryInMs: 1500 });
    expect(badges(lost)).toEqual([
      "Game page reloaded, reconnecting · retry in 2 s · last frame 12"
    ]);
    expect(find(lost.root, "[data-game='stage']").dataset.stale).toBe("lost");
    expect(badges(stage({ kind: "connecting" }))).toEqual(["Connecting"]);
  });

  it("shows Reloading game and the REC badge", () => {
    ctx.state.reloading = true;
    ctx.state.series.recording = {
      folder: "f/",
      label: "a",
      startedAt: performance.now(),
      durationMs: 2000,
      intervalMs: 100,
      planned: 20,
      phase: "recording",
      written: 0,
      stopRequested: false
    };
    expect(badges(stage())).toEqual(["Reloading game", "● REC 0.0 s"]);
  });

  it("shows the picker hint pill, and the calibration hint without a keyed element", () => {
    ctx.state.picker.on = true;
    expect(find(stage().root, "[data-part='hint']").textContent).toBe(
      "Hover the game, click to select · Esc"
    );
    ctx.state.calibrationRead = true;
    expect(find(stage().root, "[data-part='hint']").textContent).toBe(
      "Picker needs one keyed element"
    );
  });

  it("says the game reports no element rects when the manifest lists neither rect source", () => {
    ctx.link.manifestValue = manifestOf(undefined, ["game.ui"]);
    ctx.state.picker.on = true;
    expect(find(stage().root, "[data-part='hint']").textContent).toBe(
      "This game reports no element rects"
    );
    ctx.state.calibrationRead = true;
    expect(find(stage().root, "[data-part='hint']").textContent).toBe(
      "This game reports no element rects"
    );
  });

  it("keeps the picker hint on a game 0.4 manifest (game.locate)", () => {
    ctx.link.manifestValue = manifestOf(undefined, ["game.locate"]);
    ctx.state.picker.on = true;
    expect(find(stage().root, "[data-part='hint']").textContent).toBe(
      "Hover the game, click to select · Esc"
    );
  });

  it("ticks the REC badge while recording", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    ctx.state.series.recording = {
      folder: "f/",
      label: "a",
      startedAt: performance.now() - 2000,
      durationMs: 5000,
      intervalMs: 100,
      planned: 50,
      phase: "recording",
      written: 0,
      stopRequested: false
    };
    const mounted = stage();
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(badges(mounted)[0]).toMatch(/^● REC \d+\.\d s$/);
    mounted.unmount();
    view = undefined;
    vi.useRealTimers();
  });
});

/** Lets the cover's first measure (a microtask after the render) run and its render commit. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

/** The page rect of a box from its left, top, width and height. */
function rectOf(left: number, top: number, width: number, height: number): DOMRect {
  const box = {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height
  };
  return { ...box, toJSON: () => box } as DOMRect;
}

/**
 * Mounts the stage in a Game body beside an Element panel aside with its resize handle: the
 * stage spans 0..480 px, the drawer 200..480 px and its handle straddles the drawer's edge.
 *
 * @returns The mounted body.
 */
function stageBesideDrawer(): Mounted {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement
  ) {
    if (this.dataset.game === "stage") return rectOf(0, 50, 480, 800);
    if (this.dataset.sidePanel === "game.side") return rectOf(200, 50, 280, 800);
    if (this.dataset.part === "handle") return rectOf(197, 50, 6, 800);
    return rectOf(0, 0, 0, 0);
  });
  view?.unmount();
  view = mount(
    <div data-part="body">
      <Stage ctx={ctx} status={{ kind: "live", frame: 1 }} />
      <aside data-side-panel="game.side">
        <div data-part="handle" />
      </aside>
    </div>
  );
  return view;
}

describe("Stage beside the Element panel drawer", () => {
  afterEach(() => {
    updateSidePanel("game.side", { overlay: false, drawer: false });
    vi.unstubAllGlobals();
  });

  it("clips the docked frame to the stage left of the open drawer and its handle", async () => {
    updateSidePanel("game.side", { overlay: true, drawer: true });
    const mounted = stageBesideDrawer();
    await settle();

    const clip = find(mounted.root, "[data-part='clip']");
    expect(clip.style.right).toBe("283px");
    expect(ctx.workspace.dock).toHaveBeenLastCalledWith(find(mounted.root, "[data-part='slot']"), {
      fit: "fit",
      clip
    });
  });

  it("re-docks at once when the drawer opens and shuts; the newer dock comes before the release", async () => {
    updateSidePanel("game.side", { overlay: true, drawer: false });
    const mounted = stageBesideDrawer();
    const clip = find(mounted.root, "[data-part='clip']");
    expect(clip.style.right).toBe("0px");
    expect(ctx.workspace.dock).toHaveBeenCalledTimes(1);

    act(() => updateSidePanel("game.side", { drawer: true }));
    await settle();
    expect(clip.style.right).toBe("283px");
    expect(ctx.workspace.dock).toHaveBeenCalledTimes(2);
    expect(ctx.workspace.release).toHaveBeenCalledTimes(1);
    const [docked] = ctx.workspace.dock.mock.invocationCallOrder.slice(-1);
    const [released] = ctx.workspace.release.mock.invocationCallOrder.slice(-1);
    expect(docked ?? 0).toBeLessThan(released ?? 0);

    act(() => updateSidePanel("game.side", { drawer: false }));
    await settle();
    expect(clip.style.right).toBe("0px");
    expect(ctx.workspace.dock).toHaveBeenCalledTimes(3);
  });

  it("clips nothing while the Element panel is docked beside the stage", async () => {
    updateSidePanel("game.side", { overlay: false, drawer: true });
    const mounted = stageBesideDrawer();
    await settle();

    expect(find(mounted.root, "[data-part='clip']").style.right).toBe("0px");
  });

  it("follows a resize of the open drawer", async () => {
    const observers: (() => void)[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          observers.push(callback);
        }
        observe(): void {}
        disconnect(): void {}
      }
    );
    updateSidePanel("game.side", { overlay: true, drawer: true });
    const mounted = stageBesideDrawer();
    await settle();
    const aside = find(mounted.root, "aside[data-side-panel='game.side']");
    aside.querySelector("[data-part='handle']")?.remove();
    vi.spyOn(aside, "getBoundingClientRect").mockReturnValue(rectOf(120, 50, 360, 800));

    act(() => {
      for (const callback of observers) callback();
    });

    expect(find(mounted.root, "[data-part='clip']").style.right).toBe("360px");
  });
});

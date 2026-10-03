// @vitest-environment happy-dom

import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LinkStatus } from "../../../registry/protocol";
import { stopGameView } from "../../lifecycle";
import { notify } from "../../state";
import { Stage } from "../../ui/Stage";
import { createCtx, type TestCtx } from "../helpers";
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
  it("docks the frame over its slot, clipped by the stage viewport, and creates the overlay root", () => {
    const mounted = stage();
    const slot = find(mounted.root, "[data-part='slot']");
    const viewport = find(mounted.root, "[data-part='viewport']");
    expect(ctx.workspace.dock).toHaveBeenCalledWith(slot, { fit: "fit", clip: viewport });
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

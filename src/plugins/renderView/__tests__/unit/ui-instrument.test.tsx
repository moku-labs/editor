// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoDirectory } from "../device-fixtures";
import { stubFrames } from "../helpers";
import { type MissionCtx, missionCtx } from "../mission-ctx";
import { click, feedDemo, fire, type Mounted, mountRender } from "../mission-ui";

// ─────────────────────────────────────────────────────────────────────────────
// components/instrument/* (spec 09 § M8, M11, M16 ui-instrument): a drag across
// the timeline selects a range and the inspector shows it, a click on the lane
// selects one frame, the focused timeline's keys step, jump and pause, and
// "Back to live" shows only while the view is paused. The view's end is the
// newest frame's (no clock arrival): 6 s of the demo phone end at f4960.
// ─────────────────────────────────────────────────────────────────────────────

let ctx: MissionCtx;
let view: Mounted;

/** The canvases' box: a 1050 px timeline (1000 px plot), a 78 px lane. */
function boxes(): void {
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLCanvasElement
  ) {
    const height = this.dataset.paint === "lane" ? 78 : 262;
    return { left: 0, top: 0, width: 1050, height, right: 1050, bottom: height } as DOMRect;
  });
}

/**
 * A pointer event at an x of a plot.
 *
 * @param type - The event type.
 * @param x - clientX.
 * @returns The event.
 */
function pointer(type: string, x: number): Event {
  return Object.assign(
    new MouseEvent(type, { bubbles: true, clientX: x, clientY: 120, button: 0 }),
    {
      pointerId: 1
    }
  );
}

beforeEach(() => {
  stubFrames();
  boxes();
  ctx = missionCtx({ device: true });
  ctx.activeSource.directoryValue = demoDirectory();
  view = mountRender(ctx);
  feedDemo(ctx);
});

afterEach(() => {
  view.unmount();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the instrument", () => {
  it("a drag across the timeline selects a range, and the inspector shows that range", () => {
    const timeline = view.q("canvas[data-paint='timeline']");
    fire(timeline, pointer("pointerdown", 400));
    fire(timeline, pointer("pointermove", 403));
    expect(ctx.state.mission.selection?.from).toBe(ctx.state.mission.selection?.to);
    fire(timeline, pointer("pointermove", 700));
    fire(timeline, pointer("pointerup", 700));

    const selection = ctx.state.mission.selection;
    expect(ctx.state.mission.view.live).toBe(false);
    expect(selection).toBeDefined();
    expect((selection?.to ?? 0) - (selection?.from ?? 0)).toBeGreaterThan(10);
    expect(view.q("[data-render='inspector'] [data-part='title']")?.textContent).toBe(
      `f${selection?.from}–f${selection?.to}`
    );
  });

  it("a click on the lane selects one frame", () => {
    const lane = view.q("canvas[data-paint='lane']");
    fire(lane, pointer("pointerdown", 500));
    fire(lane, pointer("pointerup", 501));

    const selection = ctx.state.mission.selection;
    expect(selection).toBeDefined();
    expect(selection?.from).toBe(selection?.to);
  });

  it("the focused timeline's keys: ← steps a frame, Shift+→ jumps to the next spike group, Space goes live", () => {
    const timeline = view.q("canvas[data-paint='timeline']");
    fire(timeline, new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    const stepped = ctx.state.mission.selection;
    expect(stepped?.from).toBe(stepped?.to);
    expect(ctx.state.mission.view.live).toBe(false);

    const next = new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true });
    fire(timeline, next);
    expect(ctx.state.mission.selection).toEqual({ from: 4802, to: 4802 });
    fire(
      timeline,
      new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true })
    );
    expect(ctx.state.mission.selection).toEqual({ from: 4851, to: 4853 });

    fire(timeline, new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(ctx.state.mission.view.live).toBe(true);
    expect(ctx.state.mission.selection).toBeUndefined();
  });

  it("shows Back to live only while paused", () => {
    expect(view.q("[data-action='back-to-live']")).toBeNull();
    click(view.q("[data-live-toggle]"));
    expect(view.q("[data-live-toggle]")?.getAttribute("aria-pressed")).toBe("false");
    expect(view.q("[data-behind]")?.textContent).toMatch(/^Paused · \d+\.\d s behind live$/u);

    click(view.q("[data-action='back-to-live']"));
    expect(ctx.state.mission.view.live).toBe(true);
    expect(view.q("[data-action='back-to-live']")).toBeNull();
  });
});

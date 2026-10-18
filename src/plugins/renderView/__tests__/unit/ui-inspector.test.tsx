// @vitest-environment happy-dom
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendFrames } from "../../source/contract";
import { notifyMission } from "../../state";
import { demoDirectory, demoFrames } from "../device-fixtures";
import { stubFrames } from "../helpers";
import { type MissionCtx, missionCtx } from "../mission-ctx";
import { feedDemo, fire, type Mounted, mountRender } from "../mission-ui";

// ─────────────────────────────────────────────────────────────────────────────
// components/inspector/* (spec 09 § M10, M16 ui-inspector): the summary of the
// view is re-derived at most once a second while live, and never while the
// pointer is over it, so its rows do not jump under the hand.
// ─────────────────────────────────────────────────────────────────────────────

let ctx: MissionCtx;
let view: Mounted;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["performance"] });
  stubFrames();
  ctx = missionCtx({ device: true });
  ctx.activeSource.directoryValue = demoDirectory();
  view = mountRender(ctx);
  feedDemo(ctx, 4700);
});

afterEach(() => {
  view.unmount();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/**
 * The summary's sub line ("{n} frames from Galaxy A26").
 *
 * @returns The words.
 */
function sub(): string | undefined {
  return view.q("[data-render='inspector'] [data-part='sub']")?.textContent ?? undefined;
}

/** New frames arrive a few seconds later and Mission control re-renders. */
function moreFrames(): void {
  vi.advanceTimersByTime(2000);
  appendFrames(ctx.state.mission.history, demoFrames(4700, 4960));
  act(() => notifyMission(ctx.state.mission));
}

describe("the inspector's summary", () => {
  it("does not change while the pointer is over it, and follows the view once it leaves", () => {
    const before = sub();
    expect(before).toMatch(/^\d+ frames from Galaxy A26$/u);
    const inspector = view.q("[data-render='inspector']");

    fire(inspector, new Event("pointerenter"));
    moreFrames();
    expect(sub()).toBe(before);

    fire(inspector, new Event("pointerleave"));
    moreFrames();
    expect(sub()).not.toBe(before);
  });

  it("is re-derived at most once a second while live", () => {
    const before = sub();
    appendFrames(ctx.state.mission.history, demoFrames(4700, 4960));
    act(() => notifyMission(ctx.state.mission));
    expect(sub()).toBe(before);

    vi.advanceTimersByTime(1100);
    act(() => notifyMission(ctx.state.mission));
    expect(sub()).not.toBe(before);
  });
});

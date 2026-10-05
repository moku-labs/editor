// @vitest-environment happy-dom
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stopGameView } from "../../lifecycle";
import { notify } from "../../state";
import { SeriesPopover } from "../../ui/SeriesPopover";
import { createCtx, type TestCtx, useScene } from "../helpers";
import { button, click, find, findAll, type Mounted, mount, settle } from "../ui";

let ctx: TestCtx;
let view: Mounted;

/** Opens the popover. */
function open(): void {
  act(() => {
    ctx.state.series.popover = true;
    notify(ctx.state);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 24, 10, 15));
  ctx = createCtx();
  useScene(ctx);
  view = mount(<SeriesPopover ctx={ctx} />);
});

afterEach(() => {
  view.unmount();
  stopGameView(ctx);
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("SeriesPopover", () => {
  it("renders nothing while closed", () => {
    expect(view.root.querySelector("[data-game='series']")).toBeNull();
  });

  it("offers the duration and interval chips with the planned shots and the folder", () => {
    open();
    const popover = find(view.root, "[data-game='series']");
    expect(popover.getAttribute("popover")).toBe("manual");
    expect(find(popover, "h2").textContent).toBe("Record a series");
    const durations = find(popover, "[role='radiogroup'][aria-label='Duration']");
    expect(findAll(durations, "[role='radio']").map(chip => chip.textContent)).toEqual([
      "1 s",
      "2 s",
      "5 s",
      "10 s",
      "20 s"
    ]);
    const intervals = find(popover, "[role='radiogroup'][aria-label='Interval']");
    expect(findAll(intervals, "[role='radio']").map(chip => chip.textContent)).toEqual([
      "16 ms",
      "50 ms",
      "100 ms",
      "250 ms",
      "500 ms",
      "1000 ms"
    ]);
    expect(find(popover, "[data-part='result']").textContent).toBe("20 shots · 2 s at 100 ms");
    expect(popover.querySelector("[data-part='warning']")).toBeNull();
    expect(find(popover, "[data-part='folder']").textContent).toBe(
      "Saves to .moku/captures/2026-09-24/series-1015/ with index.json"
    );
  });

  it("warns above seriesWarnShots", () => {
    open();
    click(button(view.root, "20 s"));
    click(button(view.root, "16 ms"));
    expect(find(view.root, "[data-part='result']").textContent).toBe("1250 shots · 20 s at 16 ms");
    expect(find(view.root, "[data-part='warning']").textContent).toBe(
      "! 1250 shots is a large series."
    );
  });

  it("Cancel closes; Start records with the chosen input", async () => {
    open();
    click(button(view.root, "Cancel"));
    expect(ctx.state.series.popover).toBe(false);

    open();
    click(button(view.root, "1 s"));
    click(button(view.root, "50 ms"));
    click(button(view.root, "● Start"));
    await settle();
    expect(ctx.workspace.show).toHaveBeenCalledWith("game");
    expect(ctx.panels.run).toHaveBeenCalledWith("editor.series", {
      durationMs: 1000,
      intervalMs: 50
    });
  });

  it("shows the recording view while recording, with Stop", () => {
    open();
    act(() => {
      ctx.state.series.recording = {
        folder: ".moku/captures/2026-09-24/series-1015/",
        label: "a",
        startedAt: performance.now() - 1000,
        durationMs: 2000,
        intervalMs: 100,
        planned: 20,
        phase: "recording",
        written: 0,
        stopRequested: false
      };
      notify(ctx.state);
    });
    const ring = find(view.root, "[role='progressbar']");
    expect(Number(ring.getAttribute("aria-valuenow"))).toBeGreaterThanOrEqual(50);
    expect(view.root.textContent).toContain("Writing to .moku/captures/2026-09-24/series-1015/");
    expect(find(view.root, "[data-part='shots']").textContent).toMatch(/^≈1\d of 20$/);
    click(button(view.root, "Stop"));
    expect(ctx.panels.run).toHaveBeenCalledWith("editor.seriesStop");

    act(() => {
      const { recording } = ctx.state.series;
      if (recording) {
        recording.phase = "writing";
        recording.written = 2;
      }
      notify(ctx.state);
    });
    expect(view.root.textContent).toContain("Writing 2 of 20 shots…");
  });
});

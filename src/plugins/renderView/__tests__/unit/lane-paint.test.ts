import { describe, expect, it } from "vitest";
import { appendEvents, appendFrames } from "../../source/contract";
import { createRenderViewState } from "../../state";
import { paintLane } from "../../timeline/lane";
import { laneLayout } from "../../timeline/layout";
import { createPaintScene } from "../../timeline/scene";
import { CONFIG } from "../helpers";
import { eventsOf, line, rowsOf, wireOf } from "../mission-fixtures";
import { PALETTE, recorder } from "../paint-recorder";

// ─────────────────────────────────────────────────────────────────────────────
// timeline/lane.ts (spec 09 § M8 Shaders & passes lane): passes stacked per
// frame by view colour, compiles inside a frame marked, boot compiles not.
// ─────────────────────────────────────────────────────────────────────────────

const LAYOUT = laneLayout(960, 78, 1);

/**
 * Mission control with 60 frames from page-clock 10 s, two passes each (main, fogLayer), and a boot
 * compile at f5 and a compile inside f30.
 *
 * @returns The mission state.
 */
function mission() {
  const { mission: state } = createRenderViewState({ config: CONFIG });
  const rows = rowsOf(1, 60, { t0: 10_000 });
  const passes = rows.flatMap((_, row) => [
    { row, index: 0, kind: "canvas" as const, view: "main", gpuMs: 2 },
    {
      row,
      index: 1,
      kind: "filter" as const,
      view: "fogLayer",
      owner: 412,
      filter: "fog.blur",
      gpuMs: 4
    }
  ]);
  appendFrames(state.history, wireOf(rows, { passes }));
  appendEvents(
    state.history,
    eventsOf([
      line.shader(10_000 + 4 * 16.67, 5, "boot.sprite", 12, true),
      line.shader(10_000 + 29 * 16.67, 30, "fog.blur", 31)
    ])
  );
  return state;
}

/**
 * A scene over the 60 frames.
 *
 * @returns The scene.
 */
function scene() {
  const painted = createPaintScene(PALETTE);
  painted.endMs = 11_100;
  painted.liveEndMs = 11_100;
  return painted;
}

describe("paintLane", () => {
  it("boot compiles get no mark, a compile inside a frame gets one", () => {
    // Bug: every program compiled while loading drawn as a spike on the lane.
    const { g, of, texts } = recorder();

    paintLane(g, LAYOUT, mission(), scene());

    const diamonds = of("fill").filter(call => call.fillStyle === "pickBlue" && call.alpha === 1);
    expect(diamonds).toHaveLength(1);
    expect(texts()).toContain("compile fog.blur 31 ms, by fogLayer");
    expect(texts().some(text => text.includes("boot.sprite"))).toBe(false);
  });

  it("stacks each frame's passes by view colour, main first", () => {
    // Bug: the passes of a frame drawn over each other (only the last one visible).
    const { g, of } = recorder();

    paintLane(g, LAYOUT, mission(), scene());

    const main = of("fillRect").filter(call => call.fillStyle === "phase1");
    const fog = of("fillRect").filter(call => call.fillStyle === "pickPink");
    expect(main).toHaveLength(60);
    expect(fog).toHaveLength(60);
    expect((fog[0]?.args[1] ?? 0) + (fog[0]?.args[3] ?? 0)).toBeCloseTo(main[0]?.args[1] ?? 0, 5);
  });

  it("says the section is off instead of an empty lane", () => {
    // Bug: an empty lane read as "no passes ran".
    const painted = scene();
    painted.passes = false;
    const { g, texts, of } = recorder();

    paintLane(g, LAYOUT, mission(), painted);

    expect(texts()).toContain("Shaders & passes is off: turn it on in Monitoring");
    expect(of("fillRect").some(call => call.fillStyle === "phase1")).toBe(false);
  });
});

describe("an empty lane", () => {
  it("says passes show once frames arrive", () => {
    // Bug: an empty lane read as "no passes ran" before the first frames.
    const { mission: empty } = createRenderViewState({ config: CONFIG });
    const { g, texts } = recorder();
    paintLane(g, LAYOUT, empty, scene());
    expect(texts()).toContain("Passes show here once frames arrive");
  });
});

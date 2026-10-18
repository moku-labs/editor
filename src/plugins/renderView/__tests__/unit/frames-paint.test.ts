/* eslint-disable unicorn/no-null -- null: no clock offset, no time origin yet */
import { describe, expect, it } from "vitest";
import { pushSample } from "../../series/series";
import { appendEvents, appendFrames, REST } from "../../source/contract";
import { createRenderViewState } from "../../state";
import { paintFrames } from "../../timeline/frames";
import { flagAt } from "../../timeline/hit";
import { framesLayout, xOf, yMaxOf, yOf } from "../../timeline/layout";
import { createPaintScene, markerTime, setMarker } from "../../timeline/scene";
import type { MissionState } from "../../types";
import { recorderOf } from "../device-fixtures";
import { CONFIG } from "../helpers";
import { bitsOf, ENGINE_REST, eventsOf, line, type Row, rowsOf, wireOf } from "../mission-fixtures";
import { PALETTE, recorder } from "../paint-recorder";

// ─────────────────────────────────────────────────────────────────────────────
// timeline/frames.ts and marks.ts (spec 09 § M8): what paintFrames draws, read
// from a recording fake context.
// ─────────────────────────────────────────────────────────────────────────────

const LAYOUT = framesLayout(960, 262, 1);

/**
 * Mission control's state with rows.
 *
 * @param rows - The rows.
 * @returns The mission state.
 */
function missionOf(rows: readonly Row[]): MissionState {
  const { mission } = createRenderViewState({ config: CONFIG });
  appendFrames(mission.history, wireOf(rows));
  return mission;
}

/**
 * A scene at an end and span.
 *
 * @param endMs - The view's end.
 * @param span - The view's span.
 * @returns The scene.
 */
function sceneAt(endMs: number, span: 6000 | 30_000 | 120_000 = 6000) {
  const scene = createPaintScene(PALETTE);
  scene.endMs = endMs;
  scene.liveEndMs = endMs;
  scene.span = span;
  return scene;
}

describe("paintFrames", () => {
  it("rows newer than the display clock are not drawn", () => {
    // Bug: the playout delay lost: the newest rows drawn past the right edge before their time.
    const mission = missionOf(rowsOf(1, 600, { t0: 10_000 }));
    const end = 10_000 + 400 * 16.67;
    const { g, of } = recorder();

    paintFrames(g, LAYOUT, mission, sceneAt(end));

    const bars = of("fillRect").filter(call => call.fillStyle === "phase3");
    const drawn = mission.history.t
      .subarray(0, 600)
      .filter(t => t + 10 > end - 6000 && t < end).length;
    expect(bars).toHaveLength(drawn);
    expect(bars.every(call => (call.args[0] ?? 0) < LAYOUT.plot.w)).toBe(true);
  });

  it("the budget line steps where budgetMs changes and is dashed above 20 ms", () => {
    // Bug: one flat budget across a rest (the 33.3 ms rest budget drawn as the awake one).
    const rows = rowsOf(1, 300, {
      t0: 10_000,
      each: index =>
        index < 200 ? { budgetMs: 16.67 } : { budgetMs: 33.3, ms: 33.3, rest: REST.idle }
    });
    const mission = missionOf(rows);
    const end = 10_000 + 300 * 16.67;
    const { g, of } = recorder();

    paintFrames(g, LAYOUT, mission, sceneAt(end));

    const yMax = yMaxOf(16.67);
    const budget = of("stroke").filter(call => call.lineWidth === 1.25);
    expect(budget.map(call => call.dash)).toEqual([[], [4, 3]]);
    const levels = of("lineTo").map(call => call.args[1] ?? 0);
    const near = (y: number) => levels.some(level => Math.abs(level - y) < 0.01);
    expect(near(yOf(LAYOUT, 16.67, yMax))).toBe(true);
    expect(near(yOf(LAYOUT, 33.3, yMax))).toBe(true);
  });

  it("over 1.6 rows per px the painter switches to 2 px columns of the worst frame", () => {
    // Bug: a spike lost in aggregation (an average, or the column's first frame drawn).
    const rows = rowsOf(1, 7200, {
      t0: 10_000,
      each: index => (index === 4000 ? { ms: 41, jsMs: 30, causes: bitsOf("js") } : {})
    });
    const mission = missionOf(rows);
    const end = 10_000 + 7200 * 16.67;
    const { g, of } = recorder();

    paintFrames(g, LAYOUT, mission, sceneAt(end, 120_000));

    const bars = of("fillRect").filter(call => call.fillStyle === "phase3");
    expect(bars.length).toBeLessThanOrEqual(Math.ceil(LAYOUT.plot.w / 2) + 1);
    expect(bars.every(call => call.args[2] === 1.6)).toBe(true);
    expect(of("fillRect").some(call => call.fillStyle === "warn")).toBe(true);
  });

  it("columns follow the data's time: a scroll shifts every column and keeps each one's worst frame", () => {
    // Bug: columns cut from the moving left edge: a sub-column scroll regroups the frames, so
    // columns jump in 2 px steps and their heights flicker (the 30 s / 2 min artifacts on the A26).
    const rows = rowsOf(1, 7200, {
      t0: 10_000,
      each: index => ({ ms: 8 + ((index * 7) % 11), jsMs: 4 + ((index * 7) % 11) })
    });
    const mission = missionOf(rows);
    const end = 10_000 + 6000 * 16.67;
    const columnMs = (2 * 120_000) / LAYOUT.plot.w;
    const shift = columnMs / 3;
    const first = recorder();
    const second = recorder();

    paintFrames(first.g, LAYOUT, mission, sceneAt(end, 120_000));
    paintFrames(second.g, LAYOUT, mission, sceneAt(end + shift, 120_000));

    const bars = (calls: ReturnType<typeof first.of>) =>
      calls
        .filter(call => call.fillStyle === "phase3")
        .map(call => ({ x: call.args[0] ?? 0, h: call.args[3] ?? 0 }));
    const before = bars(first.of("fillRect"));
    const after = bars(second.of("fillRect"));
    const px = (shift / 120_000) * LAYOUT.plot.w;
    // The same columns (one may leave at the left), each moved left by the scroll, same height.
    const moved = after.slice(-100);
    const source = before.slice(-100);
    expect(moved.map(bar => bar.h)).toEqual(source.map(bar => bar.h));
    for (const [index, bar] of moved.entries()) {
      expect(bar.x).toBeCloseTo((source[index]?.x ?? 0) - px, 6);
    }
  });

  it("the GC lane says 'not measured on this device' without a memory source, 'off' when switched off", () => {
    // Bug: an empty lane read as "no GC happened" on an iPhone.
    const mission = missionOf(rowsOf(1, 10));
    const scene = sceneAt(10_200);
    const first = recorder();

    scene.gc = "none";
    paintFrames(first.g, LAYOUT, mission, scene);
    scene.gc = "off";
    const second = recorder();
    paintFrames(second.g, LAYOUT, mission, scene);

    expect(first.texts()).toContain("GC marks are not measured on this device");
    expect(second.texts()).toContain("GC marks are off: Memory & GC is switched off");
  });

  it("flags never overlap and each box selects its group", () => {
    // Bug: chips of close spikes drawn on top of each other (unreadable, unclickable).
    const rows = rowsOf(1, 360, {
      t0: 10_000,
      each: index => (index % 6 === 0 ? { ms: 30, causes: bitsOf("js") } : {})
    });
    const mission = missionOf(rows);
    const scene = sceneAt(10_000 + 360 * 16.67);
    const { g } = recorder();

    paintFrames(g, LAYOUT, mission, scene);

    const { hits } = scene;
    expect(hits.count).toBeGreaterThan(5);
    for (let index = 1; index < hits.count; index += 1) {
      const previousRight = (hits.x[index - 1] ?? 0) + (hits.w[index - 1] ?? 0);
      expect(hits.x[index] ?? 0).toBeGreaterThanOrEqual(previousRight + 4 - 0.001);
    }
    const flag = flagAt(hits, (hits.x[0] ?? 0) + 1, (hits.y[0] ?? 0) + 1);
    expect([hits.from[flag], hits.to[flag]]).toEqual([1, 1]);
  });

  it("the source switch marker is drawn at the first row of the new source", () => {
    // Bug: a marker placed with offset 0 on a phone (seconds off), or not drawn at all.
    const mission = missionOf(rowsOf(1, 300, { t0: 20_000 }));
    const scene = sceneAt(20_000 + 300 * 16.67);
    const marker = {
      at: 1_792_000_093_963,
      kind: "lost" as const,
      label: "Galaxy A26 disconnected here · Local preview resumed",
      device: "d-7f3a"
    };
    setMarker(scene, marker, markerTime(marker, null, null, mission.history.t[0]), "Galaxy A26");
    const { g, of, texts } = recorder();

    paintFrames(g, LAYOUT, mission, scene);

    const x = xOf(LAYOUT, 20_000, scene.endMs - scene.span, scene.span);
    const marked = of("moveTo").filter(call => call.dash.join(",") === "4,3" && call.args[0] === x);
    expect(marked).toHaveLength(1);
    expect(texts()).toContain("Local preview resumed");
    expect(markerTime(marker, -412, 1_792_000_000_000, 20_000)).toBe(93_963 - 412);
  });
});

describe("marks", () => {
  it("an inferred GC is drawn hollow, the engine's GC filled, with 'GC {mb} MB' at 6 s", () => {
    // Bug: a GC inferred from a heap drop drawn as a measured one.
    const mission = missionOf(rowsOf(1, 300, { t0: 10_000 }));
    appendEvents(mission.history, eventsOf([line.gc(11_000, 60, 4.2)]));
    pushSample(mission.series.gcs, 12_000, 6);
    mission.series.gcs.inferred[0] = 1;
    const { g, of, texts } = recorder();

    paintFrames(g, LAYOUT, mission, sceneAt(15_000));

    expect(of("fill").filter(call => call.fillStyle === "teal")).toHaveLength(1);
    expect(
      of("stroke").filter(call => call.strokeStyle === "teal" && call.dash.join(",") === "2,2")
    ).toHaveLength(1);
    expect(texts()).toEqual(expect.arrayContaining(["GC 4.2 MB", "GC 6 MB"]));
  });

  it("at 30 s flags are pins; rate changes are chips at ≤ 30 s and triangles at 2 min", () => {
    // Bug: unreadable chips crammed into a 2-minute view.
    const mission = missionOf(
      rowsOf(1, 1800, {
        t0: 10_000,
        each: index => (index === 900 ? { ms: 40, causes: bitsOf("gpu") } : {})
      })
    );
    appendEvents(
      mission.history,
      eventsOf([line.rate(20_000, 600, 120, 60), line.rate(25_000, 900, 60, 120, "headroom")])
    );
    const thirty = recorder();
    paintFrames(thirty.g, LAYOUT, mission, sceneAt(10_000 + 1800 * 16.67, 30_000));
    expect(thirty.texts()).toEqual(
      expect.arrayContaining(["120 → 60, missed frames", "60 → 120, back on time"])
    );
    expect(thirty.texts().some(text => text.startsWith("GPU"))).toBe(false);

    const twoMinutes = recorder();
    paintFrames(twoMinutes.g, LAYOUT, mission, sceneAt(10_000 + 1800 * 16.67, 120_000));
    expect(twoMinutes.texts().some(text => text.includes("→"))).toBe(false);
    expect(
      twoMinutes.of("fill").filter(call => call.fillStyle === "warn" || call.fillStyle === "live")
    ).toHaveLength(2);
  });

  it("a recording draws its stripe from its start and a pill per mark", () => {
    // Bug: the stripe starting at the tools page's clock, not the phone's.
    const mission = missionOf(rowsOf(1, 360, { t0: 10_000 }));
    mission.recorder = {
      ...recorderOf({ sinceMs: 2000 }),
      marks: [{ atMs: 1000, label: "boss intro", auto: false }]
    };
    const { g, of, texts } = recorder();
    const scene = sceneAt(10_000 + 360 * 16.67);

    paintFrames(g, LAYOUT, mission, scene);

    const newest = 10_000 + 359 * 16.67;
    const stripe = of("fillRect").find(call => call.fillStyle === "error" && call.args[3] === 3);
    expect(stripe?.args[0]).toBeCloseTo(
      xOf(LAYOUT, newest - 2000, scene.endMs - scene.span, scene.span),
      3
    );
    expect(texts()).toContain("boss intro");
  });

  it("resting runs and breaks are labelled when wide enough; a frame the renderer did not draw gets a caret", () => {
    // Bug: a long rest read as a slow frame, or an undrawn frame shown as a normal bar.
    const mission = missionOf([
      ...rowsOf(1, 60, { t0: 10_000, each: index => (index === 3 ? { drawn: 0 } : {}) }),
      { frame: 61, t: 11_100, ms: 2000, rest: REST.idle, budgetMs: 33.3, rateMs: 33.3 },
      { frame: 62, t: 13_200, ms: 1500, rest: REST.break, budgetMs: 33.3, rateMs: 33.3 },
      ...rowsOf(63, 20, { t0: 14_800 })
    ]);
    const { g, of, texts } = recorder();

    paintFrames(g, LAYOUT, mission, sceneAt(16_000));

    expect(texts()).toEqual(
      expect.arrayContaining(["Resting at 30 fps, budget 33.3 ms", "Break 1.5 s"])
    );
    expect(
      of("fillRect").filter(
        call => call.fillStyle === "warn" && call.args[2] === 1 && call.args[3] === 3
      )
    ).toHaveLength(1);
  });
});

describe("the rest rate (real engine rows)", () => {
  it("a resting run of the real engine is labelled at its budget's rate, 30 fps, not the loop's 60", () => {
    // Bug: the rest rate read from rateMs, which the engine keeps at the loop's 16.67 ms while it
    // rests at a 33.3 ms budget: "Resting at 60 fps, budget 33.3 ms".
    const mission = missionOf([
      ...rowsOf(1, 60, { t0: 10_000 }),
      { frame: 61, t: 11_100, ...ENGINE_REST, ms: 2000 },
      ...rowsOf(62, 20, { t0: 13_200 })
    ]);
    const { g, texts } = recorder();

    paintFrames(g, LAYOUT, mission, sceneAt(14_000));

    expect(texts()).toContain("Resting at 30 fps, budget 33.3 ms");
    expect(texts().some(text => text.startsWith("Resting at 60"))).toBe(false);
  });
});

describe("flag words", () => {
  it("each cause has its chip: GPU counts its frames, the others name their worst ms", () => {
    // Bug: "GPU 30 ms" for a sustained GPU group (its point is how many frames in a row).
    const mission = missionOf(
      rowsOf(1, 360, {
        t0: 10_000,
        each: index => {
          if (index >= 10 && index <= 12) return { ms: 30, causes: bitsOf("gpu") };
          if (index === 100) return { ms: 31, causes: bitsOf("compile", "js") };
          if (index === 200) return { ms: 40, causes: bitsOf("upload", "js") };
          if (index === 300) return { ms: 90, causes: bitsOf("longFrame") };
          return {};
        }
      })
    );
    const { g, texts } = recorder();
    paintFrames(g, LAYOUT, mission, sceneAt(10_000 + 360 * 16.67));
    expect(texts()).toEqual(
      expect.arrayContaining(["GPU ×3", "Shader 31 ms", "Upload 40 ms", "Long frame 90 ms"])
    );
  });
});

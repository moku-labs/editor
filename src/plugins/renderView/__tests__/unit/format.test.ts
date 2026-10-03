import { describe, expect, it } from "vitest";
import { boundsText, fixed, sparkPoints, tagOfUse, tileViews } from "../../format";

// ─────────────────────────────────────────────────────────────────────────────
// format.ts: the texts of the six tiles, the sparkline points and the tags.
// ─────────────────────────────────────────────────────────────────────────────

describe("tileViews", () => {
  it("names what is waiting and what the game does not report", () => {
    const views = tileViews({
      fps: undefined,
      frameMs: undefined,
      drawCalls: undefined,
      textures: undefined,
      scene: undefined,
      heap: { kind: "absent" }
    });

    expect(views.map(view => [view.id, view.value, view.sub])).toEqual([
      ["fps", "—", "Waiting for game.render"],
      ["frame", "—", "Waiting for game.render"],
      ["draws", "—", "Waiting for game.render"],
      ["textures", "—", "Waiting for game.render and game.assets"],
      ["scene", "—", "Waiting for the scene"],
      ["heap", "Not reported", "Needs heap numbers in game.render"]
    ]);
    expect(views[5]).toMatchObject({ absent: true, aria: "JS heap: not reported" });
  });

  it("formats every tile with data", () => {
    const views = tileViews({
      fps: { now: 59.6, samples: [58, 60, 59.6], low: 58 },
      frameMs: 3.4,
      drawCalls: { kind: "absent" },
      textures: { gpuMb: 41.25, count: 12, bundles: 2, budgetMb: 192, unused: 3, unusedMb: 5.73 },
      scene: { entities: 101, views: 180, pooled: 24 },
      heap: { kind: "absent" }
    });

    expect(views.map(view => [view.value, view.unit, view.sub, view.warn])).toEqual([
      ["60", "fps", "last 3 samples · low 58", undefined],
      ["3.4", "ms", "Phase split not reported by game.render", undefined],
      ["Not counted in a production build", "", "game.render reports no draw counter", undefined],
      ["41.25", "MB GPU", "12 textures · 2 bundles · of 192 MB budget", "3 unused · 5.73 MB"],
      ["101", "entities", "180 display objects · 24 pooled", undefined],
      ["Not reported", "", "Needs heap numbers in game.render", undefined]
    ]);
    expect(views[2]).toMatchObject({
      absent: true,
      aria: "Draw calls: not counted in a production build"
    });
    expect(views[4]?.note).toBe("Particles and filters are not reported (follow-up F-R1)");
  });

  it("shows a draw counter and no warn line without unused textures", () => {
    const views = tileViews({
      fps: undefined,
      frameMs: undefined,
      drawCalls: { kind: "value", value: 42 },
      textures: { gpuMb: 1, count: 1, bundles: 1, budgetMb: 192, unused: 0, unusedMb: 0 },
      scene: undefined,
      heap: { kind: "absent" }
    });

    expect(views[2]).toMatchObject({ value: "42", unit: "per frame", absent: false });
    expect(views[3]?.warn).toBeUndefined();
  });
});

/** The tiles without fps, frame time and texture data. */
const EMPTY = {
  fps: undefined,
  frameMs: undefined,
  textures: undefined,
  heap: { kind: "absent" }
} as const;

/**
 * The Draw calls tile view of some tile data.
 *
 * @param drawCalls - The tile data.
 * @returns The view.
 */
function draws(drawCalls: Parameters<typeof tileViews>[0]["drawCalls"]) {
  return tileViews({ ...EMPTY, drawCalls, scene: undefined })[2];
}

describe("tileViews on game 0.0.3", () => {
  it("shows the effects line on the Scene tile", () => {
    const views = tileViews({
      ...EMPTY,
      drawCalls: undefined,
      scene: {
        entities: 101,
        views: 180,
        pooled: 24,
        effects: { particles: 18, emitters: 1, filters: 24, renderPasses: 49 }
      }
    });

    expect(views[4]).toMatchObject({
      sub: "180 display objects · 24 pooled",
      note: "18 particles · 1 emitters · 24 filters"
    });
    expect(views[0]?.note).toBeUndefined();
  });

  it("names the Draw calls texts with and without render passes", () => {
    expect(draws({ kind: "value", value: 14, renderPasses: 1 })).toMatchObject({
      value: "14",
      unit: "per frame",
      sub: "1 render passes",
      absent: false
    });
    expect(draws({ kind: "value", value: 14 })).toMatchObject({ value: "14", sub: "game.render" });
    expect(draws({ kind: "absent", renderPasses: 3 })).toMatchObject({
      value: "Not counted in a production build",
      sub: "3 render passes",
      absent: true,
      aria: "Draw calls: not counted in a production build"
    });
    expect(draws({ kind: "absent" })).toMatchObject({
      value: "Not counted in a production build",
      sub: "game.render reports no draw counter"
    });
  });
});

describe("helpers", () => {
  it("sparkPoints scales the samples into the box, low at the bottom", () => {
    expect(sparkPoints([0, 60], 100, 20)).toBe("0,20 100,0");
    expect(sparkPoints([30, 30, 30], 100, 20)).toBe("0,10 50,10 100,10");
    expect(sparkPoints([60], 100, 20)).toBe("0,10 100,10");
    expect(sparkPoints([], 100, 20)).toBe("");
  });

  it("tagOfUse names the use of a texture", () => {
    expect(tagOfUse({ kind: "in-use" })).toEqual({ text: "in use", data: "in-use" });
    expect(tagOfUse({ kind: "unused-since", frame: 212 })).toEqual({
      text: "unused since f212",
      data: "unused"
    });
    expect(tagOfUse({ kind: "not-seen", since: 100 })).toEqual({
      text: "not seen since f100",
      data: "not-seen"
    });
  });

  it("boundsText and fixed", () => {
    expect(boundsText({ x: 55, y: 801, w: 970, h: 970 })).toBe("55 · 801 · 970×970");
    expect(boundsText({ x: 428.5, y: 880.25, w: 223, h: 223 })).toBe("428.5 · 880.3 · 223×223");
    expect(boundsText(undefined)).toBe("not placed");
    expect(fixed(4)).toBe("4.00");
    expect(fixed(3.456, 1)).toBe("3.5");
  });
});

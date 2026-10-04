import { describe, expect, it } from "vitest";
import {
  availableRect,
  centreAt,
  clampZoom,
  defaultCamera,
  FIT_ALL,
  fitRect,
  focusCamera,
  followCamera,
  gridStep,
  logLerp,
  MIN_AREA_W,
  sideColumn,
  zoomAt
} from "../../camera/math";
import type { Camera } from "../../types";
import { item, testConfig } from "../helpers";

const config = testConfig();
const view = { w: 1000, h: 800 };
const noInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/** World → screen. */
function toScreen(cam: Camera, x: number, y: number): { x: number; y: number } {
  return { x: x * cam.z + cam.x, y: y * cam.z + cam.y };
}

/** A tiny deterministic random source. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

describe("clampZoom", () => {
  it("clamps to [0.08, 3]", () => {
    expect(clampZoom(0.01, config)).toBe(0.08);
    expect(clampZoom(9, config)).toBe(3);
    expect(clampZoom(1.2, config)).toBe(1.2);
  });
});

describe("zoomAt", () => {
  it("keeps the world point under the pointer fixed (100 random cameras)", () => {
    const random = seeded(7);
    for (let index = 0; index < 100; index += 1) {
      const cam = { x: random() * 800 - 400, y: random() * 600 - 300, z: 0.1 + random() * 2.5 };
      const px = random() * view.w;
      const py = random() * view.h;
      const factor = 0.5 + random() * 1.5;
      const world = { x: (px - cam.x) / cam.z, y: (py - cam.y) / cam.z };
      const next = zoomAt(cam, px, py, factor, config);
      const screen = toScreen(next, world.x, world.y);
      expect(screen.x).toBeCloseTo(px, 6);
      expect(screen.y).toBeCloseTo(py, 6);
    }
  });

  it("clamps the zoom at 0.08 and 3", () => {
    expect(zoomAt({ x: 0, y: 0, z: 2 }, 0, 0, 10, config).z).toBe(3);
    expect(zoomAt({ x: 0, y: 0, z: 0.1 }, 0, 0, 0.01, config).z).toBe(0.08);
  });
});

describe("fitRect", () => {
  it("fits and centres a rect in the available rect", () => {
    const cam = fitRect({ x: 0, y: 0, w: 920, h: 360 }, view, noInsets, 40, 1.4, config);
    expect(cam.z).toBeCloseTo(1, 6);
    const centre = toScreen(cam, 460, 180);
    expect(centre.x).toBeCloseTo(500, 6);
    expect(centre.y).toBeCloseTo(400, 6);
  });

  it("leaves the insets out of the available rect", () => {
    const insets = { top: 0, right: 224, bottom: 224, left: 0 };
    const cam = fitRect({ x: 0, y: 0, w: 100, h: 100 }, view, insets, 40, 1.4, config);
    expect(cam.z).toBe(1.4);
    const centre = toScreen(cam, 50, 50);
    expect(centre.x).toBeCloseTo((1000 - 224) / 2, 6);
    expect(centre.y).toBeCloseTo((800 - 224) / 2, 6);
    expect(availableRect(view, insets)).toEqual({ x: 0, y: 0, w: 776, h: 576 });
  });

  it("narrow area: the padding of an axis is at most an eighth of it", () => {
    // Half screen: 194 × 632 px left; Fit selection's 70 px pads would leave 54 px across.
    const narrow = { w: 368, h: 856 };
    const insets = { top: 0, right: 174, bottom: 224, left: 0 };
    const rect = { x: 0, y: 0, w: 500, h: 100 };
    const cam = fitRect(rect, narrow, insets, 70, 1.3, config);
    expect(cam.z).toBeCloseTo((194 - 2 * (194 / 8)) / 500, 6);
    expect(toScreen(cam, 0, 0).x).toBeCloseTo(194 / 8, 6);
    expect(toScreen(cam, 500, 0).x).toBeCloseTo(194 - 194 / 8, 6);
  });

  it("a desktop canvas keeps the full padding (1088 × 632 with a bottom inset and the column)", () => {
    const desktop = { w: 1088, h: 856 };
    const insets = { top: 0, right: 224, bottom: 224, left: 0 };
    const rect = { x: 0, y: 0, w: 1000, h: 1000 };
    const cam = fitRect(rect, desktop, insets, 70, 1.3, config);
    expect(cam.z).toBeCloseTo((632 - 140) / 1000, 6);
  });
});

describe("defaultCamera (M11)", () => {
  it("fits the frame when the fit zoom is at least 0.8", () => {
    const frame = { x: 0, y: 0, w: 900, h: 600 };
    const cam = defaultCamera(frame, undefined, view, noInsets, config);
    expect(cam).toEqual(fitRect(frame, view, noInsets, FIT_ALL.pad, FIT_ALL.maxZ, config));
    expect(cam.z).toBeGreaterThanOrEqual(0.8);
  });

  it("keeps 0.8 and centres on the current node when the frame does not fit", () => {
    const frame = { x: 0, y: 0, w: 4000, h: 3000 };
    const current = { x: 2000, y: 1500, w: 172, h: 44 };
    const cam = defaultCamera(frame, current, view, noInsets, config);
    expect(cam.z).toBe(0.8);
    const centre = toScreen(cam, 2086, 1522);
    expect(centre.x).toBeCloseTo(500, 6);
    expect(centre.y).toBeCloseTo(400, 6);
  });
});

describe("focusCamera", () => {
  it("normal card: zoom clamped to [1, 1.25], centred on the card", () => {
    const card = item({ key: "board/merge", x: 300, y: 200 });
    const cam = focusCamera(card, { x: 0, y: 0, z: 0.5 }, view, noInsets);
    expect(cam.z).toBe(1);
    const centre = toScreen(cam, 386, 222);
    expect(centre.x).toBeCloseTo(500, 6);
    expect(centre.y).toBeCloseTo(400, 6);
    expect(focusCamera(card, { x: 0, y: 0, z: 2 }, view, noInsets).z).toBe(1.25);
  });

  it("narrow area (half screen): the zoom shrinks so the card fits with an 8 px gutter", () => {
    // A 720 px window: the canvas is 368 px, the preview column 174 px leaves 194 px.
    const narrow = { w: 368, h: 856 };
    const insets = { top: 0, right: 174, bottom: 224, left: 0 };
    const card = item({ key: "main/settings", x: 988, y: 300 });
    const cam = focusCamera(card, { x: 0, y: 0, z: 2 }, narrow, insets);
    expect(cam.z).toBeCloseTo((194 - 16) / 172, 6);
    expect(toScreen(cam, 988, 300).x).toBeCloseTo(8, 6);
    expect(toScreen(cam, 988 + 172, 300).x).toBeCloseTo(186, 6);
    expect(toScreen(cam, 988, 322).y).toBeCloseTo((856 - 224) / 2, 6);
    // At 100 % the card fits as it is.
    const at100 = focusCamera(card, { x: 0, y: 0, z: 1 }, narrow, insets);
    expect(at100.z).toBe(1);
    expect(toScreen(at100, 988, 300).x).toBeCloseTo((194 - 172) / 2, 6);
  });

  it("tall item: zoom from the available height, top 900 units, shifted 120 right", () => {
    const hub = item({ key: "board/awaitIntent", kind: "hub", x: 0, y: 0, w: 200, h: 1200 });
    const cam = focusCamera(hub, { x: 0, y: 0, z: 1 }, view, noInsets);
    expect(cam.z).toBeCloseTo((800 - 60) / 900, 6);
    const centre = toScreen(cam, 100 + 120, 450);
    expect(centre.x).toBeCloseTo(500, 6);
    expect(centre.y).toBeCloseTo(400, 6);
  });
});

describe("followCamera", () => {
  it("clamps zoom to [0.7, 1.1]; a hub is centred 120 units below its top", () => {
    const hub = item({ key: "board/awaitIntent", kind: "hub", x: 0, y: 100, w: 200, h: 900 });
    const cam = followCamera(hub, { x: 0, y: 0, z: 2 }, view, noInsets);
    expect(cam.z).toBe(1.1);
    const centre = toScreen(cam, 100, 220);
    expect(centre.x).toBeCloseTo(500, 6);
    expect(centre.y).toBeCloseTo(400, 6);
    expect(followCamera(hub, { x: 0, y: 0, z: 0.2 }, view, noInsets).z).toBe(0.7);
  });

  it("narrow area: a card keeps its width inside the available rect", () => {
    const narrow = { w: 368, h: 856 };
    const insets = { top: 0, right: 174, bottom: 0, left: 0 };
    const card = item({ key: "main/board", x: 640, y: 120 });
    const cam = followCamera(card, { x: 0, y: 0, z: 1.1 }, narrow, insets);
    expect(cam.z).toBeCloseTo((194 - 16) / 172, 6);
    expect(toScreen(cam, 640, 120).x).toBeGreaterThanOrEqual(8 - 1e-6);
    expect(toScreen(cam, 640 + 172, 120).x).toBeLessThanOrEqual(186 + 1e-6);
    // A wide canvas keeps the [0.7, 1.1] clamp.
    expect(followCamera(card, { x: 0, y: 0, z: 2 }, view, noInsets).z).toBe(1.1);
  });
});

describe("sideColumn", () => {
  it("keeps the widest column while the graph keeps one card at 100 % (MIN_AREA_W)", () => {
    expect(MIN_AREA_W).toBe(188);
    expect(sideColumn(1088, [224, 174])).toBe(224);
    expect(sideColumn(224 + 188, [224, 174])).toBe(224);
  });

  it("falls back to the next column on a narrow canvas, then to none", () => {
    expect(sideColumn(368, [224, 174])).toBe(174);
    expect(sideColumn(174 + 188, [224, 174])).toBe(174);
    expect(sideColumn(300, [224, 174])).toBe(0);
  });

  it("an unmeasured canvas (0) takes the widest column", () => {
    expect(sideColumn(0, [224, 174])).toBe(224);
    expect(sideColumn(0, [])).toBe(0);
  });
});

describe("centreAt", () => {
  it("puts a world point in the centre of the available rect", () => {
    const cam = centreAt({ x: 10, y: 20 }, 2, view, noInsets);
    expect(toScreen(cam, 10, 20)).toEqual({ x: 500, y: 400 });
  });
});

describe("gridStep", () => {
  it("is 24 · z px, ×4 while under 11 px; never under 11 px", () => {
    expect(gridStep(1)).toBe(24);
    expect(gridStep(0.25)).toBe(24);
    expect(gridStep(0.1)).toBeCloseTo(38.4, 6);
    for (const z of [0.08, 0.1, 0.3, 0.45, 0.5, 1, 2, 3]) {
      expect(gridStep(z)).toBeGreaterThanOrEqual(11);
    }
  });
});

describe("logLerp", () => {
  it("interpolates in log scale", () => {
    expect(logLerp(0.5, 2, 0)).toBe(0.5);
    expect(logLerp(0.5, 2, 1)).toBeCloseTo(2, 9);
    expect(logLerp(0.5, 2, 0.5)).toBeCloseTo(1, 9);
  });
});

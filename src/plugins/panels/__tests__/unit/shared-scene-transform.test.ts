import { describe, expect, it } from "vitest";
import type { Json } from "../../../registry/protocol";
import type { Calibration, PageRect, SceneNode, SceneSnapshot } from "../../shared/scene";
import { buildScene, transformedRect } from "../../shared/scene";

// ─────────────────────────────────────────────────────────────────────────────
// The rest transform of a ui node (finding 3): transformedRect ports the game's
// pivotOf + restTransform (ui/layout/motion.ts) onto the drawn rect, and
// buildScene applies it after drawnRect, compounded through the ancestors.
// ─────────────────────────────────────────────────────────────────────────────

function rect(x: number, y: number, w: number, h: number): PageRect {
  return { x, y, w, h };
}

/** Asserts a rect to 9 decimals: the rotations go through Math.cos and Math.sin. */
function expectRect(actual: PageRect | undefined, expected: PageRect): void {
  expect(actual).toBeDefined();
  expect(actual?.x).toBeCloseTo(expected.x, 9);
  expect(actual?.y).toBeCloseTo(expected.y, 9);
  expect(actual?.w).toBeCloseTo(expected.w, 9);
  expect(actual?.h).toBeCloseTo(expected.h, 9);
}

describe("transformedRect", () => {
  const box = rect(100, 200, 300, 100);

  it("is the identity when the style has no offset, scale or rotation", () => {
    expect(transformedRect(box, undefined, undefined, 1)).toEqual(box);
    expect(transformedRect(box, undefined, {}, 0.5)).toEqual(box);
    expect(transformedRect(box, undefined, { origin: "top", nineSlice: "ui.card" }, 1)).toEqual(
      box
    );
    expect(transformedRect(box, undefined, { scale: 1, rotation: 0, offsetX: 0 }, 1)).toEqual(box);
  });

  it("ignores transform fields that are not finite numbers", () => {
    // eslint-disable-next-line unicorn/no-null -- null is a JSON value the wire can carry
    expect(transformedRect(box, undefined, { scale: "big", rotation: null }, 1)).toEqual(box);
  });

  it("scales about the centre by default and for origin center", () => {
    expectRect(
      transformedRect(rect(0, 0, 100, 50), undefined, { scale: 2 }, 1),
      rect(-50, -25, 200, 100)
    );
    expectRect(
      transformedRect(rect(0, 0, 100, 50), undefined, { scale: 2, origin: "center" }, 1),
      rect(-50, -25, 200, 100)
    );
  });

  it("scales about the middle of the top edge for origin top", () => {
    expectRect(
      transformedRect(box, undefined, { scale: 1.2, origin: "top" }, 1),
      rect(70, 200, 360, 120)
    );
  });

  it("scales about the top-left corner for origin topLeft", () => {
    expectRect(
      transformedRect(box, undefined, { scale: 0.5, origin: "topLeft" }, 1),
      rect(100, 200, 150, 50)
    );
  });

  it("scales about a fractional {x, y} origin, outside the box too (merge-game settingsBoard)", () => {
    expectRect(
      transformedRect(
        rect(0, 0, 100, 100),
        undefined,
        { scale: 2, origin: { x: 0.5, y: -0.5 } },
        1
      ),
      rect(-50, 50, 200, 200)
    );
    expectRect(
      transformedRect(rect(0, 0, 100, 100), undefined, { scale: 2, origin: { x: 1, y: 1 } }, 1),
      rect(-100, -100, 200, 200)
    );
  });

  it("treats an unknown origin as the centre", () => {
    expectRect(
      transformedRect(rect(0, 0, 100, 50), undefined, { scale: 2, origin: "bottom" }, 1),
      rect(-50, -25, 200, 100)
    );
  });

  it("moves by the offsets, scaled by the fit the node is drawn at", () => {
    expectRect(
      transformedRect(box, undefined, { offsetX: 10, offsetY: -6 }, 1),
      rect(110, 194, 300, 100)
    );
    expectRect(
      transformedRect(box, undefined, { offsetX: 10, offsetY: -6 }, 0.5),
      rect(105, 197, 300, 100)
    );
  });

  it("turns about the pivot and gives the axis-aligned box of the turned rect", () => {
    // A quarter turn clockwise about the centre: the 100 × 50 box stands 50 × 100.
    expectRect(
      transformedRect(rect(0, 0, 100, 50), undefined, { rotation: Math.PI / 2 }, 1),
      rect(25, -25, 50, 100)
    );
    // About the top middle: the box hanging below the pivot swings to its left.
    expectRect(
      transformedRect(rect(0, 0, 200, 80), undefined, { rotation: Math.PI / 2, origin: "top" }, 1),
      rect(20, -100, 80, 200)
    );
  });

  it("gives the box of the game's tilted plaque example (rotation -0.026 about the top)", () => {
    const cos = Math.cos(0.026);
    const sin = Math.sin(0.026);

    expectRect(
      transformedRect(rect(0, 0, 200, 80), undefined, { rotation: -0.026, origin: "top" }, 1),
      rect(100 - 100 * cos, -100 * sin, 200 * cos + 80 * sin, 200 * sin + 80 * cos)
    );
  });

  it("scales and turns together, then offsets", () => {
    expectRect(
      transformedRect(
        rect(0, 0, 100, 50),
        undefined,
        { scale: 2, rotation: Math.PI / 2, offsetY: 5 },
        1
      ),
      rect(0, -70, 100, 200)
    );
  });

  it("does not depend on the parent rect: the game's position is relative to it, the box is not", () => {
    const style = { scale: 1.2, origin: "top", offsetX: 4, rotation: 0.3 };

    expectRect(
      transformedRect(box, rect(40, 80, 600, 600), style, 0.75),
      transformedRect(box, undefined, style, 0.75)
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildScene: the rest transform after drawnRect
// ─────────────────────────────────────────────────────────────────────────────

/** A ui node of the wire. */
function ui(
  key: string,
  box: PageRect,
  style: { [key: string]: Json } = {},
  children: Json[] = [],
  extra: { [key: string]: Json } = {}
): Json {
  return { key, type: "stack", rect: { ...box }, style, children, ...extra };
}

function sceneOf(top: Json, calibration?: Calibration): SceneSnapshot {
  const built = buildScene({ ui: top, entities: [], projections: {}, frame: 1, calibration });
  if ("error" in built) throw new Error(`scene error: ${built.source} ${built.path}`);
  return built;
}

function nodeOf(scene: SceneSnapshot, id: string): SceneNode {
  const node = scene.nodes.get(id);
  if (node === undefined) throw new Error(`no node ${id}`);
  return node;
}

describe("buildScene: the rest transform of ui nodes", () => {
  it("draws a node with style scale 1.2, origin top, scaled about its top middle", () => {
    const scene = sceneOf(
      ui("root", rect(0, 0, 1000, 1000), {}, [ui("card", box(), { scale: 1.2, origin: "top" })])
    );

    expectRect(nodeOf(scene, "ui:root/card").rect, rect(70, 200, 360, 120));
    expect(nodeOf(scene, "ui:root").rect).toEqual(rect(0, 0, 1000, 1000));
  });

  it("keeps the rect of a node whose style only names an origin", () => {
    const scene = sceneOf(
      ui("root", rect(0, 0, 1000, 1000), {}, [ui("card", box(), { origin: "top" })])
    );

    expect(nodeOf(scene, "ui:root/card").rect).toEqual(box());
  });

  it("carries a parent's transform onto its children", () => {
    const scene = sceneOf(
      ui("root", rect(0, 0, 1000, 1000), {}, [
        ui("panel", rect(100, 100, 200, 200), { scale: 2, origin: "topLeft" }, [
          ui("icon", rect(150, 150, 50, 50))
        ])
      ])
    );

    expectRect(nodeOf(scene, "ui:root/panel").rect, rect(100, 100, 400, 400));
    expectRect(nodeOf(scene, "ui:root/panel/icon").rect, rect(200, 200, 100, 100));
  });

  it("applies a child's own transform first, then its ancestors'", () => {
    const scene = sceneOf(
      ui("panel", rect(0, 0, 100, 100), { offsetX: 10 }, [
        ui("icon", rect(0, 0, 10, 10), { scale: 2 }, [ui("dot", rect(4, 4, 2, 2))])
      ])
    );

    expectRect(nodeOf(scene, "ui:panel").rect, rect(10, 0, 100, 100));
    expectRect(nodeOf(scene, "ui:panel/icon").rect, rect(5, -5, 20, 20));
    expectRect(nodeOf(scene, "ui:panel/icon/dot").rect, rect(13, 3, 4, 4));
  });

  it("turns the whole subtree of a turned node about that node's pivot", () => {
    const scene = sceneOf(
      ui("plaque", rect(0, 0, 200, 80), { rotation: Math.PI / 2, origin: "top" }, [
        ui("label", rect(0, 0, 200, 40))
      ])
    );

    expectRect(nodeOf(scene, "ui:plaque").rect, rect(20, -100, 80, 200));
    expectRect(nodeOf(scene, "ui:plaque/label").rect, rect(60, -100, 40, 200));
  });

  it("scales the offset by the fit chain: a fitted slot draws its icon's offset at its scale", () => {
    const scene = sceneOf(
      ui("root", rect(0, 0, 1000, 1000), {}, [
        ui(
          "slot",
          rect(100, 100, 400, 400),
          {},
          [ui("icon", rect(150, 150, 100, 100), { offsetX: 20 })],
          { fitScale: 0.5 }
        )
      ])
    );

    expectRect(nodeOf(scene, "ui:root/slot/icon").rect, rect(235, 225, 50, 50));
  });

  it("applies the calibration after the transform", () => {
    const scene = sceneOf(
      ui("root", rect(0, 0, 1000, 1000), {}, [ui("card", box(), { scale: 1.2, origin: "top" })]),
      { scale: 0.5, x: 10, y: 30 }
    );

    expectRect(nodeOf(scene, "ui:root/card").rect, rect(45, 130, 180, 60));
  });
});

/** The card box of the build tests. */
function box(): PageRect {
  return rect(100, 200, 300, 100);
}

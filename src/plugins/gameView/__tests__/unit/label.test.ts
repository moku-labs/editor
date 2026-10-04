import { describe, expect, it } from "vitest";
import type { SceneNode } from "../../../panels/shared/scene";
import { counterScale, labelPlacement, labelSize, labelText } from "../../stage/label";

const DEVICE = { w: 393, h: 852 };
const LABEL = { w: 120, h: 18 };

describe("labelPlacement", () => {
  it("sits under the box, left-aligned", () => {
    expect(labelPlacement({ x: 40, y: 100, w: 80, h: 40 }, LABEL, DEVICE)).toEqual({
      x: 40,
      y: 144,
      flipped: false
    });
  });

  it("flips above when it would leave the device bottom", () => {
    expect(labelPlacement({ x: 40, y: 800, w: 80, h: 40 }, LABEL, DEVICE)).toEqual({
      x: 40,
      y: 778,
      flipped: true
    });
  });

  it("aligns right when it would leave the right edge", () => {
    expect(labelPlacement({ x: 330, y: 100, w: 60, h: 40 }, LABEL, DEVICE)).toEqual({
      x: 270,
      y: 144,
      flipped: false
    });
  });

  it("never starts left of the device", () => {
    expect(labelPlacement({ x: 0, y: 100, w: 20, h: 20 }, { w: 500, h: 18 }, DEVICE).x).toBe(0);
  });
});

describe("counterScale and labelSize", () => {
  it("counter-scales by 1 / box scale; 1 for a hidden box", () => {
    expect(counterScale(0.5)).toBe(2);
    expect(counterScale(0)).toBe(1);
  });

  it("estimates the label in device px so the text stays 11 px", () => {
    const atOne = labelSize("coinPill · row · 290×76", 1);
    const atHalf = labelSize("coinPill · row · 290×76", 0.5);
    expect(atHalf.w).toBeCloseTo(atOne.w * 2, 6);
    expect(atHalf.h).toBeCloseTo(atOne.h * 2, 6);
  });
});

describe("labelText", () => {
  const node: SceneNode = {
    id: "ui:boardScreen/hudRow/coinPill",
    ref: { kind: "ui", path: "boardScreen/hudRow/coinPill" },
    name: "coinPill",
    type: "row",
    parent: "ui:boardScreen/hudRow",
    children: [],
    rect: { x: 235.4, y: 74, w: 290.4, h: 75.6 },
    refRect: { x: 235.4, y: 74, w: 290.4, h: 75.6 },
    texture: undefined,
    key: "coinPill",
    style: undefined,
    visible: true,
    entity: undefined
  };

  it("is name · Type · w×h in rounded CSS px", () => {
    expect(labelText(node)).toBe("coinPill · row · 290×76");
  });

  it("drops the size of an unplaced node", () => {
    expect(labelText({ ...node, rect: undefined })).toBe("coinPill · row");
  });
});

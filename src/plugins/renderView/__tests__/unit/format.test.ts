import { describe, expect, it } from "vitest";
import { boundsText, fixed, tagOfUse } from "../../format";

// format.ts: the texts of the scene cards (the tile texts and the sparkline points went with the
// metric tiles, spec 09 § M1).

describe("helpers", () => {
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

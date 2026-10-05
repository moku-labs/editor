// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { CROP_MARGIN, cropBox, cropImage } from "../../capture/crop";
import { CROP_JPEG, CROP_PNG, stubCanvas } from "../canvas";
import { PNG } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The crop of a pick (round 2 R2): the element's rect plus 8 px, scaled by
// picture width / device width, rounded outwards, clamped to the picture; cut
// with a canvas in the tools page.
// ─────────────────────────────────────────────────────────────────────────────

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("cropBox", () => {
  it("grows the rect by 8 px and scales it by the picture's pixel ratio", () => {
    expect(CROP_MARGIN).toBe(8);
    const box = cropBox(
      { x: 100, y: 200, w: 50, h: 20 },
      { w: 393 },
      { width: 1179, height: 2556 }
    );
    expect(box).toEqual({ x: 276, y: 576, w: 198, h: 108 });
  });

  it("keeps CSS px at ratio 1 and rounds a fractional rect outwards", () => {
    const box = cropBox(
      { x: 10.4, y: 20.6, w: 30.2, h: 5 },
      { w: 400 },
      { width: 400, height: 800 }
    );
    expect(box).toEqual({ x: 2, y: 12, w: 47, h: 22 });
  });

  it("clamps the box to the picture", () => {
    const box = cropBox({ x: -20, y: 790, w: 60, h: 40 }, { w: 400 }, { width: 400, height: 800 });
    expect(box).toEqual({ x: 0, y: 782, w: 48, h: 18 });
  });

  it("is undefined for an empty picture, a device without width or a rect outside", () => {
    const rect = { x: 0, y: 0, w: 10, h: 10 };
    expect(cropBox(rect, { w: 400 }, { width: 0, height: 0 })).toBeUndefined();
    expect(cropBox(rect, { w: 0 }, { width: 400, height: 800 })).toBeUndefined();
    expect(
      cropBox({ x: 900, y: 0, w: 10, h: 10 }, { w: 400 }, { width: 400, height: 800 })
    ).toBeUndefined();
  });
});

describe("cropImage", () => {
  it("draws the box of the picture into a canvas of its size and answers a JPEG 0.8 (D-34)", async () => {
    const canvas = stubCanvas({ width: 786, height: 1704 });
    const crop = await cropImage(PNG, { x: 100, y: 200, w: 50, h: 20 }, { w: 393 });
    expect(crop).toBe(CROP_JPEG);
    expect(canvas.encodes).toEqual([{ type: "image/jpeg", quality: 0.8 }]);
    expect(canvas.sizes).toEqual([{ width: 132, height: 72 }]);
    expect(canvas.drawImage).toHaveBeenCalledWith(
      expect.anything(),
      184,
      384,
      132,
      72,
      0,
      0,
      132,
      72
    );
  });

  it("encodes in the asked format and quality: png stays lossless", async () => {
    const canvas = stubCanvas({ width: 393, height: 852 });
    const rect = { x: 10, y: 10, w: 20, h: 20 };
    expect(await cropImage(PNG, rect, { w: 393 }, { format: "png", quality: 0.8 })).toBe(CROP_PNG);
    expect(await cropImage(PNG, rect, { w: 393 }, { format: "jpeg", quality: 0.5 })).toBe(
      CROP_JPEG
    );
    expect(canvas.encodes).toEqual([
      { type: "image/png", quality: undefined },
      { type: "image/jpeg", quality: 0.5 }
    ]);
  });

  it("is undefined when the picture has no size or the canvas has no 2D context", async () => {
    stubCanvas({ width: 0, height: 0 });
    expect(await cropImage(PNG, { x: 0, y: 0, w: 10, h: 10 }, { w: 393 })).toBeUndefined();

    vi.restoreAllMocks();
    stubCanvas({ width: 393, height: 852 });
    // eslint-disable-next-line unicorn/no-null -- getContext answers null without a 2D context
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(await cropImage(PNG, { x: 0, y: 0, w: 10, h: 10 }, { w: 393 })).toBeUndefined();
  });

  it("is undefined without a DOM", async () => {
    vi.stubGlobal("document", undefined);
    expect(await cropImage(PNG, { x: 0, y: 0, w: 10, h: 10 }, { w: 393 })).toBeUndefined();
  });

  it("rejects a picture that does not decode", async () => {
    vi.spyOn(HTMLImageElement.prototype, "decode").mockRejectedValue(new Error("broken image"));
    await expect(cropImage(PNG, { x: 0, y: 0, w: 10, h: 10 }, { w: 393 })).rejects.toThrow(
      "broken image"
    );
  });
});

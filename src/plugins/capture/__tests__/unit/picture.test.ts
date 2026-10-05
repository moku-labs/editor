import { describe, expect, it } from "vitest";
import { encodeOptionsOf, renderPicture } from "../../picture";
import type { PictureRequest } from "../../types";
import {
  createDeps,
  fakeClock,
  fakeDecoder,
  PNG,
  rejectionOf,
  smallJpeg,
  smallPng,
  thrownBy
} from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The picture of editor.capture and editor.sheet: crop, then downscale, then
// encode (JPEG 0.8 by default), over an injected decoder. A page that cannot
// decode or encode answers the door's own PNG.
// ─────────────────────────────────────────────────────────────────────────────

/** The request of a plain default picture: JPEG 0.8, no crop, no maxWidth, a 540 px wide page. */
const JPEG: PictureRequest = {
  maxWidth: undefined,
  crop: undefined,
  format: "jpeg",
  quality: 0.8,
  deviceWidth: 540
};

/** The same request asking the old PNG path. */
const PNG_REQUEST: PictureRequest = { ...JPEG, format: "png" };

/** A 1080 × 1920 picture. */
const PICTURE = { width: 1080, height: 1920 };

describe("encodeOptionsOf", () => {
  it("encodes the whole picture as JPEG at its size by default", () => {
    expect(encodeOptionsOf(PICTURE, JPEG)).toEqual({
      size: { width: 1080, height: 1920 },
      format: "jpeg",
      quality: 0.8
    });
  });

  it("png without a crop or a smaller size keeps the picture as it is", () => {
    expect(encodeOptionsOf(PICTURE, PNG_REQUEST)).toBeUndefined();
    expect(encodeOptionsOf(PICTURE, { ...PNG_REQUEST, maxWidth: 1080 })).toBeUndefined();
  });

  it("downscales to maxWidth, aspect kept", () => {
    expect(encodeOptionsOf(PICTURE, { ...PNG_REQUEST, maxWidth: 540 })).toEqual({
      size: { width: 540, height: 960 },
      format: "png",
      quality: 0.8
    });
  });

  it("crops first (page px × 2 on a 540 px page, 16 px padding), then downscales the crop", () => {
    const crop = { rect: { x: 10, y: 20, w: 100, h: 50 }, field: "key" } as const;

    expect(encodeOptionsOf(PICTURE, { ...JPEG, crop, maxWidth: 116, quality: 0.6 })).toEqual({
      crop: { x: 4, y: 24, width: 232, height: 132 },
      size: { width: 116, height: 66 },
      format: "jpeg",
      quality: 0.6
    });
  });

  it("crops a png at full size when the crop is narrower than maxWidth", () => {
    const crop = { rect: { x: 10, y: 20, w: 100, h: 50 }, field: "rect" } as const;

    expect(encodeOptionsOf(PICTURE, { ...PNG_REQUEST, crop, maxWidth: 1080 })).toEqual({
      crop: { x: 4, y: 24, width: 232, height: 132 },
      size: { width: 232, height: 132 },
      format: "png",
      quality: 0.8
    });
  });

  it("refuses a crop outside the picture with -32602 naming its field", () => {
    const crop = { rect: { x: 5000, y: 0, w: 10, h: 10 }, field: "key" } as const;

    expect(thrownBy(() => encodeOptionsOf(PICTURE, { ...JPEG, crop }))).toMatchObject({
      code: -32_602,
      message:
        "[moku-editor] editor.capture: the rect lies outside the picture.\n  Pass a rect inside the game page.",
      data: { reason: "invalid_input", retryable: false, id: "editor.capture", field: "key" }
    });
  });
});

describe("renderPicture", () => {
  it("encodes a JPEG at full size by default and frees the picture", async () => {
    const deps = createDeps(fakeClock());

    expect(await renderPicture(PNG, JPEG, deps)).toBe(smallJpeg(1080, 1920));
    expect(deps.decode).toHaveBeenCalledWith(PNG);
    expect(deps.decode.pictures[0]?.encode).toHaveBeenCalledWith({
      size: { width: 1080, height: 1920 },
      format: "jpeg",
      quality: 0.8
    });
    expect(deps.decode.pictures[0]?.close).toHaveBeenCalledOnce();
  });

  it("png without maxWidth or crop decodes nothing (the old path)", async () => {
    const deps = createDeps(fakeClock());

    expect(await renderPicture(PNG, PNG_REQUEST, deps)).toBe(PNG);
    expect(deps.decode).not.toHaveBeenCalled();
  });

  it("png draws a wider picture at the scaled size and frees it", async () => {
    const deps = createDeps(fakeClock());

    expect(await renderPicture(PNG, { ...PNG_REQUEST, maxWidth: 270 }, deps)).toBe(
      smallPng(270, 480)
    );
    expect(deps.decode.pictures[0]?.close).toHaveBeenCalledOnce();
  });

  it("png answers the picture itself when it is narrow enough", async () => {
    const deps = { ...createDeps(fakeClock()), decode: fakeDecoder(320, 240) };

    expect(await renderPicture(PNG, { ...PNG_REQUEST, maxWidth: 320 }, deps)).toBe(PNG);
    expect(deps.decode.pictures[0]?.encode).not.toHaveBeenCalled();
    expect(deps.decode.pictures[0]?.close).toHaveBeenCalledOnce();
  });

  it("answers the door's picture, frees it and warns when encoding fails", async () => {
    const deps = createDeps(fakeClock());
    deps.decode.mockImplementationOnce(async () => ({
      width: 1080,
      height: 1920,
      encode: async () => {
        throw new Error("no 2d context");
      },
      close: deps.log.debug
    }));

    expect(await renderPicture(PNG, JPEG, deps)).toBe(PNG);
    expect(deps.log.debug).toHaveBeenCalledOnce();
    expect(deps.log.warn).toHaveBeenCalledWith("capture:encode-failed", {
      message: "no 2d context"
    });
  });

  it("answers the door's picture and warns when the decoder throws a non-Error", async () => {
    const deps = createDeps(fakeClock());
    deps.decode.mockRejectedValueOnce("broken");

    expect(await renderPicture(PNG, JPEG, deps)).toBe(PNG);
    expect(deps.log.warn).toHaveBeenCalledWith("capture:encode-failed", { message: "broken" });
  });

  it("rejects a crop outside the picture and still frees it", async () => {
    const deps = createDeps(fakeClock());
    const crop = { rect: { x: 5000, y: 0, w: 10, h: 10 }, field: "rect" } as const;

    expect(await rejectionOf(renderPicture(PNG, { ...JPEG, crop }, deps))).toMatchObject({
      code: -32_602,
      data: { field: "rect" }
    });
    expect(deps.decode.pictures[0]?.close).toHaveBeenCalledOnce();
    expect(deps.log.warn).not.toHaveBeenCalled();
  });
});

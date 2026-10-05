import { describe, expect, it } from "vitest";
import { checkMaxWidth, fitWidth, scaledSize } from "../../scale";
import { createDeps, fakeClock, fakeDecoder, PNG, smallPng, thrownBy } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The maxWidth rule of editor.capture: the range check, the scaled size and the
// downscale over an injected decoder (the page's canvas lives in canvas.ts).
// ─────────────────────────────────────────────────────────────────────────────

describe("checkMaxWidth", () => {
  it("passes an absent maxWidth and every whole number from 64 to 4096", () => {
    expect(checkMaxWidth(undefined)).toBeUndefined();
    expect(checkMaxWidth(64)).toBe(64);
    expect(checkMaxWidth(1080)).toBe(1080);
    expect(checkMaxWidth(4096)).toBe(4096);
  });

  it.each([63, 4097, 540.5, Number.NaN])("refuses %s with -32602 naming maxWidth", maxWidth => {
    expect(thrownBy(() => checkMaxWidth(maxWidth))).toMatchObject({
      code: -32_602,
      data: { reason: "invalid_input", retryable: false, id: "editor.capture", field: "maxWidth" }
    });
  });
});

describe("scaledSize", () => {
  it("shrinks a wider picture to maxWidth and keeps the aspect, rounded", () => {
    expect(scaledSize(1080, 1920, 540)).toEqual({ width: 540, height: 960 });
    expect(scaledSize(1080, 1920, 64)).toEqual({ width: 64, height: 114 });
  });

  it("keeps at least one pixel of height", () => {
    expect(scaledSize(4000, 1, 64)).toEqual({ width: 64, height: 1 });
  });

  it("answers undefined when the picture is not wider than maxWidth", () => {
    expect(scaledSize(1080, 1920, 1080)).toBeUndefined();
    expect(scaledSize(800, 600, 1080)).toBeUndefined();
  });
});

describe("fitWidth", () => {
  it("draws a wider picture at the scaled size and frees it", async () => {
    const deps = createDeps(fakeClock());

    expect(await fitWidth(PNG, 270, deps)).toBe(smallPng(270, 480));
    expect(deps.decode.pictures[0]?.toPng).toHaveBeenCalledWith(270, 480);
    expect(deps.decode.pictures[0]?.close).toHaveBeenCalledOnce();
  });

  it("answers the picture itself when it is narrow enough", async () => {
    const deps = { ...createDeps(fakeClock()), decode: fakeDecoder(320, 240) };

    expect(await fitWidth(PNG, 320, deps)).toBe(PNG);
    expect(deps.decode.pictures[0]?.close).toHaveBeenCalledOnce();
  });

  it("answers the full picture, frees it and warns when drawing fails", async () => {
    const deps = createDeps(fakeClock());
    deps.decode.mockImplementationOnce(async () => ({
      width: 1080,
      height: 1920,
      toPng: async () => {
        throw new Error("no 2d context");
      },
      close: deps.log.debug
    }));

    expect(await fitWidth(PNG, 540, deps)).toBe(PNG);
    expect(deps.log.debug).toHaveBeenCalledOnce();
    expect(deps.log.warn).toHaveBeenCalledWith("capture:downscale-failed", {
      message: "no 2d context"
    });
  });

  it("answers the full picture and warns when the decoder throws a non-Error", async () => {
    const deps = createDeps(fakeClock());
    deps.decode.mockRejectedValueOnce("broken");

    expect(await fitWidth(PNG, 540, deps)).toBe(PNG);
    expect(deps.log.warn).toHaveBeenCalledWith("capture:downscale-failed", { message: "broken" });
  });
});

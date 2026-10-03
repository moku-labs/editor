import { describe, expect, it } from "vitest";
import {
  decodeDataUrl,
  encodeDataUrl,
  IMAGE_EXTENSIONS,
  imageMime,
  isImagePath
} from "../../binary";
import { PNG_BYTES } from "../helpers";

const BYTES = Uint8Array.from([0, 1, 2, 250, 251, 255]);
const B64 = Buffer.from(BYTES).toString("base64");

/**
 * Settles a sync call into its error code and data, or "ok".
 *
 * @param run - The call.
 * @returns The code and data of the thrown error.
 */
function failure(run: () => unknown): { code: unknown; data: unknown } | "ok" {
  try {
    run();
    return "ok";
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && "data" in error) {
      return { code: error.code, data: error.data };
    }
    throw error;
  }
}

const INVALID = {
  code: -32_602,
  data: expect.objectContaining({ reason: "invalid_input", field: "data" })
};
const FORBIDDEN = { code: -32_004, data: expect.objectContaining({ reason: "forbidden_path" }) };

describe("IMAGE_EXTENSIONS and imageMime", () => {
  it("lists the R7 image extensions", () => {
    expect(IMAGE_EXTENSIONS).toEqual([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
  });

  it.each([
    ["a.png", "image/png"],
    ["a.PNG", "image/png"],
    ["a.jpg", "image/jpeg"],
    ["a.JPG", "image/jpeg"],
    ["a.jpeg", "image/jpeg"],
    ["a.webp", "image/webp"],
    ["dir.x/a.gif", "image/gif"]
  ])("imageMime(%s) = %s", (path, mime) => {
    expect(imageMime(path)).toBe(mime);
    expect(isImagePath(path)).toBe(true);
  });

  it.each([
    "a.svg",
    "a.ts",
    "png",
    "a.png/b",
    ".moku/captures/a.txt",
    "a."
  ])("rejects %s as not an image", path => {
    expect(isImagePath(path)).toBe(false);
    expect(failure(() => imageMime(path))).toEqual(FORBIDDEN);
  });
});

describe("decodeDataUrl", () => {
  it.each([
    ["png", ".moku/captures/a.png"],
    ["jpeg", ".moku/captures/a.jpg"],
    ["webp", ".moku/captures/a.webp"],
    ["gif", ".moku/captures/a.gif"]
  ])("decodes a %s data URL for %s", (type, path) => {
    const bytes = decodeDataUrl(`data:image/${type};base64,${B64}`, path);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect([...bytes]).toEqual([...BYTES]);
  });

  it("decodes a real PNG", () => {
    const url = `data:image/png;base64,${Buffer.from(PNG_BYTES).toString("base64")}`;
    expect([...decodeDataUrl(url, "a.png")]).toEqual([...PNG_BYTES]);
  });

  it.each([
    ["data:text/html;base64,PGI+", "text/html"],
    ["data:image/png,iVBOR", "missing ;base64"],
    ["data:image/png;base64,iVB*R", "invalid characters"],
    ["data:image/png;base64,iVBOR===", "too much padding"],
    ["", "empty string"],
    ["iVBORw0KGgo=", "no data: prefix"],
    [" data:image/png;base64,iVBOR", "leading space"]
  ])("rejects %j (%s) with -32602 field data", text => {
    expect(failure(() => decodeDataUrl(text, "a.png"))).toEqual(INVALID);
  });

  it("rejects a non-string with -32602", () => {
    const text: unknown = 42;
    expect(failure(() => decodeDataUrl(text as string, "a.png"))).toEqual(INVALID);
  });

  // S56
  it.each([
    ["gif", ".moku/captures/a.gif"],
    ["jpeg", "a.jpg"],
    ["jpeg", "a.jpeg"],
    ["jpeg", "a.JPG"]
  ])("S56 decodes image/%s for %s", (type, path) => {
    expect([...decodeDataUrl(`data:image/${type};base64,${B64}`, path)]).toEqual([...BYTES]);
  });

  // S57
  it.each([
    ["png", ".moku/captures/a.jpg"],
    ["gif", "a.png"]
  ])("S57 rejects image/%s for %s (mime does not match the extension)", (type, path) => {
    expect(failure(() => decodeDataUrl(`data:image/${type};base64,${B64}`, path))).toEqual(INVALID);
  });

  // S58
  it.each(["svg+xml", "bmp"])("S58 rejects image/%s", type => {
    expect(failure(() => decodeDataUrl(`data:image/${type};base64,${B64}`, "a.png"))).toEqual(
      INVALID
    );
  });

  // S59
  it("S59 rejects a path without an image extension with -32004", () => {
    expect(failure(() => decodeDataUrl(`data:image/png;base64,${B64}`, "src/a.ts"))).toEqual(
      FORBIDDEN
    );
  });
});

describe("encodeDataUrl", () => {
  it("picks the mime from the extension", () => {
    expect(encodeDataUrl(BYTES, "a.PNG")).toBe(`data:image/png;base64,${B64}`);
    expect(encodeDataUrl(BYTES, "a.jpg")).toBe(`data:image/jpeg;base64,${B64}`);
  });

  it("round-trips through decodeDataUrl", () => {
    for (const path of ["a.png", "a.jpeg", "a.webp", "a.GIF"]) {
      expect([...decodeDataUrl(encodeDataUrl(PNG_BYTES, path), path)]).toEqual([...PNG_BYTES]);
    }
  });

  it("encodes a view into a larger buffer by its own bytes only", () => {
    const view = new Uint8Array(BYTES.buffer, 2, 2);
    expect(encodeDataUrl(view, "a.png")).toBe(
      `data:image/png;base64,${Buffer.from([2, 250]).toString("base64")}`
    );
  });

  it("rejects a path that is not an image with -32004", () => {
    expect(failure(() => encodeDataUrl(BYTES, "a.ts"))).toEqual(FORBIDDEN);
  });
});

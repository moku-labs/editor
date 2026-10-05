import { describe, expect, it } from "vitest";
import { checkEncoding } from "../../encoding";
import { thrownBy } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The format and quality of editor.capture and editor.sheet (D-34): JPEG at
// 0.8 by default, "png" keeps the old lossless path.
// ─────────────────────────────────────────────────────────────────────────────

describe("checkEncoding", () => {
  it("answers JPEG at 0.8 when neither is given", () => {
    expect(checkEncoding({})).toEqual({ format: "jpeg", quality: 0.8 });
  });

  it("passes png and a quality from above 0 to 1", () => {
    expect(checkEncoding({ format: "png" })).toEqual({ format: "png", quality: 0.8 });
    expect(checkEncoding({ format: "jpeg", quality: 0.5 })).toEqual({
      format: "jpeg",
      quality: 0.5
    });
    expect(checkEncoding({ quality: 1 })).toEqual({ format: "jpeg", quality: 1 });
  });

  it.each(["webp", "JPEG", "jpg", ""])("refuses format %j with -32602 naming format", format => {
    expect(thrownBy(() => checkEncoding({ format }))).toMatchObject({
      code: -32_602,
      message:
        '[moku-editor] editor.capture: format must be "jpeg" or "png".\n  JPEG is the default; ask png for a lossless picture.',
      data: { reason: "invalid_input", retryable: false, id: "editor.capture", field: "format" }
    });
  });

  it.each([0, -0.1, 1.01, 80])("refuses quality %s with -32602 naming quality", quality => {
    expect(thrownBy(() => checkEncoding({ quality }, "editor.sheet"))).toMatchObject({
      code: -32_602,
      message:
        "[moku-editor] editor.sheet: quality must be a number above 0 and at most 1.\n  0.8 is the default.",
      data: { reason: "invalid_input", retryable: false, id: "editor.sheet", field: "quality" }
    });
  });
});

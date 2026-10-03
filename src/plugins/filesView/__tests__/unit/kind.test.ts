import { describe, expect, it } from "vitest";
import { extensionOf, IMAGE_EXTENSIONS, isTextKind, kindOf } from "../../tabs/kind";

// ─────────────────────────────────────────────────────────────────────────────
// kindOf: every extension row, the series path, the image extensions (R7)
// ─────────────────────────────────────────────────────────────────────────────

describe("kindOf", () => {
  it.each([
    ["nodes/merge.ts", "code"],
    ["features/ui/kit.tsx", "code"],
    ["web/main.js", "code"],
    ["web/view.jsx", "code"],
    ["scripts/a.mjs", "code"],
    ["scripts/b.cjs", "code"],
    ["styles/base.css", "code"],
    [".moku/notes/2026-09-24-first.md", "markdown"],
    ["manifest.json", "json"],
    [".moku/editor/layout.json", "json"],
    [".moku/captures/a.png", "image"],
    ["photos/b.jpg", "image"],
    ["photos/c.jpeg", "image"],
    ["photos/d.webp", "image"],
    ["photos/e.gif", "image"],
    ["LICENSE", "text"],
    ["notes.txt", "text"],
    ["photos/f.svg", "text"]
  ] as const)("%s is %s", (path, kind) => {
    expect(kindOf(path)).toBe(kind);
  });

  it("reads a series index.json as series, other index.json files as json", () => {
    expect(kindOf(".moku/captures/series-2026-09-24-1015/index.json")).toBe("series");
    expect(kindOf(".moku/captures/index.json")).toBe("json");
    expect(kindOf("src/series-1/index.json")).toBe("json");
  });

  it("matches the extension without case", () => {
    expect(kindOf("A.PNG")).toBe("image");
    expect(kindOf("Nodes/Merge.TS")).toBe("code");
  });

  it("lists the image extensions of the files channel", () => {
    expect([...IMAGE_EXTENSIONS]).toEqual([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
  });
});

describe("extensionOf", () => {
  it("returns the lower-case extension with its dot, or empty", () => {
    expect(extensionOf("nodes/merge.TS")).toBe(".ts");
    expect(extensionOf("a/b.c/README")).toBe("");
    expect(extensionOf(".gitignore")).toBe("");
  });
});

describe("isTextKind", () => {
  it("is false only for images", () => {
    expect(isTextKind("image")).toBe(false);
    for (const kind of ["code", "markdown", "json", "series", "text"] as const) {
      expect(isTextKind(kind)).toBe(true);
    }
  });
});

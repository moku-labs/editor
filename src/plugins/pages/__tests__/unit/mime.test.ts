import { describe, expect, it } from "vitest";
import { contentType } from "../../mime";

describe("contentType", () => {
  it.each([
    ["a.js", "text/javascript; charset=utf-8"],
    ["a.mjs", "text/javascript; charset=utf-8"],
    ["a.css", "text/css; charset=utf-8"],
    ["a.js.map", "application/json; charset=utf-8"],
    ["a.json", "application/json; charset=utf-8"],
    ["a.html", "text/html; charset=utf-8"],
    ["a.svg", "image/svg+xml; charset=utf-8"],
    ["a.png", "image/png"],
    ["a.jpg", "image/jpeg"],
    ["a.jpeg", "image/jpeg"],
    ["a.webp", "image/webp"],
    ["a.woff2", "font/woff2"],
    ["a.woff", "font/woff"],
    ["a.wasm", "application/wasm"],
    ["a.txt", "text/plain; charset=utf-8"],
    ["a.md", "text/plain; charset=utf-8"],
    ["a.bin", "application/octet-stream"],
    ["Makefile", "application/octet-stream"]
  ])("%s → %s", (path, type) => {
    expect(contentType(path)).toBe(type);
  });

  it("matches the extension case-insensitively and reads the last segment only", () => {
    expect(contentType("assets/INDEX-3F7A.CSS")).toBe("text/css; charset=utf-8");
    expect(contentType("a.css/readme")).toBe("application/octet-stream");
  });
});

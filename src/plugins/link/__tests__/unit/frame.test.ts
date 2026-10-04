// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFrameId, FRAME_PARAM, frameOf, isOtherFrame, tagFrame } from "../../sessions/frame";

// ─────────────────────────────────────────────────────────────────────────────
// The frame id of the tools page: made once, carried in the game frame URL,
// read back from a session page
// ─────────────────────────────────────────────────────────────────────────────

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createFrameId", () => {
  it("is 12 hex digits and new every time", () => {
    const first = createFrameId();
    expect(first).toMatch(/^[\da-f]{12}$/);
    expect(createFrameId()).not.toBe(first);
  });
});

describe("tagFrame", () => {
  it("adds the frame id as the __editorFrame query parameter", () => {
    expect(FRAME_PARAM).toBe("__editorFrame");
    expect(tagFrame("http://127.0.0.1:3000/", "3f9a1c2b7d4e")).toBe(
      "http://127.0.0.1:3000/?__editorFrame=3f9a1c2b7d4e"
    );
  });

  it("keeps the other parameters and the hash, and replaces an old frame id", () => {
    expect(tagFrame("http://127.0.0.1:3000/?level=2#board", "f1")).toBe(
      "http://127.0.0.1:3000/?level=2&__editorFrame=f1#board"
    );
    expect(tagFrame("http://127.0.0.1:3000/?__editorFrame=old", "f2")).toBe(
      "http://127.0.0.1:3000/?__editorFrame=f2"
    );
  });

  it("resolves a relative URL against the tools page", () => {
    expect(tagFrame("/game/", "f1")).toBe(new URL("/game/?__editorFrame=f1", location.href).href);
  });

  it("leaves a URL that does not parse unchanged", () => {
    vi.stubGlobal("location", undefined);
    expect(tagFrame("/game/", "f1")).toBe("/game/");
  });
});

describe("frameOf", () => {
  it("reads the frame id of a tagged page, undefined for an untagged page or no URL", () => {
    expect(frameOf("http://127.0.0.1:3000/?level=2&__editorFrame=f1")).toBe("f1");
    expect(frameOf("http://127.0.0.1:3000/")).toBeUndefined();
    expect(frameOf("")).toBeUndefined();
  });
});

describe("isOtherFrame", () => {
  it("is true only for a page tagged with another frame id", () => {
    expect(isOtherFrame("http://127.0.0.1:3000/?__editorFrame=other", "mine")).toBe(true);
    expect(isOtherFrame("http://127.0.0.1:3000/?__editorFrame=mine", "mine")).toBe(false);
    expect(isOtherFrame("http://127.0.0.1:3000/", "mine")).toBe(false);
  });
});

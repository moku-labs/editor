import { describe, expect, it } from "vitest";
import { keyOf } from "../../view/keys";

// ─────────────────────────────────────────────────────────────────────────────
// view/keys.ts (spec 09 § M8 Keyboard): the keys of the focused timeline or
// overview.
// ─────────────────────────────────────────────────────────────────────────────

describe("keyOf", () => {
  it("Shift+→ jumps a spike, → steps a frame, Space toggles live, Esc closes a popover before it clears the selection", () => {
    // Bug: Esc drops the selection under an open popover.
    expect(keyOf({ key: "ArrowRight", shiftKey: false }, false)).toEqual({ kind: "step", dir: 1 });
    expect(keyOf({ key: "ArrowLeft", shiftKey: true }, false)).toEqual({ kind: "jump", dir: -1 });
    expect(keyOf({ key: " ", shiftKey: false }, false)).toEqual({ kind: "toggle-live" });
    expect(keyOf({ key: "Escape", shiftKey: false }, true)).toEqual({ kind: "close-popover" });
    expect(keyOf({ key: "Escape", shiftKey: false }, false)).toEqual({ kind: "clear-selection" });
    expect(keyOf({ key: "a", shiftKey: false }, false)).toBeUndefined();
  });
});

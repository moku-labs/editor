import { describe, expect, it } from "vitest";
import {
  mbText,
  messageOf,
  mmss,
  oneDecimal,
  reasonOf,
  secondsText,
  twoDecimals
} from "../../derive/words";

// ─────────────────────────────────────────────────────────────────────────────
// derive/words.ts: the number and error helpers every Mission control string
// uses.
// ─────────────────────────────────────────────────────────────────────────────

describe("words", () => {
  it("an error's first line loses the editor's prefix; a thrown string is its own message", () => {
    // Bug: "[moku-editor] …\n  Start the debug build…" shown whole under a Connect row.
    expect(
      messageOf(new Error("[moku-editor] Allow USB debugging on the phone.\n  Accept the prompt."))
    ).toBe("Allow USB debugging on the phone.");
    expect(messageOf("socket closed")).toBe("socket closed");
  });

  it("reads a wire refusal's reason with dashes and underscores made one; none for other values", () => {
    // Bug: a "dev-only" refusal from the engine not recognised as a missing debug build.
    expect(reasonOf({ data: { reason: "read-only" } })).toBe("read_only");
    expect(reasonOf({ data: {} })).toBeUndefined();
    expect(reasonOf({ data: "x" })).toBeUndefined();
    expect(reasonOf("dev_only")).toBeUndefined();
  });

  it("formats durations and sizes the way the strings read them", () => {
    // Bug: "0.9 s" for 850 ms (the two-decimal rule under 1 s), or "1:5" for 65 s.
    expect(secondsText(850)).toBe("0.85 s");
    expect(secondsText(6230)).toBe("6.2 s");
    expect(mmss(65_000)).toBe("01:05");
    expect(mmss(-5)).toBe("00:00");
    expect(mbText(3_150_000)).toBe("3.1");
    expect(oneDecimal(2.04)).toBe("2");
    expect(twoDecimals(0.854)).toBe("0.85");
  });
});

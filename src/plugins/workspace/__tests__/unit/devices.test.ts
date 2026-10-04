import { describe, expect, it } from "vitest";
import { presetOf } from "../../../registry/protocol";
import { deviceChoiceOf } from "../../devices";

// ─────────────────────────────────────────────────────────────────────────────
// The stored device record → the device choice. The presets and the orientation rule live in
// the protocol (registry/protocol/devices.ts, protocol-devices.test.ts).
// ─────────────────────────────────────────────────────────────────────────────

describe("deviceChoiceOf", () => {
  it("resolves the stored record: folded by default, the inner screen when unfolded", () => {
    expect(deviceChoiceOf({ preset: "iphone-15", orientation: "portrait" })).toEqual({
      preset: presetOf("iphone-15"),
      orientation: "portrait",
      folded: true
    });
    const open = deviceChoiceOf({
      preset: "pixel-9-pro-fold",
      orientation: "landscape",
      folded: false
    });
    expect(open.folded).toBe(false);
    expect(open.orientation).toBe("landscape");
    expect(open.preset).toMatchObject({ id: "pixel-9-pro-fold", w: 791, h: 820 });
  });
});

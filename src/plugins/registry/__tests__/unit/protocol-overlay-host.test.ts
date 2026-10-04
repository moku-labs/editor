import { describe, expect, it } from "vitest";
import { HOST_ATTRIBUTE } from "../../protocol";

// ─────────────────────────────────────────────────────────────────────────────
// The overlay host marker: overlay sets it on its host, bridge's tap watch
// skips events whose path holds it. Both read it from the protocol.
// ─────────────────────────────────────────────────────────────────────────────

describe("HOST_ATTRIBUTE", () => {
  it("is the data attribute of the overlay host", () => {
    expect(HOST_ATTRIBUTE).toBe("data-moku-editor-overlay");
  });
});

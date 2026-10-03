import { commands } from "@moku-labs/game/control";
import { sources } from "@moku-labs/game/inspect";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Typing spike, step 1 (11-panels): catalogue.ts maps `game.<key>` to the value
// of `sources[key]`, because `Source.id` is typed `string`. This runtime check
// keeps that mapping honest. The game is imported at test time only.
// ─────────────────────────────────────────────────────────────────────────────

describe("catalogue spike: door ids", () => {
  it("every source key k has the id game.<k>", () => {
    const keys = Object.keys(sources);
    expect(keys.length).toBeGreaterThan(10);
    for (const key of keys) {
      expect(sources[key as keyof typeof sources].id).toBe(`game.${key}`);
    }
  });

  it("every command key k has the id game.<k>", () => {
    const keys = Object.keys(commands);
    expect(keys).toContain("step");
    for (const key of keys) {
      expect(commands[key as keyof typeof commands].id).toBe(`game.${key}`);
    }
  });
});

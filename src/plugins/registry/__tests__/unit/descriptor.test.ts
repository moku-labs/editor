import { describe, expect, it } from "vitest";
import { describeCommand } from "../../entries/descriptor";
import type { DoorCommand } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// describeCommand: the manifest keys of a command, its build verdict and its
// overlay marker; never a function
// ─────────────────────────────────────────────────────────────────────────────

/** A game toggle with its value(app), the way the shipped engine defines it. */
const glow: DoorCommand = {
  id: "garden.glow",
  title: "Glow",
  input: { on: "boolean" },
  effect: "cosmetic",
  overlay: "toggle",
  run: () => true,
  value: () => true
};

describe("describeCommand", () => {
  it("copies the overlay marker and never value(app) or run", () => {
    const descriptor = describeCommand(glow, undefined);

    expect(descriptor).toEqual({
      id: "garden.glow",
      title: "Glow",
      input: { on: "boolean" },
      effect: "cosmetic",
      overlay: "toggle",
      allowed: true
    });
    expect(Object.values(descriptor).some(value => typeof value === "function")).toBe(false);
  });

  it("writes no overlay key for a command without a marker", () => {
    const step: DoorCommand = {
      id: "game.step",
      title: "Step frames",
      input: { frames: "number" },
      effect: "cosmetic",
      run: () => undefined
    };

    expect("overlay" in describeCommand(step, undefined)).toBe(false);
  });

  it("writes allowed: true and no reason when the build runs the command", () => {
    const descriptor = describeCommand(glow, undefined);

    expect(descriptor.allowed).toBe(true);
    expect("reason" in descriptor).toBe(false);
  });

  it("writes allowed: false with the reason when the build refuses it", () => {
    const descriptor = describeCommand({ ...glow, effect: "route" }, "read-only");

    expect(descriptor).toMatchObject({ allowed: false, reason: "read-only" });
  });

  it("drops an allowed or reason the given descriptor carried: the registry owns them", () => {
    const descriptor = describeCommand(
      {
        id: "editor.reload",
        title: "Reload",
        input: {},
        effect: "route",
        allowed: false,
        reason: "dev-only"
      },
      undefined
    );

    expect(descriptor.allowed).toBe(true);
    expect("reason" in descriptor).toBe(false);
  });
});

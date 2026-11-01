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

describe("describeCommand choices", () => {
  it("copies choices right after overlay, never choice(app); a door's later push changes nothing", () => {
    const choices = ["calm", "storm"];
    const descriptor = describeCommand({ ...glow, choices, choice: () => "calm" }, undefined);

    choices.push("gale");

    expect(Object.keys(descriptor)).toEqual([
      "id",
      "title",
      "input",
      "effect",
      "overlay",
      "choices",
      "allowed"
    ]);
    expect(descriptor.choices).toEqual(["calm", "storm"]);
    expect(Object.isFrozen(descriptor.choices)).toBe(true);
  });

  it("gives the bytes of a plain toggle for a missing and for an empty list: an older manifest keeps its shape", () => {
    const plain = JSON.stringify(describeCommand(glow, undefined));

    expect(JSON.stringify(describeCommand({ ...glow, choices: undefined }, undefined))).toBe(plain);
    expect(JSON.stringify(describeCommand({ ...glow, choices: [] }, undefined))).toBe(plain);
  });
});

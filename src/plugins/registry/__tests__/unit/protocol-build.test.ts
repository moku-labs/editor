import { describe, expect, it } from "vitest";
import type { BuildProfile, CommandDescriptor, Effect } from "../../protocol";
import { isAllowed, refusalOf } from "../../protocol";

// ─────────────────────────────────────────────────────────────────────────────
// refusalOf (spec 10 C1): which build runs which effect; isAllowed: how a panel
// reads a descriptor, an older agent's included
// ─────────────────────────────────────────────────────────────────────────────

const READ_EFFECTS: readonly Effect[] = ["read", "cosmetic"];
const WRITE_EFFECTS: readonly Effect[] = ["route", "cheat", "raw"];
const EVERY_EFFECT: readonly Effect[] = [...READ_EFFECTS, ...WRITE_EFFECTS];

/** The game.tap door of a manifest. */
const TAP: CommandDescriptor = {
  id: "game.tap",
  title: "Tap",
  input: { target: "string" },
  effect: "route"
};

describe("refusalOf", () => {
  it.each(WRITE_EFFECTS)("refuses %s on a read build as read-only", effect => {
    expect(refusalOf("read", effect)).toBe("read-only");
  });

  it.each(READ_EFFECTS)("runs %s on a read build", effect => {
    expect(refusalOf("read", effect)).toBeUndefined();
  });

  it.each(EVERY_EFFECT)("refuses %s on a page without flags as dev-only", effect => {
    expect(refusalOf("none", effect)).toBe("dev-only");
  });

  it.each([
    "dev",
    "full"
  ] as const satisfies readonly BuildProfile[])("runs every effect on a %s build", profile => {
    expect(EVERY_EFFECT.map(effect => refusalOf(profile, effect))).toEqual(
      EVERY_EFFECT.map(() => undefined)
    );
  });
});

describe("isAllowed", () => {
  it("reads a descriptor without allowed (an older agent) as allowed", () => {
    expect(isAllowed(TAP)).toBe(true);
  });

  it("reads allowed: false as refused and allowed: true as allowed", () => {
    expect(isAllowed({ ...TAP, allowed: false, reason: "read-only" })).toBe(false);
    expect(isAllowed({ ...TAP, allowed: true })).toBe(true);
  });
});

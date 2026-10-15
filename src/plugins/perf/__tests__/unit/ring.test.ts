import { DEMAND_REASONS, PERF_CAUSES } from "@moku-labs/game";
import { describe, expect, it } from "vitest";
import { CAUSE_BITS } from "../../protocol";
import { causeMap, REASON_NONE, ringCauses } from "../../ring";

// ─────────────────────────────────────────────────────────────────────────────
// ring: the agent side decodes the engine's ring with the engine's own lists
// (PERF_CAUSES, DEMAND_REASONS, root exports of game@0fda201): the ring's cause
// bits by name into the editor's bit order, and the draw reason "none".
// ─────────────────────────────────────────────────────────────────────────────

describe("causeMap", () => {
  it("moves each bit to the editor's bit of the same cause name (bug: a cause shown under another's name once the engine reorders its bits)", () => {
    const map = causeMap(["js", "gap"], ["gap", "js"]);
    expect([map[0b01], map[0b10], map[0b11], map[0]]).toEqual([0b10, 0b01, 0b11, 0]);
  });

  it("drops a bit whose name the editor does not know, and every bit past the engine's list", () => {
    const map = causeMap(["warp", "gap"], ["gap"]);
    expect([map[0b01], map[0b10], map[0b1000_0010]]).toEqual([0, 0b01, 0b01]);
  });

  it("has one entry for every byte value of the ring's causes column", () => {
    expect(causeMap(PERF_CAUSES, CAUSE_BITS)).toHaveLength(256);
  });
});

describe("ringCauses and REASON_NONE on today's engine", () => {
  it("decodes every known bit as itself (the engine's order is the editor's) and drops an unknown bit 7", () => {
    for (let bits = 0; bits < 128; bits += 1) expect(ringCauses(bits)).toBe(bits);
    expect(ringCauses(0b1000_0001)).toBe(1);
  });

  it('is the index of the engine\'s "none" draw reason (on demand, nothing drawn)', () => {
    expect(DEMAND_REASONS[REASON_NONE]).toBe("none");
  });
});

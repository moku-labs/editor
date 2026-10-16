/* eslint-disable unicorn/no-null -- null is "not measured" on the wire */
import { describe, expect, it } from "vitest";
import type { Json } from "../../../registry/protocol";
import { readFramesWire } from "../../protocol";
import type { WirePass } from "../wire-fixtures";
import { framesWire, runOf } from "../wire-fixtures";

// ─────────────────────────────────────────────────────────────────────────────
// protocol/frames readFramesWire (spec 03 Delta 2026-10-16 D9): the tools page
// takes a frames wire only when every column and block lines up with its rows.
// ─────────────────────────────────────────────────────────────────────────────

/** A decoded Json object the refusal cases change. */
type JsonObject = { [key: string]: Json };

/** Two pass rows of the first frame: the canvas and a filter of owner 412. */
const PASSES: WirePass[] = [
  { row: 0, index: 0, kind: "canvas", view: "main", format: "bgra8unorm", gpuMs: 3.1, draws: 41 },
  { row: 0, index: 1, kind: "filter", view: "fogLayer", owner: 412, filter: "fog.blur" },
  { row: 1, index: 0, kind: "canvas", view: "main" }
];

/**
 * A full wire of two frames: draws, systems, nodes and passes.
 *
 * @returns The wire as the tools page reads it.
 */
function fullWire(): JsonObject {
  const rows = runOf(4855, 2, 80_000, 10, {
    draws: 61,
    nodes: 20,
    systems: [
      ["ward.update", 6.2],
      ["fog.render", 1.4]
    ]
  });
  return framesWire(rows, { draws: true, systems: true, nodes: true, passes: PASSES });
}

/**
 * The value at a path of a wire, as an object to change.
 *
 * @param wire - The wire.
 * @param key - The block.
 * @returns The block.
 */
function block(wire: JsonObject, key: string): JsonObject {
  return wire[key] as JsonObject;
}

/** Each refused value: what is wrong, the bug it would cause, how to make it. */
const REFUSED: { name: string; change: (wire: JsonObject) => void }[] = [
  { name: "v: 2 (a newer wire read as this one)", change: wire => (wire.v = 2) },
  {
    name: "a column one row short (bug: the tools page indexing past an array)",
    change: wire => (wire.ms = [9])
  },
  {
    name: "a string in a number column (bug: NaN in the history)",
    change: wire => (wire.jsMs = [8, "8"])
  },
  { name: "drawn 2 (bug: a value outside 0 | 1)", change: wire => (wire.drawn = [1, 2]) },
  { name: "rest 7 (bug: a value outside REST)", change: wire => (wire.rest = [0, 7]) },
  {
    name: "a systems idx outside names (bug: indexing past the names table)",
    change: wire => {
      const systems = block(wire, "systems");
      systems.idx = [0, 2, -1, -1, -1, 0, 1, -1, -1, -1];
    }
  },
  {
    name: "systems idx not rows × 5 (bug: systems of the wrong frame)",
    change: wire => {
      const systems = block(wire, "systems");
      systems.idx = [0, 1, -1, -1, -1];
      systems.ms = [6.2, 1.4, 0, 0, 0];
    }
  },
  {
    name: "a pass row outside the frame rows (bug: a pass attached to a frame the wire does not hold)",
    change: wire => (block(wire, "passes").row = [0, 0, 2])
  },
  {
    name: "pass rows going back (bug: the history's pass rows out of frame order)",
    change: wire => (block(wire, "passes").row = [1, 0, 1])
  },
  {
    name: "an unknown pass kind (bug: a kind the history cannot name)",
    change: wire => (block(wire, "passes").kind = ["canvas", "compute", "canvas"])
  },
  {
    name: "a pass column one row short (bug: a pass without its owner)",
    change: wire => (block(wire, "passes").owner = [null, 412])
  },
  {
    name: "a draws column of another length (bug: draws of the wrong frame)",
    change: wire => (wire.draws = [61])
  },
  { name: "a non-boolean hole", change: wire => (wire.hole = "yes") },
  {
    name: "a number as the epoch (bug: a reload never told apart from the page before)",
    change: wire => (wire.epoch = 5)
  },
  { name: "t0 as text (bug: every row placed at NaN ms)", change: wire => (wire.t0 = "80000") },
  {
    name: "no gpuTimer (bug: iOS read as measuring the GPU)",
    change: wire => delete wire.gpuTimer
  },
  {
    name: "a system name that is not text (bug: a number shown as a system's name)",
    change: wire => (block(wire, "systems").names = ["ward.update", 7])
  }
];

describe("readFramesWire", () => {
  it("answers a full wire with every block as is (bug: a valid feed dropped and the history left blank)", () => {
    const wire = fullWire();
    expect(readFramesWire(wire)).toBe(wire);
  });

  it("answers a wire of an older agent without the optional blocks, and an empty wire (bug: a 0.15.0 phone's feed refused)", () => {
    const old = framesWire(runOf(4855, 3), { epoch: null });
    expect(readFramesWire(old)).toBe(old);
    const empty = framesWire([]);
    expect(readFramesWire(empty)).toBe(empty);
  });

  it.each(REFUSED)("refuses $name", ({ change }) => {
    const wire = fullWire();
    change(wire);
    expect(readFramesWire(wire)).toBeUndefined();
  });

  it("refuses a value that is not an object (bug: a null answer from an agent crashing the poll)", () => {
    expect(readFramesWire(null)).toBeUndefined();
    expect(readFramesWire([1, 2])).toBeUndefined();
  });
});

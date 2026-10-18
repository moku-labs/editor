/* eslint-disable unicorn/no-null -- null is "not measured" on the wire */
import { describe, expect, it } from "vitest";
import { headerLine } from "../../../../../tests/fixtures/fake-monitor";
import type { Json } from "../../../registry/protocol";
import type { PerfFramesWire } from "../../protocol";
import { readFramesWire, SECTION_DEFAULTS } from "../../protocol";
import { commitFrames, feedRig } from "../helpers";
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

// ─────────────────────────────────────────────────────────────────────────────
// The agent's editor.perf.frames { after? } (D9): the window rows after a frame,
// each frame once, with the blocks the feeds switched on.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads the frames feed.
 *
 * @param read - The rig's source read.
 * @param after - The newest frame the reader has.
 * @returns The wire.
 */
function framesAfter(read: (id: string, input?: Json) => Json, after?: number): PerfFramesWire {
  const wire = read("editor.perf.frames", after === undefined ? {} : { after });
  const checked = readFramesWire(wire);
  if (checked === undefined) throw new Error("the frames feed sent a wire readFramesWire refuses");
  return checked;
}

describe("editor.perf.frames", () => {
  it("answers the rows after `after`, the whole window with hole when frames were lost before it, and no hole without after (bug: a gap drawn as continuous frames, or frames sent twice)", () => {
    const { monitor, tick, read } = feedRig({ windowMs: 1000 });
    commitFrames(monitor, 100, 0, 20);
    tick();

    const all = framesAfter(read);
    expect([all.frame[0], all.frame.length, all.hole]).toEqual([50, 51, false]);
    expect(all).toMatchObject({ epoch: "1760453960000", t0: 980, gpuTimer: true });

    const newer = framesAfter(read, 97);
    expect(newer).toMatchObject({ frame: [98, 99, 100], t0: 1940, t: [0, 20, 40], hole: false });
    expect(framesAfter(read, 10)).toMatchObject({ hole: true, frame: all.frame });
    expect(framesAfter(read, 49)).toMatchObject({ hole: false, frame: all.frame });
    expect(framesAfter(read, 100).frame).toEqual([]);
  });

  it("carries the top 5 systems only with feeds.systems and the ring's names, aligned with their frames after the window drops its oldest quarter (bug: systems of the wrong frame)", async () => {
    const { monitor, tick, read, command } = feedRig({ frames: 64, windowMs: 30_000 });
    const ward = monitor.addSystem("ward.update");
    const fog = monitor.addSystem("fog.render");
    const commitRun = (from: number): void => {
      for (let index = from; index < from + 40; index += 1) {
        const systems =
          index % 2 === 0
            ? [{ idx: ward, ms: index }]
            : [
                { idx: fog, ms: 1 },
                { idx: ward, ms: 0.5 }
              ];
        monitor.commit({ t: index * 16.7, gapMs: 16.7, systems });
      }
    };
    commitRun(0);
    tick();
    commitRun(40);
    tick();

    const wire = framesAfter(read);
    expect(wire.frame[0]).toBe(17);
    expect(wire.systems?.names).toEqual(["ward.update", "fog.render"]);
    // Frame 17 ran at index 16 (ward only), frame 18 at index 17 (fog, then ward).
    expect(wire.systems?.idx.slice(0, 10)).toEqual([0, -1, -1, -1, -1, 1, 0, -1, -1, -1]);
    expect(wire.systems?.ms.slice(0, 7)).toEqual([16, 0, 0, 0, 0, 1, 0.5]);

    await command("editor.perf.sections").run({ systems: false });
    expect(framesAfter(read).systems).toBeUndefined();
  });

  it("sends no systems block for a ring without system names, and the nodes only with feeds.nodes (bug: zeros shown for what is not read)", async () => {
    const { monitor, tick, read, command } = feedRig({}, { systemNames: "none" });
    monitor.commit({ t: 0, marks: 20, draws: 61 });
    tick();
    const plain = framesAfter(read);
    expect(plain.systems).toBeUndefined();
    expect(plain.nodes).toBeUndefined();
    expect(plain.draws).toEqual([61]);

    await command("editor.perf.sections").run({ nodes: true });
    monitor.commit({ t: 16.7, gapMs: 16.7, marks: 20 });
    tick();
    expect(framesAfter(read).nodes).toEqual([-1, 20]);
  });
});

describe("editor.perf.frames and the engine's sections (D7)", () => {
  it("leaves out the block of a section the engine switched off while the capability stays (bug: an off section sent as 'no systems' or 0 nodes)", async () => {
    const sections = { ...SECTION_DEFAULTS, systems: false, nodes: false, passes: false };
    const { monitor, tick, read, command, state } = feedRig(
      { feedPasses: true, feedNodes: true },
      { header: headerLine({ sections }) }
    );
    monitor.addSystem("ward.update");
    monitor.commit({ t: 0, marks: 3, systems: [{ idx: 0, ms: 1 }] });
    monitor.commitPass();
    tick();
    const off = framesAfter(read);
    expect([off.systems, off.nodes, off.passes]).toEqual([undefined, undefined, undefined]);
    expect(state.caps.systemNames).toBe(true);

    await command("editor.perf.sections").run({ systems: true, nodes: true, passes: true });
    monitor.commit({ t: 16.7, gapMs: 16.7, marks: 3, systems: [{ idx: 0, ms: 1 }] });
    monitor.commitPass();
    tick();
    const on = framesAfter(read, 1);
    expect(on.systems?.idx.slice(0, 1)).toEqual([0]);
    expect(on.nodes).toEqual([3]);
    expect(on.passes?.row).toEqual([0]);
  });
});

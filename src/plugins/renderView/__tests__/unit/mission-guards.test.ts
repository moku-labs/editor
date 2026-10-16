/* eslint-disable unicorn/no-null -- null is a JSON value on the wire */
import { describe, expect, it } from "vitest";
import { toWireValue } from "../../../registry/protocol";
import {
  isDetailWire,
  isEventsWire,
  isPassesWire,
  isPerfSecond,
  isRecorderSource
} from "../../source/guards";
import { commandAllowed, listed } from "../../source/listed";
import { recorderOf, secondOf } from "../device-fixtures";
import { missionManifest } from "../mission-ctx";
import { rowsOf, wireOf } from "../mission-fixtures";

// ─────────────────────────────────────────────────────────────────────────────
// source/guards.ts and source/listed.ts (spec 09 § M2 rule 1, M4 note): the
// shapes Mission control takes, and what a manifest lists.
// ─────────────────────────────────────────────────────────────────────────────

describe("guards", () => {
  it("a second of an older agent (no monitor, memory, caps or epoch) passes; a broken optional field does not", () => {
    // Bug: every second of an older agent dropped, or a malformed monitor shown.
    const second = secondOf();
    expect(isPerfSecond(toWireValue(second))).toBe(true);
    expect(isPerfSecond({ ...second, monitor: { engine: "yes" } })).toBe(false);
    expect(isPerfSecond({ ...second, rate: { fps: "60" } })).toBe(false);
    expect(isPerfSecond({ ...second, epoch: 3 })).toBe(false);
  });

  it("a passes wire, an events wire and a recorder source have their shapes", () => {
    // Bug: a passes answer of the engine's line (rows null) refused.
    const passes = {
      v: 1,
      source: "engine",
      t: 1,
      frames: 60,
      tiler: false,
      gpuTimer: true,
      rows: null,
      heaviest: null,
      line: { t: 1, chains: [], heaviest: null },
      shaders: null,
      targets: null,
      lost: 0
    };
    expect(isPassesWire(passes)).toBe(true);
    expect(isPassesWire({ ...passes, source: "phone" })).toBe(false);
    expect(
      isEventsWire({ v: 1, epoch: null, timeOrigin: null, next: 0, lost: false, items: [] })
    ).toBe(true);
    expect(
      isEventsWire({ v: 1, epoch: null, timeOrigin: null, next: "0", lost: false, items: [] })
    ).toBe(false);
    expect(
      isRecorderSource(
        toWireValue({ ...recorderOf(), marks: [{ atMs: 1, label: "a", auto: false }] })
      )
    ).toBe(true);
    expect(
      isRecorderSource(
        toWireValue({ ...recorderOf(), startedBy: { by: "robot", name: null }, marks: [] })
      )
    ).toBe(false);
  });

  it("a detail answer checks its frames and nodes", () => {
    // Bug: a detail with broken frames appended to the history.
    const detail = {
      v: 1,
      from: 1,
      to: 5,
      source: "agent",
      reason: "no-detail",
      frames: toWireValue(wireOf(rowsOf(1, 5))),
      nodes: null
    };
    expect(isDetailWire(detail)).toBe(true);
    expect(isDetailWire({ ...detail, frames: { v: 1 } })).toBe(false);
    expect(
      isDetailWire({ ...detail, nodes: [{ entity: 1, label: null, how: "teleport", count: 1 }] })
    ).toBe(false);
  });
});

describe("listed", () => {
  it("lists an available source and an allowed command only", () => {
    // Bug: a watch sent for a source the game marked unavailable (-32008 every second).
    const manifest = missionManifest();
    expect(listed(manifest, "editor.perf.frames")).toBe(true);
    expect(
      listed(
        {
          ...manifest,
          sources: manifest.sources.map(source => ({ ...source, available: false as const }))
        },
        "editor.perf.frames"
      )
    ).toBe(false);
    expect(listed(undefined, "editor.perf.frames")).toBe(false);
    expect(commandAllowed(manifest, "game.frameRate")).toBe(true);
    expect(commandAllowed(missionManifest(undefined, false), "game.frameRate")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  countPins,
  emptyPins,
  mergeDirty,
  parsePins,
  resetPins,
  serializePins,
  snap
} from "../../layout/pins";
import type { PinsFile } from "../../layout/types";

const text = `{
  "version": 1,
  "nodes": { "board/merge": { "x": 624, "y": 288 }, "main/home": { "x": 12, "y": 24 } },
  "notes": { ".moku/notes/2026-09-24-first-top-item.md": { "flow": "board", "x": 900, "y": 300 } },
  "comment": "kept"
}`;

describe("parsePins", () => {
  it("reads nodes and keeps unknown top-level keys; an old notes field loads and is only kept", () => {
    const pins = parsePins(text);
    expect(pins?.nodes["board/merge"]).toEqual({ x: 624, y: 288 });
    expect(pins?.extra).toEqual({
      comment: "kept",
      notes: { ".moku/notes/2026-09-24-first-top-item.md": { flow: "board", x: 900, y: 300 } }
    });
    expect(parsePins('{ "version": 1, "notes": { "n.md": { "x": 1, "y": 2 } } }')?.nodes).toEqual(
      {}
    );
  });

  it("returns undefined for invalid JSON or a wrong shape", () => {
    expect(parsePins("{ nope")).toBeUndefined();
    expect(parsePins("[]")).toBeUndefined();
    expect(parsePins('{ "version": 2, "nodes": {} }')).toBeUndefined();
    expect(parsePins('{ "version": 1, "nodes": { "a/b": { "x": "1", "y": 2 } } }')).toBeUndefined();
  });

  it("reads a file without nodes as empty", () => {
    expect(parsePins('{ "version": 1 }')).toEqual(emptyPins());
  });
});

describe("serializePins", () => {
  it("writes sorted keys, 2-space indent and a trailing newline; round-trips", () => {
    const pins = parsePins(text);
    if (pins === undefined) throw new Error("invalid");
    const written = serializePins(pins);
    expect(written.endsWith("}\n")).toBe(true);
    expect(written.indexOf('"board/merge"')).toBeLessThan(written.indexOf('"main/home"'));
    expect(written.indexOf('"comment"')).toBeLessThan(written.indexOf('"nodes"'));
    expect(written).toContain('\n  "version": 1');
    expect(parsePins(written)).toEqual(pins);
  });
});

describe("snap", () => {
  it("rounds to the nearest multiple of 12", () => {
    expect(snap(17)).toBe(12);
    expect(snap(18)).toBe(24);
    expect(snap(-5)).toBe(0);
    expect(Object.is(snap(-5), -0)).toBe(false);
    expect(snap(629)).toBe(624);
    expect(snap(630)).toBe(636); // Fixed: 630 is 52.5 steps, Math.round goes up
  });
});

describe("resetPins and countPins", () => {
  const pins: PinsFile = {
    version: 1,
    nodes: { "board/merge": { x: 1, y: 2 }, "main/home": { x: 3, y: 4 } },
    extra: {}
  };

  it("removes only the visible flows' node pins", () => {
    const reset = resetPins(pins, new Set(["main", "board"]));
    expect(reset.nodes).toEqual({});
    expect(resetPins(pins, new Set(["main"])).nodes).toEqual({ "board/merge": { x: 1, y: 2 } });
  });

  it("counts the pins of the visible flows (M8)", () => {
    expect(countPins(pins, new Set(["main", "board"]))).toBe(2);
    expect(countPins(pins, new Set(["settingsPopup"]))).toBe(0);
  });
});

describe("mergeDirty", () => {
  it("re-applies only the changed ids onto the fresh file", () => {
    const fresh: PinsFile = {
      version: 1,
      nodes: { "main/home": { x: 99, y: 99 }, "main/boot": { x: 5, y: 5 } },
      extra: { other: true }
    };
    const current: PinsFile = {
      version: 1,
      nodes: { "board/merge": { x: 624, y: 288 }, "main/home": { x: 0, y: 0 } },
      extra: {}
    };
    const merged = mergeDirty(fresh, current, new Set(["board/merge", "main/boot"]));
    expect(merged.nodes).toEqual({
      "main/home": { x: 99, y: 99 },
      "board/merge": { x: 624, y: 288 }
    });
    expect(merged.extra).toEqual({ other: true });
  });
});

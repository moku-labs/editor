/* eslint-disable unicorn/no-null -- null is a JSON value on the wire */
import { describe, expect, it } from "vitest";
import { ancestorsOf, deepEqual, diffJson, diffModel, escapeSegment, pointerOf } from "../../diff";
import { model, playerAfter, playerBefore } from "../fixtures";

describe("diffJson", () => {
  it("returns no patch for deep-equal values", () => {
    expect(diffJson({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }, "player", 10)).toEqual({
      patches: [],
      truncated: 0
    });
  });

  it("replaces, adds and removes object keys in next order, removals last, with the old value", () => {
    const { patches } = diffJson(
      { keep: 1, gone: "x", same: true },
      { keep: 2, same: true, fresh: null },
      "session",
      10
    );
    expect(patches).toEqual([
      {
        op: "replace",
        root: "session",
        path: ["keep"],
        pointer: "/session/keep",
        value: 2,
        was: 1
      },
      { op: "add", root: "session", path: ["fresh"], pointer: "/session/fresh", value: null },
      { op: "remove", root: "session", path: ["gone"], pointer: "/session/gone", was: "x" }
    ]);
  });

  it("walks nested paths and replaces a value whose kind changed", () => {
    const { patches } = diffJson({ a: { b: { c: 1 } } }, { a: { b: [1] } }, "player", 10);
    expect(patches).toEqual([
      {
        op: "replace",
        root: "player",
        path: ["a", "b"],
        pointer: "/player/a/b",
        value: [1],
        was: { c: 1 }
      }
    ]);
  });

  it("replaces a changed root scalar at the root pointer", () => {
    expect(diffJson(1, 2, "player", 10).patches).toEqual([
      { op: "replace", root: "player", path: [], pointer: "/player", value: 2, was: 1 }
    ]);
  });

  it("reads a single array insert at 0 as one add", () => {
    const { patches } = diffJson(
      { items: [{ id: 1 }] },
      { items: [{ id: 0 }, { id: 1 }] },
      "player",
      10
    );
    expect(patches).toEqual([
      {
        op: "add",
        root: "player",
        path: ["items", 0],
        pointer: "/player/items/0",
        value: { id: 0 }
      }
    ]);
  });

  it("takes the first index for an insert next to an equal item", () => {
    expect(diffJson(["a"], ["a", "a"], "player", 10).patches.map(patch => patch.pointer)).toEqual([
      "/player/0"
    ]);
    expect(diffJson([1, 3], [1, 2, 3], "player", 10).patches).toEqual([
      { op: "add", root: "player", path: [1], pointer: "/player/1", value: 2 }
    ]);
  });

  it("reads a single array removal as one remove", () => {
    const { patches } = diffJson(
      [{ id: 1 }, { id: 2 }, { id: 3 }],
      [{ id: 1 }, { id: 3 }],
      "session",
      10
    );
    expect(patches).toEqual([
      { op: "remove", root: "session", path: [1], pointer: "/session/1", was: { id: 2 } }
    ]);
  });

  it("diffs other array changes index-wise, removals from the highest index down", () => {
    expect(diffJson([1, 2, 3, 4], [9, 2], "player", 10).patches).toEqual([
      { op: "replace", root: "player", path: [0], pointer: "/player/0", value: 9, was: 1 },
      { op: "remove", root: "player", path: [3], pointer: "/player/3", was: 4 },
      { op: "remove", root: "player", path: [2], pointer: "/player/2", was: 3 }
    ]);
    expect(
      diffJson([1], [2, 3, 4], "player", 10).patches.map(patch => [patch.op, patch.pointer])
    ).toEqual([
      ["replace", "/player/0"],
      ["add", "/player/1"],
      ["add", "/player/2"]
    ]);
  });

  it("counts patches after max as truncated", () => {
    expect(diffJson({}, { a: 1, b: 2, c: 3 }, "player", 2)).toMatchObject({ truncated: 1 });
    expect(diffJson({}, { a: 1, b: 2, c: 3 }, "player", 2).patches).toHaveLength(2);
    expect(diffJson({}, { a: 1, b: 2, c: 3 }, "player", 0)).toEqual({ patches: [], truncated: 3 });
  });

  it("escapes ~ and / in pointers (RFC 6901)", () => {
    expect(diffJson({}, { "a/b": { "c~d": 1 } }, "player", 10).patches[0]?.pointer).toBe(
      "/player/a~1b"
    );
    expect(pointerOf("player", ["a/b", "c~d", 0])).toBe("/player/a~1b/c~0d/0");
    expect(escapeSegment("~/")).toBe("~0~1");
    expect(pointerOf("session", [])).toBe("/session");
  });

  it("gives the four patches of the design §8 commit at f1503", () => {
    const { patches, truncated } = diffJson(playerBefore(), playerAfter(), "player", 200);
    expect(truncated).toBe(0);
    expect(patches.map(patch => [patch.op, patch.pointer, patch.was])).toEqual([
      ["add", "/player/merge/board/items/0", undefined],
      ["replace", "/player/merge/energy/value", 8],
      ["replace", "/player/merge/generators/sawmill/charges", 2],
      ["replace", "/player/merge/nextItemId", 3]
    ]);
    expect(patches[0]?.value).toEqual({ id: "i3", chain: "wood", level: 1, cell: "c0_1" });
  });
});

describe("diffModel", () => {
  it("diffs player then session within one max and flags an rng change", () => {
    const result = diffModel(
      model(playerBefore(), { taps: 2 }, { seed: 1 }),
      model(playerAfter(), { taps: 3 }, { seed: 2 }),
      3
    );
    expect(result.patches.map(patch => patch.pointer)).toEqual([
      "/player/merge/board/items/0",
      "/player/merge/energy/value",
      "/player/merge/generators/sawmill/charges"
    ]);
    expect(result.truncated).toBe(2);
    expect(result.rngChanged).toBe(true);
  });

  it("keeps session patches when the player is equal and rng is absent on both sides", () => {
    const result = diffModel(
      { player: 1, session: { taps: 2 } },
      { player: 1, session: { taps: 3 } },
      10
    );
    expect(result.patches.map(patch => patch.pointer)).toEqual(["/session/taps"]);
    expect(result.rngChanged).toBe(false);
  });
});

describe("ancestorsOf", () => {
  it("lists every proper prefix pointer of the patches", () => {
    const { patches } = diffJson(playerBefore(), playerAfter(), "player", 200);
    const ancestors = ancestorsOf(patches);
    expect([...ancestors].toSorted()).toEqual(
      [
        "/player",
        "/player/merge",
        "/player/merge/board",
        "/player/merge/board/items",
        "/player/merge/energy",
        "/player/merge/generators",
        "/player/merge/generators/sawmill"
      ].toSorted()
    );
  });
});

describe("deepEqual", () => {
  it("compares JSON values structurally", () => {
    expect(deepEqual({ a: [1, { b: null }] }, { a: [1, { b: null }] })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqual({ a: 1, c: 2 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqual([1], { 0: 1 })).toBe(false);
    expect(deepEqual([1, 2], [1])).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
    expect(deepEqual(undefined, undefined)).toBe(true);
    expect(deepEqual(undefined, null)).toBe(false);
    expect(deepEqual("1", 1)).toBe(false);
  });
});

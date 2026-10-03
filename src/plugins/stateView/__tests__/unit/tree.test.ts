/* eslint-disable unicorn/no-null -- null is a JSON value on the wire */
import { describe, expect, it } from "vitest";
import { compactJson, containerPointers, kindOf, summaryOf, treeRows } from "../../tree";
import { playerBefore } from "../fixtures";

const depthBelow =
  (limit: number) =>
  (_pointer: string, depth: number): boolean =>
    depth < limit;

describe("treeRows", () => {
  it("lists the root row only when the root is closed", () => {
    const rows = treeRows({ a: 1 }, "player", { isOpen: depthBelow(0), shown: () => 100 });
    expect(rows).toEqual([
      {
        kind: "node",
        pointer: "/player",
        parent: undefined,
        label: "player",
        depth: 0,
        value: { a: 1 },
        size: 1,
        open: false
      }
    ]);
  });

  it("opens rows by depth, in key order, with escaped child pointers", () => {
    const rows = treeRows({ "a/b": { c: 1 }, list: [true] }, "session", {
      isOpen: depthBelow(2),
      shown: () => 100
    });
    expect(rows.map(row => [row.pointer, row.depth])).toEqual([
      ["/session", 0],
      ["/session/a~1b", 1],
      ["/session/a~1b/c", 2],
      ["/session/list", 1],
      ["/session/list/0", 2]
    ]);
    expect(rows[2]).toMatchObject({
      kind: "node",
      label: "c",
      parent: "/session/a~1b",
      size: undefined
    });
  });

  it("pages children: a more row counts the hidden ones", () => {
    const rows = treeRows([1, 2, 3, 4, 5], "player", { isOpen: depthBelow(1), shown: () => 2 });
    expect(rows.map(row => row.pointer)).toEqual([
      "/player",
      "/player/0",
      "/player/1",
      "/player#more"
    ]);
    expect(rows[3]).toEqual({
      kind: "more",
      pointer: "/player#more",
      parent: "/player",
      depth: 1,
      hidden: 3
    });
  });
});

describe("containerPointers", () => {
  it("lists every object and array pointer under the root", () => {
    const pointers = containerPointers({ a: { b: [1, { c: null }] }, d: 1 }, "player");
    expect(pointers).toEqual(["/player", "/player/a", "/player/a/b", "/player/a/b/1"]);
  });

  it("lists nothing for a scalar root", () => {
    expect(containerPointers(3, "session")).toEqual([]);
  });

  it("covers the player fixture", () => {
    expect(containerPointers(playerBefore(), "player")).toContain(
      "/player/merge/generators/sawmill"
    );
  });
});

describe("compactJson, kindOf, summaryOf", () => {
  it("prints compact JSON cut at the limit with an ellipsis", () => {
    expect(compactJson({ a: [1, "x"] })).toBe('{"a":[1,"x"]}');
    expect(compactJson("x".repeat(10), 5)).toBe('"xxx…');
    expect(compactJson(undefined)).toBe("");
  });

  it("names the kind of a leaf value", () => {
    expect([kindOf(1), kindOf("s"), kindOf(true), kindOf(null), kindOf([]), kindOf({})]).toEqual([
      "number",
      "string",
      "boolean",
      "null",
      "array",
      "object"
    ]);
  });

  it("summarises closed containers", () => {
    expect(summaryOf({ a: 1, b: 2, c: 3 })).toBe("{3}");
    expect(summaryOf([1, 2])).toBe("[2]");
    expect(summaryOf(7)).toBe("7");
  });
});

/* eslint-disable unicorn/no-null -- null is a JSON value */
import { describe, expect, it } from "vitest";
import { hashText, parseGraph, parseHistory, parsePosition } from "../../data";
import { cloneGraph, entry, mergeGraph } from "../helpers";

describe("parseGraph", () => {
  it("accepts game.graph and keeps the declared key order", () => {
    const parsed = parseGraph(structuredClone(mergeGraph));
    expect("graph" in parsed).toBe(true);
    if (!("graph" in parsed)) return;
    expect(parsed.graph.main).toBe("main");
    expect(Object.keys(parsed.graph.flows.board?.nodes ?? {})[0]).toBe("awaitIntent");
    expect(parsed.graph.flows.main?.nodes.settings?.subFlow).toBe("settingsPopup");
    expect(parsed.graph.slots.afterOrder?.[0]).toEqual({
      feature: "reward",
      flow: "rewardPopup",
      order: 10
    });
  });

  it("names the field of an invalid value", () => {
    expect(parseGraph(null)).toEqual({ field: "graph" });
    expect(parseGraph({ main: 1, flows: {}, slots: {} })).toEqual({ field: "main" });
    expect(parseGraph({ main: "main", flows: [], slots: {} })).toEqual({ field: "flows" });
    const bad = cloneGraph();
    Reflect.set(bad.flows.main?.nodes.home ?? {}, "outcomes", "play");
    expect(parseGraph(bad)).toEqual({ field: "flows.main.nodes.home" });
    const badEdge = cloneGraph();
    Reflect.set(badEdge.flows.main?.edges ?? {}, "home", { play: 3 });
    expect(parseGraph(badEdge)).toEqual({ field: "flows.main.edges.home" });
    const badSlot = cloneGraph();
    Reflect.set(badSlot.slots, "a", [{ flow: 1 }]);
    expect(parseGraph(badSlot)).toEqual({ field: "slots.a" });
    expect(parseGraph({ main: "x", flows: {}, slots: {} })).toEqual({ field: "main" });
  });

  it("drops a node `file` from the wire: the project index is the only source (F-H2 retired)", () => {
    const graph = cloneGraph();
    Reflect.set(graph.flows.board?.nodes.merge ?? {}, "file", "src/nodes/merge.ts");
    const parsed = parseGraph(graph);
    const merge = "graph" in parsed ? parsed.graph.flows.board?.nodes.merge : undefined;
    expect(merge).toBeDefined();
    expect(Object.hasOwn(merge ?? {}, "file")).toBe(false);
  });
});

describe("parsePosition and parseHistory", () => {
  it("reads game.position", () => {
    expect(
      parsePosition({
        path: "board/awaitIntent",
        flow: "board",
        node: "awaitIntent",
        waiting: ["tap"]
      })
    ).toEqual({ path: "board/awaitIntent", flow: "board", node: "awaitIntent", waiting: ["tap"] });
    expect(parsePosition({ path: "", waiting: [] })).toEqual({ path: "", waiting: [] });
    expect(parsePosition({ path: 1, waiting: [] })).toBeUndefined();
    expect(parsePosition({ path: "a", waiting: [1] })).toBeUndefined();
  });

  it("reads game.history entries, with an optional frame", () => {
    const entries = [
      entry(1, "home", "play"),
      entry(2, "board/merge", "rejected", { frame: 1778 })
    ];
    expect(parseHistory(structuredClone(entries))).toEqual(entries);
    expect(parseHistory([{ index: "1" }])).toBeUndefined();
    expect(parseHistory({})).toBeUndefined();
  });
});

describe("hashText", () => {
  it("is a stable 8-digit hex hash", () => {
    expect(hashText("abc")).toBe(hashText("abc"));
    expect(hashText("abc")).not.toBe(hashText("abd"));
    expect(hashText("")).toMatch(/^[\da-f]{8}$/);
  });
});

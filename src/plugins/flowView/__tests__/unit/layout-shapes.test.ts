// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { classifyEdges } from "../../layout/back-edges";
import { composeLayout } from "../../layout/compose";
import { createInlineEngine } from "../../layout/engine";
import { layoutLanes } from "../../layout/lanes";
import { emptyPins } from "../../layout/pins";
import { anchorIn, orthogonalRoute, roundedPath } from "../../layout/routes";
import { COL_GAP, HUB_W, NODE_W } from "../../layout/types";
import type { FlowJson, GraphJson, GraphNodeJson } from "../../types";
import { item, testConfig } from "../helpers";

/** A node. */
function node(
  flow: string,
  name: string,
  outcomes: string[],
  extra: Partial<GraphNodeJson> = {}
): GraphNodeJson {
  return {
    flow,
    node: name,
    rest: false,
    over: false,
    checkpoint: false,
    barrier: false,
    outcomes,
    ...extra
  };
}

/** A hub flow with a two-node prefix, an exit from the prefix, a mapped edge and an unreached pair. */
function prefixed(): FlowJson {
  const actions = ["a", "b", "c", "d", "e"];
  const nodes: Record<string, GraphNodeJson> = {
    boot: node("p", "boot", ["go", "quit"]),
    load: node("p", "load", ["done", "back"]),
    hub: node("p", "hub", [...actions, "skip", "missing"], { rest: true }),
    lost1: node("p", "lost1", ["next"]),
    lost2: node("p", "lost2", ["home"])
  };
  const edges: Record<string, Record<string, string>> = {
    boot: { go: "load", quit: "exit:quit" },
    load: { done: "hub", back: "boot" },
    hub: { skip: "hub" },
    lost1: { next: "lost2" },
    lost2: { home: "hub" }
  };
  for (const outcome of actions) {
    nodes[`do${outcome}`] = node("p", `do${outcome}`, ["done", "again"]);
    edges.hub = { ...edges.hub, [outcome]: `map:do${outcome}` };
    edges[`do${outcome}`] = { done: "hub", again: outcome === "a" ? "doa" : "dob" };
  }
  return { start: "boot", nodes, edges };
}

describe("hub-lane layout with a prefix", () => {
  const box = layoutLanes("p", prefixed(), "hub");
  const byKey = new Map(box.items.map(entry => [entry.key, entry]));

  it("puts the prefix in a row left of the hub, the hub after it", () => {
    expect(byKey.get("p/boot")?.y).toBe(0);
    expect(byKey.get("p/load")?.x).toBe(NODE_W + COL_GAP);
    expect(byKey.get("p/hub")?.x).toBe(2 * (NODE_W + COL_GAP));
    expect(box.lanes[0]?.x).toBe(2 * (NODE_W + COL_GAP) + HUB_W);
  });

  it("connects the prefix: forward edges, a stub back, an exit from the prefix", () => {
    expect(box.edges.some(edge => edge.key === "p/boot:go" && edge.to === "p/load")).toBe(true);
    expect(box.items.some(entry => entry.key === "stub:p/load:back")).toBe(true);
    expect(box.items.some(entry => entry.key === "exit:quit")).toBe(true);
    expect(box.items.find(entry => entry.key === "stub:p/doa:again")?.label).toBe("→ doa");
  });

  it("draws an empty lane for an outcome without an edge and a stub for one back to the hub", () => {
    const missing = box.lanes.find(lane => lane.outcome === "missing");
    expect(missing?.h).toBe(56);
    expect(box.items.find(entry => entry.key === "stub:p/hub:skip")?.label).toBe("↩ hub");
    expect(box.unreached).toEqual(["lost1", "lost2"]);
  });

  it("lays out the unreached nodes as an ELK block under the lanes", async () => {
    const graph: GraphJson = { main: "p", flows: { p: prefixed() }, slots: {} };
    const result = await composeLayout({
      graph,
      root: "p",
      expanded: new Set(),
      pins: emptyPins(),
      notes: [],
      config: testConfig(),
      engine: createInlineEngine()
    });
    const hub = result.byKey["p/hub"];
    const lost = result.byKey["p/lost1"];
    expect(lost?.y).toBeGreaterThan((hub?.y ?? 0) + (hub?.h ?? 0));
    expect(result.items.some(entry => entry.key === "stub:p/lost2:home")).toBe(true);
  });
});

describe("slot frames and back edges", () => {
  it("stacks the contribution flows of an expanded slot in one frame", async () => {
    const graph: GraphJson = {
      main: "m",
      flows: {
        m: { start: "s", nodes: { s: node("m", "s", ["done"], { slot: "after" }) }, edges: {} },
        one: { start: "x", nodes: { x: node("one", "x", []) }, edges: {} },
        two: { start: "y", nodes: { y: node("two", "y", []) }, edges: {} }
      },
      slots: {
        after: [
          { feature: "b", flow: "two", order: 20 },
          { feature: "a", flow: "one", order: 10 }
        ]
      }
    };
    const result = await composeLayout({
      graph,
      root: "m",
      expanded: new Set(["m/s"]),
      pins: emptyPins(),
      notes: [],
      config: testConfig(),
      engine: createInlineEngine()
    });
    const frame = result.byKey["m/s"];
    const first = result.byKey["m/s>one/x"];
    const second = result.byKey["m/s>two/y"];
    expect(frame?.kind).toBe("frame");
    expect((second?.y ?? 0) > (first?.y ?? 0)).toBe(true);
    expect(result.origins["m/s|two"]).toBeDefined();
  });

  it("classifies the edges of nodes the start does not reach", () => {
    const flow: FlowJson = {
      start: "a",
      nodes: { a: node("f", "a", ["x"]), b: node("f", "b", ["y"]), c: node("f", "c", ["z"]) },
      edges: { a: { x: "exit:out" }, b: { y: "c" }, c: { z: "b" } }
    };
    const classes = classifyEdges(flow);
    expect(classes.get("b:y")).toBe("forward");
    expect(classes.get("c:z")).toBe("short-loop");
  });

  it("routes and anchors the remaining shapes", () => {
    expect(roundedPath([{ x: 0, y: 0 }], 8)).toBe("M 0 0");
    expect(orthogonalRoute({ x: 0, y: 0 }, { x: 10, y: 5 })).toHaveLength(4);
    expect(anchorIn(item({ key: "h", kind: "hub", x: 5, y: 10 }))).toEqual({ x: 5, y: 46 });
  });
});

// @vitest-environment happy-dom
import type { ElkNode } from "elkjs";
import { describe, expect, it } from "vitest";
import { composeLayout } from "../../layout/compose";
import { createInlineEngine } from "../../layout/engine";
import { emptyPins } from "../../layout/pins";
import type { LayoutEngine } from "../../layout/types";
import type { FlowJson, GraphJson, GraphNodeJson } from "../../types";
import { testConfig } from "../helpers";

/** A node of the synthetic graph. */
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

/** A hub flow: a rest hub with 6 outcomes, 6 actions that all return to it, one exit. */
function hubFlow(name: string): FlowJson {
  const outcomes = ["a", "b", "c", "d", "e", "f"];
  const nodes: Record<string, GraphNodeJson> = {
    hub: node(name, "hub", [...outcomes, "leave"], { rest: true })
  };
  const edges: Record<string, Record<string, string>> = { hub: { leave: "exit:done" } };
  for (const outcome of outcomes) {
    nodes[`do${outcome}`] = node(name, `do${outcome}`, ["done", "rejected"]);
    edges.hub = { ...edges.hub, [outcome]: `do${outcome}` };
    edges[`do${outcome}`] = { done: "hub", rejected: "hub" };
  }
  return { start: "hub", nodes, edges };
}

/** A chain flow of n nodes with a loop back to the start. */
function chainFlow(name: string, count: number): FlowJson {
  const nodes: Record<string, GraphNodeJson> = {};
  const edges: Record<string, Record<string, string>> = {};
  for (let index = 0; index < count; index += 1) {
    nodes[`n${index}`] = node(name, `n${index}`, ["next", "back"]);
    edges[`n${index}`] = { next: index === count - 1 ? "exit:done" : `n${index + 1}`, back: "n0" };
  }
  return { start: "n0", nodes, edges };
}

/** 25 flows, about 200 nodes, 3 hubs: main opens 24 sub-flows. */
function syntheticGraph(): GraphJson {
  const flows: Record<string, FlowJson> = {};
  const mainNodes: Record<string, GraphNodeJson> = {};
  const mainEdges: Record<string, Record<string, string>> = {};
  for (let index = 0; index < 24; index += 1) {
    const flow = `f${index}`;
    flows[flow] = index < 3 ? hubFlow(flow) : chainFlow(flow, 8);
    mainNodes[`s${index}`] = node("main", `s${index}`, ["done"], { subFlow: flow });
    mainEdges[`s${index}`] = { done: index === 23 ? "s0" : `s${index + 1}` };
  }
  return {
    main: "main",
    flows: { main: { start: "s0", nodes: mainNodes, edges: mainEdges }, ...flows },
    slots: {}
  };
}

/** An engine that places ELK children in a row at once (isolates the main-thread work). */
const instant: LayoutEngine = {
  async layout(input: ElkNode): Promise<ElkNode> {
    let x = 0;
    for (const child of input.children ?? []) {
      child.x = x;
      child.y = 0;
      x += (child.width ?? 0) + 150;
    }
    return input;
  },
  dispose() {}
};

const graph = syntheticGraph();
const expanded = new Set(Object.keys(graph.flows.main?.nodes ?? {}).map(name => `main/${name}`));

/** The median of numbers. */
function median(values: number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** Lays out the synthetic graph with an engine. */
function compose(engine: LayoutEngine) {
  return composeLayout({
    graph,
    root: "main",
    expanded,
    pins: emptyPins(),
    config: testConfig(),
    engine
  });
}

describe("layout budgets (25 sub-flows, 200 nodes)", () => {
  it("has the size of the budget graph", () => {
    const nodes = Object.values(graph.flows).reduce(
      (sum, flow) => sum + Object.keys(flow.nodes).length,
      0
    );
    expect(Object.keys(graph.flows)).toHaveLength(25);
    expect(nodes).toBeGreaterThanOrEqual(200);
  });

  it("hub-lane + compose + routes stay within 8 ms on the main thread (median of 5, CI factor 3)", async () => {
    await compose(instant);
    const times: number[] = [];
    for (let run = 0; run < 5; run += 1) {
      const start = performance.now();
      const result = await compose(instant);
      times.push(performance.now() - start);
      expect(result.frames).toHaveLength(25);
    }
    expect(median(times)).toBeLessThanOrEqual(8 * 3);
  });

  it("one ELK layout stays within 450 ms at p95 with the inline engine (CI factor 3 of 150 ms)", async () => {
    const inline = createInlineEngine();
    const times: number[] = [];
    const timed: LayoutEngine = {
      async layout(input: ElkNode): Promise<ElkNode> {
        const start = performance.now();
        const output = await inline.layout(input);
        times.push(performance.now() - start);
        return output;
      },
      dispose() {}
    };
    await compose(timed);
    times.length = 0;
    const result = await compose(timed);
    const sorted = times.toSorted((a, b) => a - b);
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
    expect(times).toHaveLength(22);
    expect(p95).toBeLessThanOrEqual(450);
    expect(result.items.filter(item => item.kind === "hub")).toHaveLength(3);
  });
});

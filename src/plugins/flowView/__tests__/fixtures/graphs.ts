import type { FlowJson, GraphJson, GraphNodeJson } from "../../types";
import { cloneGraph } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Graph shapes for the layout quality tests (finding 16): a long chain, six
// nested sub-flows, a flow full of cycles, a hub with 40 outcomes, one node,
// an empty main flow and the merge-game graph. Each shape names the frames to
// expand, like the canvas would after a walk through it.
// ─────────────────────────────────────────────────────────────────────────────

/** One graph shape and the instance keys expanded on the canvas. */
export type GraphShape = {
  readonly name: string;
  readonly graph: GraphJson;
  readonly expanded: readonly string[];
};

/** A graph node. */
function node(
  flow: string,
  name: string,
  outcomes: readonly string[],
  extra: Partial<GraphNodeJson> = {}
): GraphNodeJson {
  return {
    flow,
    node: name,
    rest: false,
    over: false,
    checkpoint: false,
    barrier: false,
    outcomes: [...outcomes],
    ...extra
  };
}

/** A graph of flows with `main` as its main flow. */
function graphOf(flows: Record<string, FlowJson>): GraphJson {
  return { main: "main", flows, slots: {} };
}

/** 50 nodes in a row: each goes on to the next, the last one exits. */
function linear50(): GraphShape {
  const nodes: Record<string, GraphNodeJson> = {};
  const edges: Record<string, Record<string, string>> = {};
  for (let index = 0; index < 50; index += 1) {
    nodes[`step${index}`] = node("main", `step${index}`, ["next"]);
    edges[`step${index}`] = { next: index === 49 ? "exit:done" : `step${index + 1}` };
  }
  return {
    name: "linear50",
    graph: graphOf({ main: { start: "step0", nodes, edges } }),
    expanded: []
  };
}

/** Six sub-flows nested in each other, every level expanded: enter → open the next → leave. */
function deepNest6(): GraphShape {
  const flows: Record<string, FlowJson> = {};
  const expanded: string[] = [];
  let prefix = "";
  for (let level = 0; level <= 6; level += 1) {
    const flow = level === 0 ? "main" : `level${level}`;
    const nodes: Record<string, GraphNodeJson> = {
      enter: node(flow, "enter", ["go"]),
      leave: node(flow, "leave", ["back"])
    };
    const edges: Record<string, Record<string, string>> = { leave: { back: "exit:done" } };
    if (level < 6) {
      nodes.open = node(flow, "open", ["done"], { subFlow: `level${level + 1}` });
      edges.enter = { go: "open" };
      edges.open = { done: "leave" };
      prefix = prefix === "" ? `${flow}/open` : `${prefix}>${flow}/open`;
      expanded.push(prefix);
    } else {
      edges.enter = { go: "leave" };
    }
    flows[flow] = { start: "enter", nodes, edges };
  }
  return { name: "deepNest6", graph: graphOf(flows), expanded };
}

/** 12 nodes in a ring with 6 edges back to earlier nodes. */
function manyCycles(): GraphShape {
  const nodes: Record<string, GraphNodeJson> = {};
  const edges: Record<string, Record<string, string>> = {};
  for (let index = 0; index < 12; index += 1) {
    const back = index % 2 === 1;
    nodes[`n${index}`] = node("main", `n${index}`, back ? ["next", "retry"] : ["next"]);
    edges[`n${index}`] = {
      next: index === 11 ? "exit:done" : `n${index + 1}`,
      ...(back ? { retry: `n${index - 1}` } : {})
    };
  }
  return {
    name: "manyCycles",
    graph: graphOf({ main: { start: "n0", nodes, edges } }),
    expanded: []
  };
}

/** A rest hub with 40 outcomes: each runs an action that returns to the hub. */
function wideHub40(): GraphShape {
  const outcomes = Array.from({ length: 40 }, (_, index) => `action${index}`);
  const nodes: Record<string, GraphNodeJson> = {
    wait: node("main", "wait", [...outcomes, "quit"], { rest: true })
  };
  const edges: Record<string, Record<string, string>> = { wait: { quit: "exit:done" } };
  for (const outcome of outcomes) {
    nodes[`run${outcome}`] = node("main", `run${outcome}`, ["done", "failed"]);
    edges.wait = { ...edges.wait, [outcome]: `run${outcome}` };
    edges[`run${outcome}`] = { done: "wait", failed: "wait" };
  }
  return {
    name: "wideHub40",
    graph: graphOf({ main: { start: "wait", nodes, edges } }),
    expanded: []
  };
}

/** One node without outcomes. */
function singleNode(): GraphShape {
  const nodes = { only: node("main", "only", []) };
  return {
    name: "singleNode",
    graph: graphOf({ main: { start: "only", nodes, edges: {} } }),
    expanded: []
  };
}

/** A main flow without nodes. */
function emptyMain(): GraphShape {
  return {
    name: "emptyMain",
    graph: graphOf({ main: { start: "", nodes: {}, edges: {} } }),
    expanded: []
  };
}

/** The merge-game graph with the board and the settings popup open. */
function mergeGame(): GraphShape {
  return { name: "mergeGame", graph: cloneGraph(), expanded: ["main/board", "main/settings"] };
}

/**
 * Every shape of the quality tests.
 *
 * @returns The shapes.
 */
export function graphShapes(): readonly GraphShape[] {
  return [
    linear50(),
    deepNest6(),
    manyCycles(),
    wideHub40(),
    singleNode(),
    emptyMain(),
    mergeGame()
  ];
}

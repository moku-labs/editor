/* eslint-disable unicorn/no-null -- null is a JSON value and an override value */
import { describe, expect, it } from "vitest";
import type { Json } from "../../../registry/protocol";
import {
  buildUsedBy,
  flowStartOf,
  graphNodeOf,
  loadGraph,
  loadOverrides,
  rebuildUsedBy
} from "../../links/used-by";
import { createCtx, MANIFEST } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Used by over the protocol rule (R1): the merge-game file list and graph
// (copied here as data) give the "merge-game result" mapping, before and after
// the flat override file; loadOverrides and loadGraph.
// ─────────────────────────────────────────────────────────────────────────────

/** The .ts files of the merge-game fixture that the rule can reach (files at the root). */
const MERGE_FILES = new Set([
  "flows/board.ts",
  "flows/main.ts",
  "flows/reward.ts",
  "features/settings/flow.ts",
  "features/settings/nodes.ts",
  "features/settings/plugin.ts",
  "game.ts",
  ...[
    "await-intent",
    "boot",
    "catch-up",
    "daily-gift",
    "deliver",
    "energy",
    "give-to-order",
    "give",
    "grant",
    "home",
    "merge",
    "select",
    "set-loading",
    "show",
    "splash",
    "tap-generator",
    "toast"
  ].map(name => `nodes/${name}.ts`)
]);

const node = (flow: string, name: string, extra: Record<string, string> = {}): Json => ({
  flow,
  node: name,
  rest: false,
  over: false,
  checkpoint: false,
  barrier: false,
  outcomes: [],
  ...extra
});

const nodesOf = (
  flow: string,
  names: readonly string[],
  extra: Record<string, Record<string, string>> = {}
) => Object.fromEntries(names.map(name => [name, node(flow, name, extra[name])]));

/** The merge-game game.graph (flows main, board, settingsPopup, rewardPopup). */
const MERGE_GRAPH: Json = {
  main: "main",
  flows: {
    board: {
      start: "awaitIntent",
      edges: {},
      nodes: nodesOf(
        "board",
        [
          "awaitIntent",
          "tapGenerator",
          "select",
          "merge",
          "giveToOrder",
          "deliver",
          "catchUp",
          "energy",
          "toast",
          "settings"
        ],
        { settings: { subFlow: "settingsPopup" } }
      )
    },
    main: {
      start: "boot",
      edges: {},
      nodes: nodesOf(
        "main",
        ["boot", "splash", "setLoading", "home", "dailyGift", "settings", "board", "afterOrder"],
        {
          settings: { subFlow: "settingsPopup" },
          board: { subFlow: "board" },
          afterOrder: { slot: "afterOrder" }
        }
      )
    },
    settingsPopup: {
      start: "enter",
      edges: {},
      nodes: nodesOf("settingsPopup", ["enter", "open", "setVolume", "setLocale", "confirm"])
    },
    rewardPopup: { start: "show", edges: {}, nodes: nodesOf("rewardPopup", ["show", "grant"]) }
  },
  slots: { afterOrder: [{ feature: "reward", flow: "rewardPopup", order: 10 }] }
};

const exists = (path: string): boolean => MERGE_FILES.has(path);

/** A listener that does nothing. */
const noop = (): void => {};

/**
 * The map as plain data: path → "flow:<name>" and "<flow>/<node>" labels.
 *
 * @param map - The Used-by map.
 * @returns Path → labels, in walk order.
 */
function labels(
  map: ReadonlyMap<
    string,
    { flows: readonly string[]; nodes: readonly { flow: string; node: string }[] }
  >
) {
  return Object.fromEntries(
    [...map].map(([path, usedBy]) => [
      path,
      [
        ...usedBy.flows.map(flow => `flow:${flow}`),
        ...usedBy.nodes.map(ref => `${ref.flow}/${ref.node}`)
      ]
    ])
  );
}

describe("buildUsedBy on merge-game", () => {
  it("gives the conventional mapping without overrides (main first, then key order)", () => {
    const map = buildUsedBy(MERGE_GRAPH, exists, {});
    expect(labels(map)).toEqual({
      "flows/main.ts": ["flow:main"],
      "nodes/boot.ts": ["main/boot"],
      "nodes/splash.ts": ["main/splash"],
      "nodes/set-loading.ts": ["main/setLoading"],
      "nodes/home.ts": ["main/home"],
      "nodes/daily-gift.ts": ["main/dailyGift"],
      "flows/board.ts": ["flow:board"],
      "nodes/await-intent.ts": ["board/awaitIntent"],
      "nodes/tap-generator.ts": ["board/tapGenerator"],
      "nodes/select.ts": ["board/select"],
      "nodes/merge.ts": ["board/merge"],
      "nodes/give-to-order.ts": ["board/giveToOrder"],
      "nodes/deliver.ts": ["board/deliver"],
      "nodes/catch-up.ts": ["board/catchUp"],
      "nodes/energy.ts": ["board/energy"],
      "nodes/toast.ts": ["board/toast"],
      "nodes/show.ts": ["rewardPopup/show"],
      "nodes/grant.ts": ["rewardPopup/grant"]
    });
    expect([...map.keys()].slice(0, 3)).toEqual([
      "flows/main.ts",
      "nodes/boot.ts",
      "nodes/splash.ts"
    ]);
    const nodeCount = [...map.values()].reduce((sum, usedBy) => sum + usedBy.nodes.length, 0);
    expect(nodeCount).toBe(16);
  });

  it("completes the mapping with the flat override file", () => {
    const map = buildUsedBy(MERGE_GRAPH, exists, {
      rewardPopup: "flows/reward.ts",
      settingsPopup: "features/settings/flow.ts",
      "settingsPopup/*": "features/settings/nodes.ts"
    });
    expect(labels(map)["flows/reward.ts"]).toEqual(["flow:rewardPopup"]);
    expect(labels(map)["features/settings/flow.ts"]).toEqual(["flow:settingsPopup"]);
    expect(labels(map)["features/settings/nodes.ts"]).toEqual([
      "settingsPopup/enter",
      "settingsPopup/open",
      "settingsPopup/setVolume",
      "settingsPopup/setLocale",
      "settingsPopup/confirm"
    ]);
    expect(labels(map)["nodes/merge.ts"]).toEqual(["board/merge"]);
  });

  it("drops a path an override points to when it is not in the index, and null means no file", () => {
    const map = buildUsedBy(MERGE_GRAPH, exists, { main: "flows/gone.ts", "board/merge": null });
    expect(map.has("flows/main.ts")).toBe(false);
    expect(map.has("flows/gone.ts")).toBe(false);
    expect(map.has("nodes/merge.ts")).toBe(false);
  });

  it("is empty without a graph or with a value that is no graph", () => {
    expect(buildUsedBy(undefined, exists, {}).size).toBe(0);
    expect(buildUsedBy("graph", exists, {}).size).toBe(0);
    expect(buildUsedBy({ flows: [] }, exists, {}).size).toBe(0);
    expect(buildUsedBy({ main: "zzz", flows: { zzz: { nodes: [] } } }, exists, {}).size).toBe(0);
  });

  it("skips nodes that are not objects", () => {
    const graph: Json = { main: "x", flows: { x: { nodes: { a: 1, merge: {} } } } };
    expect(labels(buildUsedBy(graph, exists, {}))).toEqual({ "nodes/merge.ts": ["x/merge"] });
  });
});

/**
 * A one-node graph whose board/merge carries `file` (a dev-only field of the game).
 *
 * @param file - The node's `file` value.
 * @returns The graph.
 */
const withFile = (file: Json): Json => ({
  main: "board",
  flows: { board: { start: "merge", edges: {}, nodes: { merge: { node: "merge", file } } } }
});

describe("a graph node's own file (F-H2)", () => {
  it("wins over the rule and the overrides in buildUsedBy", () => {
    const map = buildUsedBy(withFile("features/x.ts"), exists, { "board/merge": "nodes/merge.ts" });
    expect(labels(map)["features/x.ts"]).toEqual(["board/merge"]);
    expect(map.has("nodes/merge.ts")).toBe(false);
  });

  it("is read by graphNodeOf; a file that is no string is ignored", () => {
    expect(graphNodeOf(withFile("features/x.ts"), { flow: "board", node: "merge" })).toEqual({
      file: "features/x.ts"
    });
    expect(graphNodeOf(withFile(3), { flow: "board", node: "merge" })).toEqual({});
    expect(labels(buildUsedBy(withFile(null), exists, {}))["nodes/merge.ts"]).toEqual([
      "board/merge"
    ]);
  });
});

describe("graphNodeOf and flowStartOf", () => {
  it("read a node's sub-flow or slot and a flow's start", () => {
    expect(graphNodeOf(MERGE_GRAPH, { flow: "main", node: "board" })).toEqual({ subFlow: "board" });
    expect(graphNodeOf(MERGE_GRAPH, { flow: "main", node: "afterOrder" })).toEqual({
      slot: "afterOrder"
    });
    expect(graphNodeOf(MERGE_GRAPH, { flow: "board", node: "merge" })).toEqual({});
    expect(graphNodeOf(MERGE_GRAPH, { flow: "nope", node: "merge" })).toBeUndefined();
    expect(graphNodeOf(undefined, { flow: "board", node: "merge" })).toBeUndefined();
    expect(flowStartOf(MERGE_GRAPH, "board")).toBe("awaitIntent");
    expect(flowStartOf(MERGE_GRAPH, "nope")).toBeUndefined();
    expect(flowStartOf({ main: "a", flows: { a: { start: 3 } } }, "a")).toBeUndefined();
  });
});

describe("loadOverrides", () => {
  it("parses the override file", async () => {
    const ctx = createCtx();
    expect(await loadOverrides(ctx)).toEqual({ "settingsPopup/*": "features/settings/nodes.ts" });
    expect(ctx.log.warn).not.toHaveBeenCalled();
  });

  it("warns the problems once and keeps the good entries", async () => {
    const ctx = createCtx({
      seed: {
        ".moku/editor/files.json": '{ "a b": "x.ts", "main": "../up.ts", "board": "flows/b.ts" }'
      }
    });
    expect(await loadOverrides(ctx)).toEqual({ board: "flows/b.ts" });
    expect(ctx.log.warn).toHaveBeenCalledTimes(1);
    expect(ctx.log.warn).toHaveBeenCalledWith("filesView:overrides-invalid", {
      problems: [expect.stringContaining('"a b"'), expect.stringContaining('"main"')]
    });
  });

  it("treats a missing file as {} with a debug line", async () => {
    const ctx = createCtx({ seed: {} });
    expect(await loadOverrides(ctx)).toEqual({});
    expect(ctx.log.debug).toHaveBeenCalledWith("filesView:overrides-missing", {
      path: ".moku/editor/files.json"
    });
    expect(ctx.log.warn).not.toHaveBeenCalled();
  });
});

describe("loadGraph and rebuildUsedBy", () => {
  it("reads game.graph while a manifest is present and rebuilds Used by", async () => {
    const ctx = createCtx();
    ctx.state.index = {
      files: new Map([["nodes/merge.ts", { path: "nodes/merge.ts", kind: "file", size: 1 }]]),
      children: new Map(),
      builtAt: 1,
      truncated: false
    };
    ctx.state.listeners.add(noop);
    ctx.link.manifestValue = MANIFEST;
    await loadGraph(ctx);
    expect(ctx.link.read).toHaveBeenCalledWith("game.graph");
    expect(ctx.state.graph).toEqual(ctx.link.graph);
    expect(ctx.state.usedBy?.get("nodes/merge.ts")?.nodes).toEqual([
      { flow: "board", node: "merge" }
    ]);
  });

  it("clears the graph without a manifest", async () => {
    const ctx = createCtx();
    ctx.state.graph = { main: "x" };
    ctx.state.usedBy = new Map();
    await loadGraph(ctx);
    expect(ctx.link.read).not.toHaveBeenCalled();
    expect(ctx.state.graph).toBeUndefined();
    expect(ctx.state.usedBy).toBeUndefined();
  });

  it("logs a failed read and clears the graph", async () => {
    const ctx = createCtx();
    ctx.link.manifestValue = MANIFEST;
    ctx.link.graph = undefined;
    await loadGraph(ctx);
    expect(ctx.state.graph).toBeUndefined();
    expect(ctx.log.warn).toHaveBeenCalledWith("filesView:graph-failed", {
      message: "no value for game.graph"
    });
  });

  it("builds an empty map with a graph but no index", () => {
    const ctx = createCtx();
    ctx.state.graph = ctx.link.graph;
    rebuildUsedBy(ctx);
    expect(ctx.state.usedBy?.size).toBe(0);
  });
});

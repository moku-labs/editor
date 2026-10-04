// @vitest-environment happy-dom
/* eslint-disable unicorn/no-null -- null is a JSON value */
import { afterEach, describe, expect, it, vi } from "vitest";
import { actionsOf } from "../../actions";
import { ingest, parseGraph, parseHistory, parsePosition } from "../../data";
import { composeLayout } from "../../layout/compose";
import { createInlineEngine } from "../../layout/engine";
import { emptyPins } from "../../layout/pins";
import type { FlowValues } from "../../types";
import { historyView, infoView, kindLine, worldView } from "../../view-model";
import { createTestCtx, flush, jumpCamera, prepare } from "../ctx";
import { cloneGraph, entry, mergeGraph, testConfig, testLayout } from "../helpers";

vi.mock("../../layout/worker-source", () => ({
  workerUrl: vi.fn(async () => {
    throw new Error("no text import here");
  }),
  revokeWorkerUrl: vi.fn()
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A node of the wire graphs below. */
const node = {
  flow: "m",
  node: "a",
  rest: false,
  over: false,
  checkpoint: false,
  barrier: false,
  outcomes: []
};

/** The position "home". */
const HOME = { path: "home", waiting: [] };

/**
 * A one-flow wire graph with some nodes and extra top-level fields.
 */
function graph(nodes: unknown, extra: Record<string, unknown> = {}) {
  return { main: "m", flows: { m: { start: "a", nodes, edges: {} } }, slots: {}, ...extra };
}

/** Panel values with the merge graph and the given position and history. */
function valuesOf(position: unknown, history: unknown): FlowValues {
  return { graph: cloneGraph(), position, history } as unknown as FlowValues;
}

describe("wire parsing edge cases", () => {
  it("rejects malformed nodes, optional fields, flows, edges and slots", () => {
    expect(parseGraph(graph({ a: { ...node, rest: "no" } }))).toEqual({ field: "flows.m.nodes.a" });
    expect(parseGraph(graph({ a: { ...node, scene: 3 } }))).toEqual({ field: "flows.m.nodes.a" });
    expect(parseGraph(graph({ a: null }))).toEqual({ field: "flows.m.nodes.a" });
    expect(parseGraph(graph({ a: node }, { slots: [] }))).toEqual({ field: "slots" });
    expect(parseGraph(graph({ a: node }, { slots: { s: {} } }))).toEqual({ field: "slots.s" });
    expect(
      parseGraph({ main: "m", flows: { m: { start: 1, nodes: {}, edges: {} } }, slots: {} })
    ).toEqual({ field: "flows.m" });
    expect(
      parseGraph({ main: "m", flows: { m: { start: "a", nodes: [], edges: {} } }, slots: {} })
    ).toEqual({ field: "flows.m" });
    expect(
      parseGraph({
        main: "m",
        flows: { m: { start: "a", nodes: {}, edges: { a: [] } } },
        slots: {}
      })
    ).toEqual({
      field: "flows.m.edges.a"
    });
  });

  it("reads positions and history entries strictly; payloads keep JSON only", () => {
    expect(parsePosition({ path: "a", flow: 1, waiting: [] })).toBeUndefined();
    expect(parsePosition({ path: "a", node: false, waiting: [] })).toBeUndefined();
    expect(parsePosition(null)).toBeUndefined();
    const base = { index: 1, path: "a", outcome: "b", payload: null, next: "c", now: 1, hash: "h" };
    expect(parseHistory([{ ...base, path: 1 }])).toBeUndefined();
    expect(parseHistory([{ ...base, next: 1 }])).toBeUndefined();
    expect(parseHistory([{ ...base, frame: "1" }])).toBeUndefined();
    expect(parseHistory([null])).toBeUndefined();
    const parsed = parseHistory([
      { ...base, payload: { list: [1, Number.NaN, "x", true, { deep: undefined }] } }
    ]);
    expect(parsed?.[0]?.payload).toEqual({ list: [1, null, "x", true, { deep: null }] });
  });

  it("ingest warns about an invalid position and history and keeps the last ones", () => {
    jumpCamera();
    const { ctx } = createTestCtx();
    ingest(ctx, valuesOf({ path: "home", waiting: [] }, [entry(1, "home", "play")]));
    ingest(ctx, valuesOf({ path: 3 }, "nope"));
    expect(ctx.log.warn).toHaveBeenCalledWith("flowView: game.position is not a position", {});
    expect(ctx.log.warn).toHaveBeenCalledWith("flowView: game.history is not a history", {});
    expect(ctx.state.data.position?.path).toBe("home");
    expect(ctx.state.data.history).toHaveLength(1);
  });
});

describe("view data edge cases", () => {
  it("kind lines, frame heads of entered and slot frames, rejected stubs without a frame", async () => {
    jumpCamera();
    const { ctx } = createTestCtx();
    await prepare(ctx);
    expect(kindLine(mergeGraph, "settingsPopup/open", ["rest"])).toBe("rest");
    expect(kindLine(mergeGraph, "main/boot", ["start", "transit"])).toBe("start · transit");
    ctx.state.data.history = [entry(7, "board/merge", "rejected", { payload: { other: 1 } })];
    actionsOf(ctx).flows.expand("main/afterOrder");
    await flush(10);
    const world = worldView(ctx, actionsOf(ctx));
    expect(world?.frames.get("main/afterOrder")?.head).toContain(
      "afterOrder · slot of main/afterOrder"
    );
    expect(world?.stubs.get("main/board>stub:board/merge:rejected")?.rejected).toBe(
      "✕ rejected · #7"
    );
    expect(historyView(ctx)[0]).toMatchObject({ label: "#7", rejected: true, trail: true });

    actionsOf(ctx).flows.enter("main/board");
    await flush(10);
    const entered = worldView(ctx, actionsOf(ctx));
    expect(entered?.frames.get("#board")?.head).toBe(
      "# board · sub-flow of main/board · 10 nodes · on the stack"
    );
    expect(infoView(ctx, actionsOf(ctx), "nope/x")).toBeUndefined();
  });

  it("info rows: last visit from the history, frames of fires, rejections, resolved exits", async () => {
    jumpCamera();
    const { ctx } = createTestCtx();
    await prepare(ctx);
    ctx.state.data.history = [
      entry(1, "board/awaitIntent", "merge", { next: "board/merge", frame: 10 }),
      entry(2, "board/merge", "rejected", { frame: 11 })
    ];
    const info = infoView(ctx, actionsOf(ctx), "board/merge");
    expect(info?.lastVisit).toBe("f10");
    expect(info?.outcomes.find(row => row.outcome === "rejected")).toMatchObject({
      frame: "f11",
      rejected: "✕ f11"
    });
    const give = infoView(ctx, actionsOf(ctx), "board/giveToOrder");
    expect(give?.outcomes.find(row => row.outcome === "orderComplete")?.target).toBe(
      "exit:orderComplete → main/afterOrder"
    );
    expect(give?.lastVisit).toBe("not in the last 20 edges");
    actionsOf(ctx).flows.collapse("main/board");
    await flush(10);
    const collapsed = infoView(ctx, actionsOf(ctx), "board/giveToOrder");
    expect(collapsed?.outcomes.find(row => row.outcome === "orderComplete")?.target).toBe(
      "exit:orderComplete"
    );
  });
});

describe("focus and layout edge cases", () => {
  it("walks from the current node, queries without a layout", async () => {
    jumpCamera();
    const { ctx } = createTestCtx();
    const focus = actionsOf(ctx).focus;
    expect(focus.relatedRect()).toBeUndefined();
    expect(focus.locateCurrent()).toBeUndefined();
    focus.walk("next");
    focus.moveHighlight(1);
    focus.selectHistory(99);
    expect(focus.stack()).toEqual([]);
    expect(focus.followEdge("main/home:play")).toBe(false);
    expect(focus.back()).toBe(false);
    expect(focus.findCurrent()).toBe(false);
    await prepare(ctx);
    await flush(10);
    focus.select(undefined);
    focus.walk("next");
    expect(focus.selected()).toBe("main/board>board/tapGenerator");
  });

  it("falls back to the inline engine when the worker script does not load (one warning)", async () => {
    jumpCamera();
    const { ctx } = createTestCtx({ config: { layout: testLayout({ worker: true }) } });
    await prepare(ctx);
    expect(ctx.state.layout.result?.root).toBe("main");
    expect(ctx.log.warn).toHaveBeenCalledTimes(1);
  });

  it("relayout without a graph does nothing; expandStack of an entered flow off the stack expands nothing", async () => {
    jumpCamera();
    const { ctx } = createTestCtx();
    await actionsOf(ctx).layout.relayout();
    expect(ctx.state.layout.result).toBeUndefined();
    await prepare(ctx, "home");
    ctx.state.layout.enter.push({ flow: "settingsPopup", via: "main/settings" });
    ctx.state.layout.expanded.clear();
    actionsOf(ctx).layout.expandStack();
    expect(ctx.state.layout.expanded.size).toBe(0);
    expect(actionsOf(ctx).layout.reveal("rewardPopup/show")).toBeUndefined();
  });
});

describe("more edge paths", () => {
  it("lays out a missing root as an empty frame; a failing engine logs instead of throwing", async () => {
    const result = await composeLayout({
      graph: mergeGraph,
      root: "nope",
      expanded: new Set(),
      pins: emptyPins(),
      config: testConfig(),
      engine: createInlineEngine()
    });
    expect(result.items).toHaveLength(1);
    jumpCamera();
    const { ctx } = createTestCtx();
    ctx.state.layout.engine = {
      layout: async () => {
        throw new Error("elk crashed");
      },
      dispose: () => {}
    };
    await prepare(ctx);
    expect(ctx.state.layout.result).toBeUndefined();
    expect(ctx.log.warn).toHaveBeenCalledWith("flowView: layout failed", {
      message: "elk crashed"
    });
  });

  it("records no live frame while the link is silent; focusFrame without a graph says frames are not recorded", () => {
    jumpCamera();
    const { ctx, fakes } = createTestCtx();
    ingest(ctx, valuesOf(HOME, [entry(1, "home", "play")]));
    fakes.status = { kind: "silent", since: 1, lastFrame: 9 };
    ingest(ctx, valuesOf(HOME, [entry(1, "home", "play"), entry(2, "home", "play")]));
    expect(ctx.state.focus.frames.size).toBe(0);
    ctx.state.data.graph = undefined;
    ctx.state.data.history = [entry(3, "home", "play", { frame: 4 })];
    expect(actionsOf(ctx).focus.focusFrame(4)).toBe(false);
  });

  it("a lazy engine whose creation failed disposes quietly", async () => {
    const { createLazyEngine } = await import("../../layout/engine");
    const lazy = createLazyEngine(async () => {
      throw new Error("no worker");
    });
    await expect(lazy.layout({ id: "root" })).rejects.toThrow("no worker");
    expect(() => lazy.dispose()).not.toThrow();
    await flush(2);
  });
});

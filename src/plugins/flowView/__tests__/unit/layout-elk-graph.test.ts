// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { classifyEdges } from "../../layout/back-edges";
import { ELK_OPTIONS, fromElkGraph, toElkGraph } from "../../layout/elk-graph";
import { createInlineEngine } from "../../layout/engine";
import { NODE_H, NODE_W, STUB_H, STUB_W } from "../../layout/types";
import { flowOf } from "../helpers";

const main = flowOf("main");
const classes = classifyEdges(main);

describe("toElkGraph", () => {
  const input = toElkGraph("main", main, classes);

  it("uses the layered options of the spec with seed 1", () => {
    expect(input.layoutOptions).toMatchObject({
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.spacing.nodeNodeBetweenLayers": "150",
      "elk.spacing.nodeNode": "24",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.randomSeed": "1"
    });
    expect(ELK_OPTIONS["elk.randomSeed"]).toBe("1");
  });

  it("gives every node FIXED_ORDER east ports in declared order and a west entry port", () => {
    const home = input.children?.find(child => child.id === "n:home");
    expect(home?.width).toBe(NODE_W);
    expect(home?.height).toBe(NODE_H);
    expect(home?.layoutOptions?.["elk.portConstraints"]).toBe("FIXED_ORDER");
    const east = home?.ports?.filter(port => port.layoutOptions?.["elk.port.side"] === "EAST");
    expect(east?.map(port => port.id)).toEqual([
      "p:home:play",
      "p:home:gift",
      "p:home:openSettings",
      "p:home:back"
    ]);
    expect(east?.map(port => port.layoutOptions?.["elk.port.index"])).toEqual(["0", "1", "2", "3"]);
    expect(home?.ports?.some(port => port.id === "in:home")).toBe(true);
  });

  it("turns each back edge into a 120×24 stub node fed from the source port", () => {
    const stubs = input.children?.filter(child => child.id.startsWith("s:")) ?? [];
    expect(stubs.map(stub => stub.id).toSorted()).toEqual(
      [
        "s:afterOrder:done",
        "s:board:left",
        "s:dailyGift:claim",
        "s:dailyGift:close",
        "s:leaveGame:leave",
        "s:leaveGame:stay",
        "s:loadFailed:done",
        "s:retryLoading:done",
        "s:setLoading:done",
        "s:settings:closed"
      ].toSorted()
    );
    for (const stub of stubs) {
      expect(stub.width).toBe(STUB_W);
      expect(stub.height).toBe(STUB_H);
    }
    const toStub = input.edges?.find(edge => edge.id === "e:board:left");
    expect(toStub?.sources).toEqual(["p:board:left"]);
    expect(toStub?.targets).toEqual(["s:board:left"]);
    const loop = input.edges?.find(edge => edge.id === "e:setLoading:done");
    expect(loop?.targets).toEqual(["s:setLoading:done"]);
  });

  it("sizes an expanded node from the sizes map", () => {
    const sized = toElkGraph("main", main, classes, new Map([["board", { w: 900, h: 700 }]]));
    const board = sized.children?.find(child => child.id === "n:board");
    expect(board?.width).toBe(900);
    expect(board?.height).toBe(700);
  });
});

describe("fromElkGraph", () => {
  it("maps the ELK output to items, stubs right of their source, and edges with points", async () => {
    const engine = createInlineEngine();
    const output = await engine.layout(toElkGraph("main", main, classes));
    const box = fromElkGraph("main", main, classes, output);
    const byKey = new Map(box.items.map(entry => [entry.key, entry]));
    expect(box.items.filter(entry => entry.kind === "node")).toHaveLength(11);
    const stub = byKey.get("stub:main/dailyGift:claim");
    const source = byKey.get("main/dailyGift");
    expect(stub?.kind).toBe("stub");
    expect(stub?.target).toBe("main/home");
    expect(stub?.label).toBe("↩ home");
    expect((stub?.x ?? 0) > (source?.x ?? 0)).toBe(true);
    const play = box.edges.find(edge => edge.key === "main/home:play");
    expect(play?.from).toBe("main/home");
    expect(play?.to).toBe("main/board");
    expect(play?.points.length).toBeGreaterThanOrEqual(2);
    expect(byKey.get("main/home")?.ports?.play).toBeTypeOf("number");
    expect(box.bounds.w).toBeGreaterThan(0);
    expect(box.unreached).toEqual([]);
  });

  it("is deterministic", async () => {
    const engine = createInlineEngine();
    const first = fromElkGraph(
      "settingsPopup",
      flowOf("settingsPopup"),
      classifyEdges(flowOf("settingsPopup")),
      await engine.layout(
        toElkGraph("settingsPopup", flowOf("settingsPopup"), classifyEdges(flowOf("settingsPopup")))
      )
    );
    const second = fromElkGraph(
      "settingsPopup",
      flowOf("settingsPopup"),
      classifyEdges(flowOf("settingsPopup")),
      await engine.layout(
        toElkGraph("settingsPopup", flowOf("settingsPopup"), classifyEdges(flowOf("settingsPopup")))
      )
    );
    expect(second).toEqual(first);
    const exit = first.items.find(entry => entry.key === "exit:closed");
    expect(exit?.kind).toBe("port");
    expect((exit?.x ?? 0) > first.bounds.w).toBe(true);
  });
});

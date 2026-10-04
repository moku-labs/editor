// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { classifyEdges } from "../../layout/back-edges";
import { ELK_OPTIONS, elkOptions, fromElkGraph, toElkGraph } from "../../layout/elk-graph";
import { createInlineEngine } from "../../layout/engine";
import { COL_GAP, NODE_H, NODE_SPACING, NODE_W, STUB_H, STUB_W } from "../../layout/types";
import type { Rect } from "../../types";
import { flowOf } from "../helpers";

const main = flowOf("main");

/** True when two rects share area. */
function meet(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
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

  it("sizes an expanded node from the sizes map and never shrinks it below that size", () => {
    const sized = toElkGraph("main", main, classes, {
      sizes: new Map([["board", { w: 900, h: 700 }]])
    });
    const board = sized.children?.find(child => child.id === "n:board");
    expect(board?.width).toBe(900);
    expect(board?.height).toBe(700);
    expect(board?.layoutOptions?.["elk.nodeSize.minimum"]).toBe("(900, 700)");
  });

  it("gives every edge its outcome label sized like the chip, and the label spacing options (finding 11)", () => {
    expect(input.layoutOptions).toMatchObject({
      "elk.edgeLabels.placement": "CENTER",
      "elk.spacing.edgeLabel": "4",
      "elk.spacing.labelNode": "6",
      "elk.spacing.portPort": "22",
      "elk.spacing.edgeEdge": "10",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "10"
    });
    const play = input.edges?.find(edge => edge.id === "e:home:play");
    expect(play?.labels).toEqual([
      { id: "e:home:play:l", text: "play", width: 6.6 * 4 + 12, height: 18 }
    ]);
    expect(input.edges?.every(edge => edge.labels?.length === 1)).toBe(true);
    const home = input.children?.find(child => child.id === "n:home");
    expect(home?.layoutOptions?.["elk.nodeSize.constraints"]).toBe("[PORTS, MINIMUM_SIZE]");
    expect(home?.layoutOptions?.["elk.nodeSize.minimum"]).toBe(`(${NODE_W}, ${NODE_H})`);
  });

  it("uses the density spacing instead of the base COL_GAP / NODE_SPACING", () => {
    expect(elkOptions()).toMatchObject({
      "elk.layered.spacing.nodeNodeBetweenLayers": String(COL_GAP),
      "elk.spacing.nodeNode": String(NODE_SPACING)
    });
    // The centred labels take a layer of their own, so each density gap is spent twice: half each side.
    expect(
      toElkGraph("main", main, classes, { density: "comfortable" }).layoutOptions
    ).toMatchObject({
      "elk.layered.spacing.nodeNodeBetweenLayers": "60",
      "elk.spacing.nodeNode": "20"
    });
    expect(toElkGraph("main", main, classes, { density: "compact" }).layoutOptions).toMatchObject({
      "elk.layered.spacing.nodeNodeBetweenLayers": "48",
      "elk.spacing.nodeNode": "14"
    });
  });
});

describe("ELK label placement", () => {
  it("places every edge label (labelAt) apart from the others and off the nodes", async () => {
    const settings = flowOf("settingsPopup");
    const settingsClasses = classifyEdges(settings);
    const output = await createInlineEngine().layout(
      toElkGraph("settingsPopup", settings, settingsClasses)
    );
    const box = fromElkGraph("settingsPopup", settings, settingsClasses, output);
    const labels = box.edges
      .filter(edge => edge.kind === "edge")
      .map(edge => {
        const at = edge.labelAt;
        if (at === undefined) throw new Error(`no label for ${edge.key}`);
        const w = 6.6 * edge.outcome.length + 12;
        return { key: edge.key, x: at.x - w / 2, y: at.y - 9, w, h: 18 };
      });
    expect(labels.map(label => label.key)).toContain("settingsPopup/open:close");
    for (const [index, label] of labels.entries()) {
      for (const other of labels.slice(index + 1))
        expect(meet(label, other), label.key).toBe(false);
      for (const item of box.items.filter(entry => entry.kind !== "port")) {
        expect(meet(label, item), `${label.key} on ${item.key}`).toBe(false);
      }
    }
    const open = box.items.find(entry => entry.key === "settingsPopup/open");
    expect(open?.h).toBeGreaterThan(NODE_H);
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

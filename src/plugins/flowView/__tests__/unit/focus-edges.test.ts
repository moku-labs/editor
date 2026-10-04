import { describe, expect, it } from "vitest";
import { incomingEdge, localKey, otherEnd, outgoingEdgeKey, prefixOf } from "../../focus/edges";
import type { EdgePath, Item, LayoutResult } from "../../types";
import { item } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Instance edges on a hand-made canvas: the root frame holds home, shop and
// the expanded board frame; shop goes back to home through a stub;
// inside the board, merge goes back to the hub through a stub and the hub
// leaves through the exit "left", which the board takes on to home.
// ─────────────────────────────────────────────────────────────────────────────

/** An edge of the canvas. */
function edge(key: string, from: string, to: string | undefined, outcome: string): EdgePath {
  return { key, from, to, outcome, kind: "edge", points: [], label: outcome };
}

const items: Item[] = [
  item({ key: "#main", id: "main", kind: "frame" }),
  item({ key: "main/home", id: "main/home" }),
  item({ key: "main/shop", id: "main/shop" }),
  item({
    key: "stub:main/shop:back",
    id: "main/home",
    kind: "stub",
    target: "main/home"
  }),
  item({ key: "main/board", id: "main/board", kind: "frame" }),
  item({ key: "main/board>board/hub", id: "board/hub", kind: "hub", flow: "board" }),
  item({ key: "main/board>board/merge", id: "board/merge", flow: "board" }),
  item({
    key: "main/board>stub:board/merge:done",
    id: "board/hub",
    kind: "stub",
    target: "board/hub",
    flow: "board"
  }),
  item({
    key: "main/board>stub:board/merge:lost",
    id: "board/gone",
    kind: "stub",
    target: "board/gone",
    flow: "board"
  }),
  item({ key: "main/board>exit:left", id: "board/exit:left", kind: "port", flow: "board" }),
  item({ key: "main/board>exit:nowhere", id: "board/exit:nowhere", kind: "port", flow: "board" })
];

const result: LayoutResult = {
  root: "main",
  items,
  byKey: Object.fromEntries(items.map(entry => [entry.key, entry])),
  edges: [
    edge("main/home:play", "main/home", "main/board", "play"),
    edge("main/board:left", "main/board", "main/home", "left"),
    edge("main/shop:back", "main/shop", "stub:main/shop:back", "back"),
    edge("main/board>board/hub:merge", "main/board>board/hub", "main/board>board/merge", "merge"),
    edge(
      "main/board>board/merge:done",
      "main/board>board/merge",
      "main/board>stub:board/merge:done",
      "done"
    ),
    edge(
      "main/board>board/merge:lost",
      "main/board>board/merge",
      "main/board>stub:board/merge:lost",
      "lost"
    ),
    edge("main/board>board/hub:leave", "main/board>board/hub", "main/board>exit:left", "leave"),
    edge("main/board>board/hub:quit", "main/board>board/hub", "main/board>exit:nowhere", "quit"),
    edge("main/board>board/hub:ghost", "main/board>board/hub", "main/board>nothing", "ghost"),
    edge("main/board>board/hub:open", "main/board>board/hub", undefined, "open")
  ],
  lanes: [],
  heads: [],
  bounds: { x: 0, y: 0, w: 100, h: 100 },
  frames: [],
  origins: {}
};

describe("instance keys", () => {
  it("split a key into its frame and its local part", () => {
    expect(prefixOf("main/board>board/merge")).toBe("main/board");
    expect(prefixOf("main/home")).toBe("");
    expect(localKey("main/board>board/merge:done")).toBe("board/merge:done");
    expect(localKey("main/home:play")).toBe("main/home:play");
  });
});

describe("the edge of an Info tab row", () => {
  it("an Outcomes row is the shown instance's own edge, when drawn", () => {
    expect(outgoingEdgeKey(result, "main/board>board/merge", "done")).toBe(
      "main/board>board/merge:done"
    );
    expect(outgoingEdgeKey(result, "main/board>board/merge", "nope")).toBeUndefined();
  });

  it("a Comes from row enters from its frame; a via row through the parent, else undefined", () => {
    expect(
      incomingEdge(result, "main/board>board/merge", {
        from: "board/hub",
        outcome: "merge",
        key: "board/hub:merge",
        via: undefined
      })
    ).toEqual({ edgeKey: "main/board>board/hub:merge", sourceKey: "main/board>board/hub" });
    expect(
      incomingEdge(result, "main/board>board/hub", {
        from: "main/home",
        outcome: "play",
        key: "main/home:play",
        via: "main/board"
      })
    ).toEqual({ edgeKey: "main/home:play", sourceKey: "main/home" });
    expect(
      incomingEdge(result, "board/hub", {
        from: "main/home",
        outcome: "play",
        key: "main/home:play",
        via: "main/settings"
      })
    ).toBeUndefined();
    expect(
      incomingEdge(result, "main/board>board/merge", {
        from: "board/hub",
        outcome: "tap",
        key: "board/hub:tap",
        via: undefined
      })
    ).toBeUndefined();
  });
});

describe("the other end of an edge", () => {
  it("a stub leads to its node; an exit goes on through its frame's edge", () => {
    expect(otherEnd(result, "main/board>board/merge:done", "main/board>board/merge")).toEqual({
      reached: "main/board>board/hub",
      start: "main/board>board/merge"
    });
    expect(otherEnd(result, "main/board>board/hub:leave", "main/board>board/hub")).toEqual({
      reached: "main/home",
      start: "main/board>board/hub"
    });
  });

  it("an edge entering the shown instance, or its frame, walks back to the source", () => {
    expect(otherEnd(result, "main/board>board/hub:merge", "main/board>board/merge")).toEqual({
      reached: "main/board>board/hub",
      start: "main/board>board/merge"
    });
    expect(otherEnd(result, "main/home:play", "main/board>board/hub")).toEqual({
      reached: "main/home",
      start: "main/board>board/hub"
    });
  });

  it("an edge drawn into a stub of the shown instance walks back to its source", () => {
    expect(otherEnd(result, "main/shop:back", "main/home")).toEqual({
      reached: "main/shop",
      start: "main/home"
    });
    expect(otherEnd(result, "main/board>board/merge:done", "main/board>board/hub")).toEqual({
      reached: "main/board>board/merge",
      start: "main/board>board/hub"
    });
    expect(otherEnd(result, "main/board>board/hub:leave", "main/home")).toEqual({
      reached: "main/board>board/hub",
      start: "main/home"
    });
    expect(otherEnd(result, "main/shop:back", "main/shop")).toEqual({
      reached: "main/home",
      start: "main/shop"
    });
  });

  it("is undefined for an edge or an end that is not drawn", () => {
    expect(otherEnd(result, "main/nope:x", undefined)).toBeUndefined();
    expect(
      otherEnd(result, "main/board>board/merge:lost", "main/board>board/merge")
    ).toBeUndefined();
    expect(otherEnd(result, "main/board>board/hub:quit", "main/board>board/hub")).toBeUndefined();
    expect(otherEnd(result, "main/board>board/hub:ghost", "main/board>board/hub")).toBeUndefined();
    expect(otherEnd(result, "main/board>board/hub:open", "main/board>board/hub")).toBeUndefined();
    expect(otherEnd(result, "main/board>board/hub:merge", undefined)).toEqual({
      reached: "main/board>board/merge",
      start: "main/board>board/hub"
    });
  });
});

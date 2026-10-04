// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { Density } from "../../../workspace/types";
import { composeLayout, instanceKey } from "../../layout/compose";
import { createInlineEngine } from "../../layout/engine";
import { emptyPins } from "../../layout/pins";
import type { GraphJson, Item, LayoutResult } from "../../types";
import { cloneGraph, mergeGraph, testConfig } from "../helpers";

const engine = createInlineEngine();
const config = testConfig();

/** Lays out the merge graph. */
function compose(
  options: {
    graph?: GraphJson;
    expanded?: string[];
    pins?: ReturnType<typeof emptyPins>;
    root?: string;
    density?: Density;
  } = {}
): Promise<LayoutResult> {
  return composeLayout({
    graph: options.graph ?? mergeGraph,
    root: options.root ?? "main",
    expanded: new Set(options.expanded ?? ["main/board"]),
    pins: options.pins ?? emptyPins(),
    config,
    engine,
    ...(options.density === undefined ? {} : { density: options.density })
  });
}

/** An item of a result. */
function get(result: LayoutResult, key: string): Item {
  const found = result.byKey[key];
  if (found === undefined) throw new Error(`no item ${key}`);
  return found;
}

/** True when an item lies inside a rect. */
function inside(child: Item, parent: Item): boolean {
  return (
    child.x >= parent.x &&
    child.y >= parent.y &&
    child.x + child.w <= parent.x + parent.w &&
    child.y + child.h <= parent.y + parent.h
  );
}

/** The board items of a result: key and geometry. */
function board(result: LayoutResult): (string | number)[][] {
  return result.items
    .filter(entry => entry.flow === "board")
    .map(entry => [entry.key, entry.x, entry.y, entry.w, entry.h]);
}

describe("composeLayout", () => {
  it("lays out the root frame with the board expanded in place as a hub", async () => {
    const result = await compose();
    const root = get(result, "#main");
    expect(result.root).toBe("main");
    expect(root.kind).toBe("frame");
    expect(result.bounds).toEqual({ x: root.x, y: root.y, w: root.w, h: root.h });
    const board = get(result, "main/board");
    expect(board.kind).toBe("frame");
    const hub = get(result, "main/board>board/awaitIntent");
    expect(hub.kind).toBe("hub");
    expect(hub.parent).toBe("main/board");
    expect(hub.flow).toBe("board");
    expect(inside(hub, board)).toBe(true);
    expect(inside(board, root)).toBe(true);
    expect(get(result, "main/settings").kind).toBe("node");
    expect(result.frames.map(frame => frame.key)).toEqual(["#main", "main/board"]);
    expect(result.origins["main/board|board"]).toEqual({ x: 1661, y: 138 });
    expect(result.lanes).toHaveLength(8);
    expect(result.items.filter(entry => entry.kind === "stub").length).toBeGreaterThan(14);
  });

  it("keys a twice-expanded settingsPopup by its parent instance", async () => {
    const result = await compose({
      expanded: ["main/board", "main/settings", "main/board>board/settings"]
    });
    expect(get(result, "main/settings>settingsPopup/open").flow).toBe("settingsPopup");
    expect(get(result, "main/board>board/settings>settingsPopup/open").parent).toBe(
      "main/board>board/settings"
    );
    expect(instanceKey("main/board", "board/merge")).toBe("main/board>board/merge");
    expect(instanceKey("", "main/home")).toBe("main/home");
  });

  it("lets pins override positions, moves the stubs of a pinned node and grows the frame", async () => {
    const plain = await compose();
    const pins = emptyPins();
    pins.nodes["main/dailyGift"] = { x: 1200, y: 960 };
    const pinned = await compose({ pins });
    const origin = pinned.origins["#main|main"] ?? { x: 0, y: 0 };
    const gift = get(pinned, "main/dailyGift");
    expect(gift.pinned).toBe(true);
    expect(gift.x).toBe(origin.x + 1200);
    expect(gift.y).toBe(origin.y + 960);
    const before = get(plain, "main/dailyGift");
    const stubBefore = get(plain, "stub:main/dailyGift:claim");
    const stubAfter = get(pinned, "stub:main/dailyGift:claim");
    expect(stubAfter.x - stubBefore.x).toBeCloseTo(gift.x - before.x, 6);
    expect(stubAfter.y - stubBefore.y).toBeCloseTo(gift.y - before.y, 6);
    expect(inside(gift, get(pinned, "#main"))).toBe(true);
    const giftEdge = pinned.edges.find(edge => edge.key === "main/home:gift");
    expect(giftEdge?.points.at(-1)).toEqual({ x: gift.x, y: gift.y + gift.h / 2 });
  });

  it("gives each edge an instance key like its ends: one edge per instance (finding 14)", async () => {
    const result = await compose({
      expanded: ["main/board", "main/settings", "main/board>board/settings"]
    });
    const closes = result.edges
      .filter(edge => edge.kind === "edge" && edge.outcome === "close")
      .map(edge => [edge.key, edge.from]);
    expect(closes).toContainEqual([
      "main/settings>settingsPopup/open:close",
      "main/settings>settingsPopup/open"
    ]);
    expect(closes).toContainEqual([
      "main/board>board/settings>settingsPopup/open:close",
      "main/board>board/settings>settingsPopup/open"
    ]);
    const keys = result.edges.filter(edge => edge.kind === "edge").map(edge => edge.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("main/home:play");
    for (const edge of result.edges)
      expect(edge.key.startsWith(`${edge.from}:`) || edge.kind === "return").toBe(true);
  });

  it("keeps the ELK label centres of nested flows inside their frame; a pin drops the label of a re-routed edge", async () => {
    const result = await compose({ expanded: ["main/board", "main/settings"] });
    const frame = get(result, "main/settings");
    const inner = result.edges.filter(
      edge => edge.kind === "edge" && edge.from.startsWith("main/settings>")
    );
    expect(inner.length).toBeGreaterThan(3);
    for (const edge of inner) {
      const at = edge.labelAt;
      if (at === undefined) throw new Error(`no label centre for ${edge.key}`);
      expect(at.x).toBeGreaterThan(frame.x);
      expect(at.x).toBeLessThan(frame.x + frame.w);
      expect(at.y).toBeGreaterThan(frame.y);
      expect(at.y).toBeLessThan(frame.y + frame.h);
    }
    const pins = emptyPins();
    pins.nodes["main/dailyGift"] = { x: 1200, y: 960 };
    const pinned = await compose({ pins });
    expect(pinned.edges.find(edge => edge.key === "main/home:gift")?.labelAt).toBeUndefined();
    expect(pinned.edges.find(edge => edge.key === "main/boot:ready")?.labelAt).toBeDefined();
  });

  it("spaces ELK flows by the density: compact is narrower than comfortable", async () => {
    const comfortable = await compose({ expanded: [], density: "comfortable" });
    const compact = await compose({ expanded: [], density: "compact" });
    expect(get(compact, "#main").w).toBeLessThan(get(comfortable, "#main").w);
    expect(get(compact, "#main").h).toBeLessThanOrEqual(get(comfortable, "#main").h);
  });

  it("is deterministic and ignores the key order of unrelated flows", async () => {
    const first = await compose();
    const second = await compose();
    expect(second).toEqual(first);

    const shuffled = cloneGraph();
    const flows = shuffled.flows;
    shuffled.flows = Object.fromEntries(Object.entries(flows).toReversed());
    const third = await compose({ graph: shuffled });
    expect(board(third)).toEqual(board(first));
  });

  it("uses an entered flow as the root", async () => {
    const result = await compose({ root: "board", expanded: [] });
    expect(get(result, "#board").kind).toBe("frame");
    expect(get(result, "board/awaitIntent").kind).toBe("hub");
    expect(result.items.some(entry => entry.key === "exit:left")).toBe(true);
  });
});

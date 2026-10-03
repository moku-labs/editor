// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { composeLayout, instanceKey } from "../../layout/compose";
import { createInlineEngine } from "../../layout/engine";
import { emptyPins } from "../../layout/pins";
import { NOTE_H, NOTE_W } from "../../layout/types";
import type { GraphJson, Item, LayoutResult, NoteAnchor } from "../../types";
import { cloneGraph, mergeGraph, testConfig } from "../helpers";

const engine = createInlineEngine();
const config = testConfig();

/** Lays out the merge graph. */
function compose(
  options: {
    graph?: GraphJson;
    expanded?: string[];
    pins?: ReturnType<typeof emptyPins>;
    notes?: NoteAnchor[];
    root?: string;
  } = {}
): Promise<LayoutResult> {
  return composeLayout({
    graph: options.graph ?? mergeGraph,
    root: options.root ?? "main",
    expanded: new Set(options.expanded ?? ["main/board"]),
    pins: options.pins ?? emptyPins(),
    notes: options.notes ?? [],
    config,
    engine
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

/** True when two rects overlap. */
function overlaps(a: Item, b: Item): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
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
    expect(result.origins["main/board|board"]).toEqual({ x: 1010, y: 138 });
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

  it("anchors outcome notes beside their stub, collision-free, with a dashed note edge", async () => {
    const notes: NoteAnchor[] = [
      { path: "a.md", flow: "board", from: { node: "board/merge", outcome: "done" }, title: "A" },
      { path: "b.md", flow: "board", from: { node: "board/merge", outcome: "done" }, title: "B" },
      { path: "c.md", flow: "", from: undefined, title: "Free" }
    ];
    const result = await compose({ notes });
    const stub = get(result, "main/board>stub:board/merge:done");
    const first = get(result, "note:a.md");
    const second = get(result, "note:b.md");
    expect(first.kind).toBe("note");
    expect(first.w).toBe(NOTE_W);
    expect(first.h).toBe(NOTE_H);
    expect(first.x).toBe(stub.x + stub.w + 54);
    expect(first.y).toBeGreaterThanOrEqual(stub.y + stub.h / 2 + 3);
    expect(overlaps(first, second)).toBe(false);
    for (const other of result.items) {
      if (other.kind === "frame" || other.kind === "port" || other.key === first.key) continue;
      expect(overlaps(first, other)).toBe(false);
    }
    expect(result.edges.some(edge => edge.kind === "note" && edge.to === "note:a.md")).toBe(true);
    const free = get(result, "note:c.md");
    const root = get(result, "#main");
    expect(inside(free, root)).toBe(true);
  });

  it("puts a pinned free note at its pin", async () => {
    const pins = emptyPins();
    pins.notes["c.md"] = { flow: "main", x: 48, y: 1200 };
    const result = await compose({
      notes: [{ path: "c.md", flow: "main", from: undefined, title: "Free" }],
      pins
    });
    const origin = result.origins["#main|main"] ?? { x: 0, y: 0 };
    const note = get(result, "note:c.md");
    expect(note.x).toBe(origin.x + 48);
    expect(note.y).toBe(origin.y + 1200);
    expect(note.pinned).toBe(true);
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

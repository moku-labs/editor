import { describe, expect, it } from "vitest";
import { hubGap, layoutLanes } from "../../layout/lanes";
import {
  COL_GAP,
  HUB_GAP,
  HUB_HEAD,
  HUB_W,
  LABEL_H,
  LANE_PAD,
  labelWidth,
  NODE_W,
  ROW
} from "../../layout/types";
import type { Item, Rect } from "../../types";
import { flowOf } from "../helpers";

const box = layoutLanes("board", flowOf("board"), "awaitIntent");

/** True when two rects share area. */
function meet(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
const byKey = new Map(box.items.map(entry => [entry.key, entry]));

/** An item of the box. */
function get(key: string): Item {
  const found = byKey.get(key);
  if (found === undefined) throw new Error(`no item ${key}`);
  return found;
}

describe("layoutLanes (design §7.1–7.4)", () => {
  it("draws 8 lanes in declared order under the hub head", () => {
    expect(box.lanes.map(lane => lane.outcome)).toEqual([
      "tap",
      "select",
      "merge",
      "give",
      "deliver",
      "openSettings",
      "leave",
      "elapsed"
    ]);
    expect(box.lanes[0]?.y).toBe(HUB_HEAD);
    for (let index = 1; index < box.lanes.length; index += 1) {
      const previous = box.lanes[index - 1];
      expect(box.lanes[index]?.y).toBe((previous?.y ?? 0) + (previous?.h ?? 0));
    }
  });

  it("aligns each hub port with its lane row", () => {
    const hub = get("board/awaitIntent");
    expect(hub.kind).toBe("hub");
    expect(hub.w).toBe(HUB_W);
    for (const lane of box.lanes) {
      expect(hub.ports?.[lane.outcome]).toBe(lane.y - hub.y + LANE_PAD + ROW / 2);
    }
    const last = box.lanes.at(-1);
    expect(hub.h).toBe((last?.y ?? 0) + (last?.h ?? 0) + 8);
  });

  it("puts the action node in column 1 and second-level nodes in column 2 of the same lane", () => {
    const columnOne = HUB_W + hubGap(flowOf("board").nodes.awaitIntent?.outcomes ?? []);
    const columnTwo = columnOne + NODE_W + COL_GAP;
    const tap = box.lanes[0];
    expect(get("board/tapGenerator").x).toBe(columnOne);
    expect(get("board/tapGenerator").y).toBe((tap?.y ?? 0) + LANE_PAD);
    for (const key of ["board/energy", "board/toast"]) {
      const placed = get(key);
      expect(placed.x).toBe(columnTwo);
      expect(placed.y).toBeGreaterThanOrEqual(tap?.y ?? 0);
      expect(placed.y + placed.h).toBeLessThanOrEqual((tap?.y ?? 0) + (tap?.h ?? 0));
    }
    expect(get("board/toast").y).toBeGreaterThan(get("board/energy").y);
  });

  it("ends every edge back to the hub in a return stub ↩ awaitIntent", () => {
    const stubs = box.items.filter(entry => entry.kind === "stub");
    expect(stubs.length).toBeGreaterThanOrEqual(12);
    for (const stub of stubs) {
      expect(stub.target).toBe("board/awaitIntent");
      expect(stub.label).toBe("↩ awaitIntent");
    }
    const intoHub = box.edges.filter(
      edge => edge.kind === "edge" && edge.to === "board/awaitIntent"
    );
    expect(intoHub).toEqual([]);
    expect(box.edges.some(edge => edge.kind === "return" && edge.to === "board/awaitIntent")).toBe(
      true
    );
  });

  it("runs leave and orderComplete to exit ports on the frame's right edge, in first-use order", () => {
    const ports = box.items.filter(entry => entry.kind === "port" && entry.key.startsWith("exit:"));
    expect(ports.map(port => port.key)).toEqual(["exit:orderComplete", "exit:left"]);
    for (const port of ports) expect(port.x).toBeGreaterThan(box.bounds.w);
    const leave = box.edges.find(edge => edge.key === "board/awaitIntent:leave");
    expect(leave?.to).toBe("exit:left");
    const give = box.edges.find(edge => edge.key === "board/giveToOrder:orderComplete");
    expect(give?.to).toBe("exit:orderComplete");
    expect(box.items.some(entry => entry.key === "entry")).toBe(true);
  });

  it("places column heads above lane 0", () => {
    expect(box.heads.map(head => head.label)).toEqual(["Action node", "Its outcomes → next"]);
    for (const head of box.heads) expect(head.y).toBeLessThan(HUB_HEAD);
    expect(box.unreached).toEqual([]);
  });

  it("gives an expanded sub-flow box its size and grows the lane with it", () => {
    const sizes = new Map([["settings", { w: 600, h: 300 }]]);
    const grown = layoutLanes("board", flowOf("board"), "awaitIntent", sizes);
    const settings = grown.items.find(entry => entry.key === "board/settings");
    expect(settings?.w).toBe(600);
    expect(settings?.h).toBe(300);
    const lane = grown.lanes.find(entry => entry.outcome === "openSettings");
    expect(lane?.h).toBe(300 + 2 * LANE_PAD);
  });

  it("widens the gap after the hub so its widest outcome label fits (openSettings: 91.2 px + 2 × 4)", () => {
    expect(hubGap(["tap", "merge"])).toBe(HUB_GAP);
    expect(hubGap(["tap", "openSettings"])).toBeCloseTo(labelWidth("openSettings") + 8, 6);
  });

  it("places every edge label right of its source and clear of the other labels and items (finding 11)", () => {
    const byKey = new Map(box.items.map(entry => [entry.key, entry]));
    const labels = box.edges
      .filter(edge => edge.kind === "edge" && edge.label !== undefined)
      .map(edge => {
        const at = edge.labelAt;
        if (at === undefined) throw new Error(`no label for ${edge.key}`);
        const w = labelWidth(edge.label ?? "");
        return { edge, rect: { x: at.x - w / 2, y: at.y - LABEL_H / 2, w, h: LABEL_H } };
      });
    expect(labels.length).toBeGreaterThan(20);
    for (const [index, { edge, rect }] of labels.entries()) {
      const source = byKey.get(edge.from);
      expect(rect.x, edge.key).toBeGreaterThanOrEqual((source?.x ?? 0) + (source?.w ?? 0));
      for (const other of labels.slice(index + 1))
        expect(meet(rect, other.rect), edge.key).toBe(false);
      for (const entry of box.items.filter(item => item.kind !== "port")) {
        expect(meet(rect, entry), `${edge.key} on ${entry.key}`).toBe(false);
      }
    }
  });
});

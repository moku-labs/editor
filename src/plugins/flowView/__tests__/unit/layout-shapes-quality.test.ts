// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { classifyEdges } from "../../layout/back-edges";
import { composeLayout } from "../../layout/compose";
import { createInlineEngine } from "../../layout/engine";
import { emptyPins } from "../../layout/pins";
import { LABEL_H, labelWidth } from "../../layout/types";
import { labelPoint } from "../../render/Edges";
import type { EdgePath, Item, LayoutResult, Rect } from "../../types";
import { graphShapes } from "../fixtures/graphs";
import { testConfig } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Layout quality on every graph shape (finding 16): nothing overlaps, every
// node is placed, bounds are finite, forward edges read left to right, labels
// stay inside the world, and (PERF=1 only) a layout stays under twice the perf
// budget.
// ─────────────────────────────────────────────────────────────────────────────

/** Twice the ELK budget of layout-perf.test.ts (450 ms p95, CI factor 3). */
const BUDGET_MS = 2 * 450;

/** Wall-clock budgets run only on request (`PERF=1 bun run test:unit`): a shared runner is noisy. */
const isPerfRun = process.env.PERF === "1";

/** Item kinds that take room on the canvas next to their siblings. */
const BOXES: ReadonlySet<Item["kind"]> = new Set(["node", "hub", "frame", "stub"]);

/** Item kinds a label must not cover. */
const SOLID: ReadonlySet<Item["kind"]> = new Set(["node", "hub", "stub"]);

/** True when two rects share area (touching edges do not). */
function meet(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** True when a rect lies inside another. */
function within(child: Rect, parent: Rect): boolean {
  return (
    child.x >= parent.x &&
    child.y >= parent.y &&
    child.x + child.w <= parent.x + parent.w &&
    child.y + child.h <= parent.y + parent.h
  );
}

/** The box of an edge's label chip where the canvas draws it. */
function labelBox(edge: EdgePath): Rect | undefined {
  const at = labelPoint(edge);
  if (at === undefined || edge.label === undefined) return undefined;
  const w = labelWidth(edge.label);
  return { x: at.x - w / 2, y: at.y - LABEL_H / 2, w, h: LABEL_H };
}

/** The local edge key of an instance edge ("main/board>board/merge:done" → "merge:done"). */
function flowEdge(edge: EdgePath): string {
  const local = edge.key.slice(edge.key.lastIndexOf(">") + 1);
  return local.slice(local.indexOf("/") + 1);
}

const engine = createInlineEngine();

/** Lays out a shape with the inline ELK engine and times it. */
async function layout(
  shape: ReturnType<typeof graphShapes>[number]
): Promise<{ readonly result: LayoutResult; readonly ms: number }> {
  const start = performance.now();
  const result = await composeLayout({
    graph: shape.graph,
    root: "main",
    expanded: new Set(shape.expanded),
    pins: emptyPins(),
    config: testConfig(),
    engine,
    density: "comfortable"
  });
  return { result, ms: performance.now() - start };
}

describe.each(
  graphShapes().map(shape => [shape.name, shape] as const)
)("layout quality: %s", (_name, shape) => {
  it.skipIf(!isPerfRun)("lays out within twice the perf budget (PERF=1)", async () => {
    const { ms } = await layout(shape);
    expect(ms).toBeLessThanOrEqual(BUDGET_MS);
  });

  it("places every node of every shown flow, inside its frame, with finite bounds", async () => {
    const { result } = await layout(shape);
    for (const value of Object.values(result.bounds)) expect(Number.isFinite(value)).toBe(true);
    expect(result.bounds.w).toBeGreaterThan(0);
    expect(result.bounds.h).toBeGreaterThan(0);

    // Every node of the root flow and of each expanded frame's flow has its instance.
    const shown = [{ prefix: "", flow: "main" }];
    for (const frame of result.frames.filter(entry => !entry.key.startsWith("#"))) {
      const opened = shape.graph.flows[frame.flow]?.nodes[frame.id.slice(frame.flow.length + 1)];
      if (opened?.subFlow !== undefined) shown.push({ prefix: frame.key, flow: opened.subFlow });
    }
    for (const { prefix, flow } of shown) {
      for (const name of Object.keys(shape.graph.flows[flow]?.nodes ?? {})) {
        const key = prefix === "" ? `${flow}/${name}` : `${prefix}>${flow}/${name}`;
        expect(result.byKey[key], key).toBeDefined();
      }
    }

    // Every item sits inside its parent frame.
    for (const item of result.items.filter(entry => entry.parent !== undefined)) {
      const parent = result.byKey[item.parent ?? ""];
      if (parent === undefined || item.kind === "port") continue;
      expect(within(item, parent), `${item.key} in ${parent.key}`).toBe(true);
    }
  });

  it("overlaps no node with a sibling, no label with another label or a node", async () => {
    const { result } = await layout(shape);
    const boxes = result.items.filter(entry => BOXES.has(entry.kind) && !entry.key.startsWith("#"));
    for (const [index, item] of boxes.entries()) {
      for (const other of boxes.slice(index + 1)) {
        if (other.parent !== item.parent) continue;
        expect(meet(item, other), `${item.key} / ${other.key}`).toBe(false);
      }
    }

    const labels = result.edges.flatMap(edge => {
      const box = edge.kind === "edge" ? labelBox(edge) : undefined;
      return box === undefined ? [] : [{ edge, box }];
    });
    const solids = result.items.filter(entry => SOLID.has(entry.kind));
    for (const [index, { edge, box }] of labels.entries()) {
      for (const other of labels.slice(index + 1)) {
        expect(meet(box, other.box), `${edge.key} / ${other.edge.key}`).toBe(false);
      }
      for (const item of solids) expect(meet(box, item), `${edge.key} on ${item.key}`).toBe(false);
      expect(within(box, result.bounds), `${edge.key} inside the world`).toBe(true);
    }
  });

  it("reads left to right: every forward edge between two nodes of a frame leaves to the right", async () => {
    const { result } = await layout(shape);
    for (const edge of result.edges.filter(entry => entry.kind === "edge")) {
      const from = result.byKey[edge.from];
      const to = edge.to === undefined ? undefined : result.byKey[edge.to];
      if (from === undefined || to === undefined || to.parent !== from.parent) continue;
      if (!BOXES.has(to.kind) || to.kind === "stub") continue;
      const flow = shape.graph.flows[from.flow];
      const forward = flow === undefined || classifyEdges(flow).get(flowEdge(edge)) === "forward";
      if (!forward) continue;
      expect(to.x, `${edge.key}`).toBeGreaterThan(from.x);
    }
  });
});

// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { actionsOf } from "../../actions";
import { ingest } from "../../data";
import type { FlowValues } from "../../types";
import { createTestCtx, flush, jumpCamera } from "../ctx";
import { cloneGraph, entry } from "../helpers";

beforeEach(() => {
  jumpCamera();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The panel values of a render. */
function values(overrides: Partial<Record<keyof FlowValues, unknown>> = {}): FlowValues {
  const base = {
    graph: cloneGraph(),
    position: { path: "board/awaitIntent", flow: "board", node: "awaitIntent", waiting: ["tap"] },
    history: [entry(1, "home", "play")]
  };
  return { ...base, ...overrides } as unknown as FlowValues;
}

describe("ingest", () => {
  it("takes the first values: graph, hash, the stack expanded, a layout and the Nodes palette", async () => {
    const { ctx, fakes } = createTestCtx();
    ingest(ctx, values());
    expect(ctx.state.data.graph?.main).toBe("main");
    expect(ctx.state.data.graphHash).toMatch(/^[\da-f]{8}$/);
    expect(ctx.state.data.position?.path).toBe("board/awaitIntent");
    expect(ctx.state.layout.expanded).toEqual(new Set(["main/board"]));
    await flush(10);
    expect(ctx.state.layout.result?.byKey["main/board>board/awaitIntent"]?.kind).toBe("hub");
    const nodes = fakes.palette.flat().filter(item => item.group === "Nodes");
    expect(nodes.length).toBe(28);
    expect(nodes[0]).toMatchObject({ label: "main/boot", mono: true });
  });

  it("relayouts only when the graph changed", async () => {
    const { ctx, fakes } = createTestCtx();
    ingest(ctx, values());
    await flush(10);
    const result = ctx.state.layout.result;
    const groups = fakes.palette.length;
    ingest(ctx, values());
    await flush(5);
    expect(ctx.state.layout.result).toBe(result);
    expect(fakes.palette.length).toBe(groups);
  });

  it("keeps the last valid graph and warns about an invalid one", async () => {
    const { ctx } = createTestCtx();
    ingest(ctx, values());
    ingest(ctx, values({ graph: { main: 1 } }));
    expect(ctx.log.warn).toHaveBeenCalledWith("flowView: game.graph is not a flow graph", {
      field: "main"
    });
    expect(ctx.state.data.graph?.main).toBe("main");
  });

  it("follows the current node when Follow is on", async () => {
    const { ctx } = createTestCtx();
    ingest(ctx, values());
    await flush(10);
    ctx.state.camera.viewport = { w: 1200, h: 800 };
    actionsOf(ctx).camera.follow(true);
    const before = actionsOf(ctx).camera.get();
    ingest(
      ctx,
      values({ position: { path: "home", flow: "main", node: "home", waiting: ["play"] } })
    );
    expect(actionsOf(ctx).camera.get()).not.toEqual(before);
    expect(actionsOf(ctx).focus.current()).toBe("main/home");
  });

  it("records the frame of entries that arrive live, never of the first batch or of F-H1 entries", () => {
    const { ctx, fakes } = createTestCtx();
    fakes.status = { kind: "live", frame: 1900 };
    ingest(ctx, values());
    expect(ctx.state.focus.frames.size).toBe(0);
    ingest(
      ctx,
      values({ history: [entry(1, "home", "play"), entry(2, "board/awaitIntent", "merge")] })
    );
    expect(ctx.state.focus.frames.get(2)).toBe(1900);
    ingest(
      ctx,
      values({
        history: [
          entry(1, "home", "play"),
          entry(2, "board/awaitIntent", "merge"),
          entry(3, "board/merge", "done", { frame: 1950 })
        ]
      })
    );
    expect(ctx.state.focus.frames.has(3)).toBe(false);
    expect(ctx.state.data.history).toHaveLength(3);
  });

  it("keeps at most historyLast entries", () => {
    const { ctx } = createTestCtx({ config: { historyLast: 2 } });
    ingest(
      ctx,
      values({
        history: [entry(1, "home", "play"), entry(2, "home", "play"), entry(3, "home", "play")]
      })
    );
    expect(ctx.state.data.history.map(item => item.index)).toEqual([2, 3]);
  });
});

// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startFlowView, stopFlowView } from "../../lifecycle";
import { createTestCtx, flush, jumpCamera, type TestCtx } from "../ctx";
import { cloneGraph, entry } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The session watches (R6): flowView watches game.graph, game.position and
// game.history from start, whatever workspace shows, and takes the values in
// once all three arrived; later values go in one by one.
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jumpCamera();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Delivers the three first values of the merge game. */
function sendData(test: TestCtx, history = [entry(1, "board/merge", "rejected")]): void {
  test.fakes.send("game.graph", structuredClone(cloneGraph()));
  test.fakes.send("game.position", { path: "board/awaitIntent", waiting: ["tap"] });
  test.fakes.send("game.history", history);
}

describe("the session watches", () => {
  it("watch the three flow sources on start, whatever workspace shows", () => {
    const test = createTestCtx();
    startFlowView(test.ctx);
    expect(test.fakes.watches.map(watch => [watch.id, watch.input])).toEqual([
      ["game.graph", undefined],
      ["game.position", undefined],
      ["game.history", { last: 20 }]
    ]);
  });

  it("take the values in once all three arrived: graph, position, history, Nodes and a layout", async () => {
    const test = createTestCtx();
    const { ctx, fakes } = test;
    startFlowView(ctx);
    fakes.send("game.graph", structuredClone(cloneGraph()));
    fakes.send("game.position", { path: "board/awaitIntent", waiting: ["tap"] });
    expect(ctx.state.data.graph).toBeUndefined();
    expect(fakes.palette.flat().some(item => item.group === "Nodes")).toBe(false);

    fakes.send("game.history", [entry(1, "board/merge", "rejected")]);
    expect(ctx.state.data.graph?.main).toBe("main");
    expect(ctx.state.data.position?.path).toBe("board/awaitIntent");
    expect(ctx.state.data.history.map(item => item.index)).toEqual([1]);
    expect(fakes.palette.flat().some(item => item.label === "board/merge")).toBe(true);
    await flush(10);
    expect(ctx.state.layout.result?.byKey["main/board>board/merge"]).toBeDefined();
  });

  it("date the entries of a later history value with the link frame (the first value is the baseline)", () => {
    const test = createTestCtx();
    const { ctx, fakes } = test;
    startFlowView(ctx);
    sendData(test, [entry(1, "home", "play")]);
    expect(ctx.state.focus.frames.size).toBe(0);

    fakes.status = { kind: "live", frame: 1900 };
    fakes.send("game.history", [entry(1, "home", "play"), entry(2, "board/merge", "rejected")]);
    expect(ctx.state.focus.frames.get(2)).toBe(1900);
    expect(ctx.state.data.history.map(item => item.index)).toEqual([1, 2]);
  });

  it("stop with the plugin", async () => {
    const test = createTestCtx();
    startFlowView(test.ctx);
    await stopFlowView(test.ctx);
    expect(test.fakes.watches.every(watch => !watch.active)).toBe(true);
  });
});

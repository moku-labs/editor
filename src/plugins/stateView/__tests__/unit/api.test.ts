import { beforeEach, describe, expect, it } from "vitest";
import { createStateViewApi } from "../../api";
import { acceptModel, acceptTainted } from "../../tracker";
import type { StateViewApi } from "../../types";
import { GRAPH, MODEL_AFTER, MODEL_BEFORE } from "../fixtures";
import { createCtx, type TestCtx } from "../helpers";

let ctx: TestCtx;
let api: StateViewApi;

beforeEach(() => {
  ctx = createCtx();
  api = createStateViewApi(ctx);
});

describe("stateView api", () => {
  it("lastCommit and note follow the tracker", () => {
    expect(api.lastCommit()).toBeUndefined();
    expect(api.note()).toBe("none");
    acceptModel(ctx, MODEL_BEFORE);
    expect(api.note()).toBe("waiting");
    acceptModel(ctx, MODEL_AFTER);
    expect(api.lastCommit()?.patches.length).toBe(4);
  });

  it("onCommit calls back on every change; its unsubscribe is idempotent", () => {
    let calls = 0;
    const off = api.onCommit(() => {
      calls += 1;
    });
    acceptModel(ctx, MODEL_BEFORE);
    acceptTainted(ctx, true);
    expect(calls).toBe(2);
    off();
    off();
    acceptTainted(ctx, false);
    expect(calls).toBe(2);
    expect(ctx.state.listeners.size).toBe(0);
  });

  it("tainted and graph read the cached values", () => {
    expect(api.tainted()).toBeUndefined();
    expect(api.graph()).toBeUndefined();
    ctx.state.tainted = false;
    ctx.state.graph = GRAPH;
    expect(api.tainted()).toBe(false);
    expect(api.graph()).toEqual(GRAPH);
  });

  it("expanded defaults by depth, an override wins", () => {
    expect(api.expanded("/player", 0)).toBe(true);
    expect(api.expanded("/player/merge", 1)).toBe(true);
    expect(api.expanded("/player/merge/board", 2)).toBe(false);
    api.setExpanded("/player/merge/board", true);
    api.setExpanded("/player/merge", false);
    expect(api.expanded("/player/merge/board", 2)).toBe(true);
    expect(api.expanded("/player/merge", 1)).toBe(false);
  });

  it("setExpanded notifies", () => {
    let calls = 0;
    api.onCommit(() => {
      calls += 1;
    });
    api.setExpanded("/session", false);
    expect(calls).toBe(1);
  });

  it("expandAll covers every container pointer under the root of the baseline", () => {
    acceptModel(ctx, MODEL_BEFORE);
    let calls = 0;
    api.onCommit(() => {
      calls += 1;
    });
    api.expandAll("player", false);
    expect(calls).toBe(1);
    for (const pointer of [
      "/player",
      "/player/merge",
      "/player/merge/board/items",
      "/player/claimed"
    ]) {
      expect(api.expanded(pointer, 0)).toBe(false);
    }
    expect(ctx.state.expanded.has("/player/merge/nextItemId")).toBe(false);
    expect(ctx.state.expanded.has("/session")).toBe(false);
    api.expandAll("player", true);
    expect(api.expanded("/player/merge/generators/sawmill", 3)).toBe(true);
  });

  it("expandAll without a baseline only notifies", () => {
    api.expandAll("session", true);
    expect(ctx.state.expanded.size).toBe(0);
  });
});

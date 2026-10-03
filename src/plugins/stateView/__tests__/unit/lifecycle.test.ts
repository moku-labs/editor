import { beforeEach, describe, expect, it } from "vitest";
import { registerStatePanel, startStateView, stopStateView } from "../../lifecycle";
import { MANIFEST, MODEL_AFTER, MODEL_BEFORE } from "../fixtures";
import { createCtx, flush, type TestCtx } from "../helpers";

let ctx: TestCtx;

beforeEach(() => {
  ctx = createCtx();
});

describe("stateView lifecycle", () => {
  it("onInit registers the State panel with its three sources", () => {
    registerStatePanel(ctx);
    expect(ctx.registered).toHaveLength(1);
    const [panel] = ctx.registered;
    expect(panel).toMatchObject({ id: "state", title: "State", workspace: "state" });
    expect(panel?.sources).toEqual({
      model: "game.model",
      position: "game.position",
      history: ["game.history", { last: 1 }]
    });
  });

  it("onStart listens for manifests and watches game.model and game.tainted", () => {
    startStateView(ctx);
    expect(ctx.link.manifestListener).toBeDefined();
    expect(ctx.link.watch.mock.calls.map(call => [call[0], call[1]])).toEqual([
      ["game.model", undefined],
      ["game.tainted", undefined]
    ]);
  });

  it("routes watched values into the tracker and never reads game.model or game.tainted", async () => {
    ctx.link.manifest = MANIFEST;
    ctx.link.values.set("game.graph", { main: "main", flows: {} });
    startStateView(ctx);
    ctx.link.watchers.get("game.model")?.(MODEL_BEFORE);
    ctx.link.watchers.get("game.model")?.(MODEL_AFTER);
    ctx.link.watchers.get("game.tainted")?.(true);
    await flush();
    expect(ctx.state.last?.seq).toBe(1);
    expect(ctx.state.tainted).toBe(true);
    expect(ctx.state.graph).toEqual({ main: "main", flows: {} });
    const reads = ctx.link.read.mock.calls.map(call => call[0]);
    expect(reads).toEqual(["game.graph"]);
  });

  it("onStop drops both watches, the manifest listener and every UI listener", () => {
    startStateView(ctx);
    ctx.state.listeners.add(() => undefined);
    stopStateView(ctx);
    expect(ctx.link.unwatch.get("game.model")).toHaveBeenCalledTimes(1);
    expect(ctx.link.unwatch.get("game.tainted")).toHaveBeenCalledTimes(1);
    expect(ctx.link.stopManifest).toHaveBeenCalledTimes(1);
    expect(ctx.state.listeners.size).toBe(0);
    stopStateView(ctx);
    expect(ctx.link.unwatch.get("game.model")).toHaveBeenCalledTimes(1);
  });

  it("onStop before onStart is safe", () => {
    expect(() => stopStateView({ state: ctx.state })).not.toThrow();
  });
});

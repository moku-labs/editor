import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptManifest,
  acceptModel,
  acceptTainted,
  loadGraph,
  notify,
  resetTracker
} from "../../tracker";
import {
  GRAPH,
  MANIFEST,
  MODEL_AFTER,
  MODEL_BEFORE,
  playerBefore,
  SESSION_STATE
} from "../fixtures";
import { createCtx, flush, type TestCtx } from "../helpers";

let ctx: TestCtx;
let calls: number;

beforeEach(() => {
  ctx = createCtx();
  calls = 0;
  ctx.state.listeners.add(() => {
    calls += 1;
  });
  vi.spyOn(Date, "now").mockReturnValue(5000);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("acceptModel", () => {
  it("takes the first value as a baseline, never as a commit", () => {
    acceptModel(ctx, MODEL_BEFORE);
    expect(ctx.state.last).toBeUndefined();
    expect(ctx.state.baseline).toEqual(MODEL_BEFORE);
    expect(ctx.state.note).toBe("waiting");
    expect(ctx.state.session).toBe("s-1");
    expect(calls).toBe(1);
  });

  it("derives a commit from the second value with seq 1 and the heartbeat frame", () => {
    acceptModel(ctx, MODEL_BEFORE);
    acceptModel(ctx, MODEL_AFTER);
    const last = ctx.state.last;
    expect(last).toMatchObject({ seq: 1, frame: 1503, at: 5000, truncated: 0, rngChanged: false });
    expect(last?.patches).toHaveLength(4);
    expect(last?.changed.has("/player/merge/energy/value")).toBe(true);
    expect(last?.ancestors.has("/player/merge")).toBe(true);
    expect(last?.ancestors.has("/player/merge/energy/value")).toBe(false);
    expect(ctx.state.baseline).toEqual(MODEL_AFTER);
    expect(ctx.state.seq).toBe(1);
    expect(calls).toBe(2);
  });

  it("ignores an identical value (a resubscribe re-sends the snapshot)", () => {
    acceptModel(ctx, MODEL_BEFORE);
    acceptModel(ctx, MODEL_AFTER);
    acceptModel(ctx, MODEL_AFTER);
    expect(ctx.state.seq).toBe(1);
    expect(calls).toBe(2);
  });

  it("counts an rng-only change as a commit without patches", () => {
    acceptModel(ctx, MODEL_BEFORE);
    acceptModel(ctx, {
      player: playerBefore(),
      session: SESSION_STATE,
      rng: { seed: 43, streams: {} }
    });
    expect(ctx.state.last).toMatchObject({ seq: 1, patches: [], rngChanged: true });
  });

  it("keeps at most maxPatches and counts the rest", () => {
    ctx = createCtx({ maxPatches: 1 });
    acceptModel(ctx, MODEL_BEFORE);
    acceptModel(ctx, MODEL_AFTER);
    expect(ctx.state.last?.patches).toHaveLength(1);
    expect(ctx.state.last?.truncated).toBe(3);
    expect(ctx.state.last?.changed.size).toBe(1);
  });

  it("resets the baseline silently when the session changed", () => {
    acceptModel(ctx, MODEL_BEFORE);
    acceptModel(ctx, MODEL_AFTER);
    ctx.link.session = "s-2";
    acceptModel(ctx, MODEL_BEFORE);
    expect(ctx.state.last).toBeUndefined();
    expect(ctx.state.baseline).toEqual(MODEL_BEFORE);
    expect(ctx.state.session).toBe("s-2");
    expect(ctx.state.note).toBe("waiting");
  });

  it("takes the frame from the link status when the value arrives", () => {
    ctx.link.status = { kind: "connecting" };
    acceptModel(ctx, MODEL_BEFORE);
    acceptModel(ctx, MODEL_AFTER);
    expect(ctx.state.last?.frame).toBeUndefined();
  });

  it("warns on a value that is no model snapshot and keeps the state", () => {
    acceptModel(ctx, [1, 2]);
    expect(ctx.logMock.warn).toHaveBeenCalledWith("stateView:unexpected-model", { type: "object" });
    acceptModel(ctx, "x");
    expect(ctx.logMock.warn).toHaveBeenLastCalledWith("stateView:unexpected-model", {
      type: "string"
    });
    expect(ctx.state.baseline).toBeUndefined();
    expect(calls).toBe(0);
  });
});

describe("resetTracker", () => {
  it("clears baseline, commit and taint, sets the note and notifies", () => {
    acceptModel(ctx, MODEL_BEFORE);
    acceptModel(ctx, MODEL_AFTER);
    ctx.state.tainted = true;
    resetTracker(ctx, "reloaded");
    expect(ctx.state).toMatchObject({
      baseline: undefined,
      last: undefined,
      note: "reloaded",
      tainted: undefined
    });
    expect(calls).toBe(3);
  });

  it("sets waiting as the note on a new session", () => {
    resetTracker(ctx, "waiting");
    expect(ctx.state.note).toBe("waiting");
  });
});

describe("acceptTainted", () => {
  it("stores a boolean and notifies only when it changed", () => {
    acceptTainted(ctx, false);
    acceptTainted(ctx, false);
    acceptTainted(ctx, true);
    expect(ctx.state.tainted).toBe(true);
    expect(calls).toBe(2);
  });

  it("warns on anything else and keeps the value", () => {
    acceptTainted(ctx, true);
    acceptTainted(ctx, "yes");
    expect(ctx.state.tainted).toBe(true);
    expect(ctx.logMock.warn).toHaveBeenCalledWith("stateView:unexpected-tainted", {
      type: "string"
    });
  });
});

describe("loadGraph", () => {
  it("reads game.graph once and notifies", async () => {
    ctx.link.values.set("game.graph", GRAPH);
    ctx.state.session = "s-1";
    await loadGraph(ctx);
    expect(ctx.state.graph).toEqual(GRAPH);
    expect(ctx.link.read).toHaveBeenCalledWith("game.graph");
    expect(calls).toBe(1);
  });

  it("keeps undefined and logs debug when the read fails", async () => {
    ctx.state.graph = GRAPH;
    ctx.link.values.set("game.graph", new Error("[moku-editor] Unknown source game.graph."));
    await loadGraph(ctx);
    expect(ctx.state.graph).toBeUndefined();
    expect(ctx.logMock.debug).toHaveBeenCalledWith("stateView:graph-unavailable", {
      message: "[moku-editor] Unknown source game.graph."
    });
  });

  it("drops a graph that arrives after the session changed", async () => {
    ctx.link.values.set("game.graph", GRAPH);
    ctx.state.session = "s-1";
    const pending = loadGraph(ctx);
    ctx.state.session = "s-2";
    await pending;
    expect(ctx.state.graph).toBeUndefined();
  });
});

describe("acceptManifest", () => {
  it("does nothing without a manifest", () => {
    acceptManifest(ctx, undefined);
    expect(ctx.link.read).not.toHaveBeenCalled();
    expect(calls).toBe(0);
  });

  it("resets on a manifest of another session and reads the graph", async () => {
    ctx.link.values.set("game.graph", GRAPH);
    acceptModel(ctx, MODEL_BEFORE);
    ctx.state.session = "s-0";
    acceptManifest(ctx, MANIFEST);
    expect(ctx.state.note).toBe("waiting");
    expect(ctx.state.baseline).toBeUndefined();
    expect(ctx.state.session).toBe("s-1");
    await flush();
    expect(ctx.state.graph).toEqual(GRAPH);
  });

  it("keeps the baseline on a manifest of the same session", async () => {
    ctx.link.values.set("game.graph", GRAPH);
    acceptModel(ctx, MODEL_BEFORE);
    acceptManifest(ctx, MANIFEST);
    expect(ctx.state.baseline).toEqual(MODEL_BEFORE);
    await flush();
    expect(ctx.link.read).toHaveBeenCalledTimes(1);
  });
});

describe("notify", () => {
  it("calls every listener, also when one removes itself", () => {
    const seen: string[] = [];
    const first = (): void => {
      seen.push("first");
      ctx.state.listeners.delete(first);
    };
    ctx.state.listeners.clear();
    ctx.state.listeners.add(first);
    ctx.state.listeners.add(() => seen.push("second"));
    notify(ctx.state);
    expect(seen).toEqual(["first", "second"]);
  });
});

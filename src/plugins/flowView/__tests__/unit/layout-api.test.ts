// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { actionsOf } from "../../actions";
import { createInlineEngine } from "../../layout/engine";
import { parsePins } from "../../layout/pins";
import type { LayoutEngine } from "../../layout/types";
import { createTestCtx, flush, jumpCamera, prepare } from "../ctx";
import { testLayout } from "../helpers";

const LAYOUT = ".moku/editor/layout.json";

/** Does nothing. */
const noop = (): void => {};

beforeEach(() => {
  jumpCamera();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("relayout", () => {
  it("lays out the graph with the stack expanded", async () => {
    const { ctx } = createTestCtx();
    await prepare(ctx);
    expect(ctx.state.layout.expanded).toEqual(new Set(["main/board"]));
    expect(ctx.state.layout.result?.root).toBe("main");
    expect(ctx.state.layout.result?.byKey["main/board"]?.kind).toBe("frame");
    expect(ctx.state.view.revision).toBeGreaterThan(0);
  });

  it("drops a stale result and serves repeats from the cache", async () => {
    const { ctx } = createTestCtx();
    const inline = createInlineEngine();
    let release: () => void = noop;
    let hold = false;
    const calls = vi.fn();
    const engine: LayoutEngine = {
      async layout(input) {
        calls();
        if (hold) await new Promise<void>(resolve => (release = resolve));
        return inline.layout(input);
      },
      dispose: vi.fn()
    };
    ctx.state.layout.engine = engine;
    await prepare(ctx);
    const layout = actionsOf(ctx).layout;

    hold = true;
    ctx.state.layout.expanded.add("main/settings");
    const slow = layout.relayout();
    hold = false;
    ctx.state.layout.expanded.delete("main/settings");
    ctx.state.layout.expanded.add("main/afterOrder");
    await layout.relayout();
    release();
    await slow;
    expect(ctx.state.layout.result?.byKey["main/afterOrder"]?.kind).toBe("frame");
    expect(ctx.state.layout.result?.byKey["main/settings"]?.kind).toBe("node");

    const before = calls.mock.calls.length;
    const result = ctx.state.layout.result;
    await layout.relayout();
    expect(calls.mock.calls.length).toBe(before);
    expect(ctx.state.layout.result).toBe(result);
    expect(ctx.state.layout.cache.size).toBeLessThanOrEqual(8);
  });
});

describe("pins", () => {
  it("a missing layout.json means no pins", async () => {
    const { ctx } = createTestCtx();
    await prepare(ctx);
    await actionsOf(ctx).layout.loadPins();
    expect(ctx.state.layout.pins.nodes).toEqual({});
    expect(ctx.state.layout.pinsReadOnly).toBe(false);
    expect(ctx.state.layout.pinsVersion).toBeUndefined();
  });

  it("reads the pins of an existing file", async () => {
    const { ctx } = createTestCtx({
      files: { [LAYOUT]: '{ "version": 1, "nodes": { "main/home": { "x": 12, "y": 24 } } }\n' }
    });
    await prepare(ctx);
    await actionsOf(ctx).layout.loadPins();
    expect(ctx.state.layout.pins.nodes["main/home"]).toEqual({ x: 12, y: 24 });
    expect(ctx.state.layout.result?.byKey["main/home"]?.pinned).toBe(true);
    expect(ctx.state.layout.pinsVersion).toBe("v1");
  });

  it("an invalid file is read-only: warned once, toasted, never written", async () => {
    const { ctx, fakes } = createTestCtx({
      config: { layout: testLayout({ saveDelayMs: 0 }) },
      files: { [LAYOUT]: "{ nope" }
    });
    await prepare(ctx);
    await actionsOf(ctx).layout.loadPins();
    expect(ctx.state.layout.pinsReadOnly).toBe(true);
    expect(ctx.log.warn).toHaveBeenCalledTimes(1);
    expect(fakes.workspace.toast).toHaveBeenCalledWith(
      "layout.json is not valid · positions are not saved until it is fixed"
    );
    const home = ctx.state.layout.result?.byKey["main/home"];
    actionsOf(ctx).layout.drop("main/home", (home?.x ?? 0) + 100, home?.y ?? 0);
    await flush(10);
    expect(fakes.files.writes).toEqual([]);
    await expect(actionsOf(ctx).layout.reset()).rejects.toThrow("[moku-editor]");
  });

  it("drop snaps to 12, pins, saves after the debounce and toasts the file (M12)", async () => {
    const { ctx, fakes } = createTestCtx({ config: { layout: testLayout({ saveDelayMs: 0 }) } });
    await prepare(ctx);
    const layout = actionsOf(ctx).layout;
    const origin = ctx.state.layout.result?.origins["#main|main"] ?? { x: 0, y: 0 };
    layout.drop("main/home", origin.x + 605, origin.y + 293);
    expect(ctx.state.layout.pins.nodes["main/home"]).toEqual({ x: 600, y: 288 });
    await flush(10);
    expect(fakes.files.writes.map(write => write.path)).toEqual([LAYOUT]);
    expect(parsePins(fakes.files.writes[0]?.text ?? "")?.nodes["main/home"]).toEqual({
      x: 600,
      y: 288
    });
    expect(fakes.workspace.toast).toHaveBeenCalledWith("Layout saved", LAYOUT);
    expect(ctx.state.layout.result?.byKey["main/home"]?.pinned).toBe(true);
    expect(ctx.state.layout.dirty.size).toBe(0);
  });

  it("on a conflict re-reads, re-applies only the moved ids and writes once more", async () => {
    const { ctx, fakes } = createTestCtx({
      config: { layout: testLayout({ saveDelayMs: 0 }) },
      files: { [LAYOUT]: '{ "version": 1 }\n' }
    });
    await prepare(ctx);
    const layout = actionsOf(ctx).layout;
    await layout.loadPins();
    fakes.files.store.set(LAYOUT, {
      text: '{ "version": 1, "nodes": { "main/boot": { "x": 0, "y": 0 } } }\n',
      version: "disk"
    });
    const origin = ctx.state.layout.result?.origins["#main|main"] ?? { x: 0, y: 0 };
    layout.drop("main/home", origin.x + 600, origin.y + 288);
    await flush(15);
    const last = parsePins(fakes.files.store.get(LAYOUT)?.text ?? "");
    expect(last?.nodes).toEqual({ "main/boot": { x: 0, y: 0 }, "main/home": { x: 600, y: 288 } });
    expect(fakes.workspace.toast).toHaveBeenCalledWith("Layout saved", LAYOUT);
  });

  it("a second conflict toasts that the move was not saved and reloads the pins", async () => {
    const { ctx, fakes } = createTestCtx({
      config: { layout: testLayout({ saveDelayMs: 0 }) },
      files: { [LAYOUT]: '{ "version": 1, "nodes": {} }\n' }
    });
    await prepare(ctx);
    const layout = actionsOf(ctx).layout;
    await layout.loadPins();
    fakes.files.conflicts = 2;
    const origin = ctx.state.layout.result?.origins["#main|main"] ?? { x: 0, y: 0 };
    layout.drop("main/home", origin.x + 600, origin.y + 288);
    await flush(20);
    expect(fakes.workspace.toast).toHaveBeenCalledWith(
      "layout.json changed on disk · your move was not saved"
    );
    expect(ctx.state.layout.pins.nodes).toEqual({});
  });

  it("pinnedCount counts the visible flows (M8); reset clears them, writes and toasts", async () => {
    const { ctx, fakes } = createTestCtx({
      files: {
        [LAYOUT]:
          '{ "version": 1, "nodes": { "main/home": { "x": 12, "y": 24 }, "board/merge": { "x": 600, "y": 300 }, "rewardPopup/show": { "x": 0, "y": 0 } } }\n'
      }
    });
    await prepare(ctx);
    const layout = actionsOf(ctx).layout;
    await expect(layout.reset()).rejects.toThrow("Nothing is pinned");
    await layout.loadPins();
    expect(layout.pinnedCount()).toBe(2);
    expect(layout.visibleFlows()).toEqual(new Set(["main", "board"]));
    await layout.reset();
    expect(layout.pinnedCount()).toBe(0);
    expect(parsePins(fakes.files.store.get(LAYOUT)?.text ?? "")?.nodes).toEqual({
      "rewardPopup/show": { x: 0, y: 0 }
    });
    expect(fakes.workspace.toast).toHaveBeenCalledWith("Layout reset · 2 pinned nodes", LAYOUT);
  });
});

describe("flows", () => {
  it("expands, collapses (with nested keys), enters and leaves sub-flows", async () => {
    const { ctx } = createTestCtx();
    await prepare(ctx);
    const actions = actionsOf(ctx);
    actions.flows.expand("main/settings");
    await flush(10);
    expect(ctx.state.layout.result?.byKey["main/settings"]?.kind).toBe("frame");
    actions.flows.expand("main/board>board/settings");
    actions.flows.collapse("main/board");
    expect(ctx.state.layout.expanded).toEqual(new Set(["main/settings"]));
    actions.flows.expand("main/home");
    expect(ctx.state.layout.expanded.has("main/home")).toBe(false);

    ctx.state.camera.initialised = true;
    actions.flows.enter("main/board");
    expect(ctx.state.camera.initialised).toBe(false);
    await flush(10);
    expect(actions.layout.root()).toBe("board");
    expect(ctx.state.layout.enter).toEqual([{ flow: "board", via: "main/board" }]);
    expect(ctx.state.layout.result?.byKey["board/awaitIntent"]?.kind).toBe("hub");
    expect(ctx.state.camera.initialised).toBe(true);
    actions.flows.up(0);
    await flush(10);
    expect(actions.layout.root()).toBe("main");
    expect(ctx.state.layout.expanded.has("main/board")).toBe(true);
  });

  it("reveal expands the first parent chain of a collapsed node", async () => {
    const { ctx } = createTestCtx();
    await prepare(ctx);
    const layout = actionsOf(ctx).layout;
    expect(layout.reveal("board/merge")).toBe("main/board>board/merge");
    expect(layout.reveal("rewardPopup/grant")).toBe("main/afterOrder>rewardPopup/grant");
    expect(ctx.state.layout.expanded.has("main/afterOrder")).toBe(true);
    expect(layout.reveal("nope/x")).toBeUndefined();
  });
});

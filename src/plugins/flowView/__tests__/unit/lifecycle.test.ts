// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { actionsOf } from "../../actions";
import { initFlowView, stopFlowView } from "../../lifecycle";
import { createTestCtx, jumpCamera, prepare } from "../ctx";

beforeEach(() => {
  jumpCamera();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("initFlowView", () => {
  it("registers the Flow panel with its commands and no sources (flowView watches them itself)", () => {
    const { ctx, fakes } = createTestCtx();
    initFlowView(ctx);
    const [panel] = fakes.panels;
    expect(panel?.id).toBe("flow");
    expect(panel?.workspace).toBe("flow");
    expect(panel?.sources).toEqual({});
    expect(fakes.watches).toEqual([]);
    expect(panel?.commands).toEqual({
      step: "game.step",
      pause: "game.pause",
      resume: "game.resume"
    });
    expect(ctx.state.view.files).toBe(fakes.files);
  });

  it("takes the density the shell applies now", () => {
    const { ctx, fakes } = createTestCtx();
    fakes.density = "compact";
    initFlowView(ctx);
    expect(ctx.state.layout.density).toBe("compact");
  });

  it("adds the Commands palette items; Reset layout is disabled while nothing is pinned (M8)", async () => {
    const { ctx, fakes } = createTestCtx();
    initFlowView(ctx);
    const commands = fakes.palette[0] ?? [];
    expect(commands.map(item => item.label)).toEqual([
      "Fit all",
      "Fit selection",
      "Follow the game",
      "Reset layout",
      "Go to current node",
      "Show where the game is",
      "Show Inspector"
    ]);
    expect(commands.every(item => item.group === "Commands")).toBe(true);
    const reset = commands.find(item => item.label === "Reset layout");
    expect(reset?.disabled?.()).toBe("Nothing is pinned in the visible flows");
    await prepare(ctx);
    ctx.state.layout.pins.nodes["main/home"] = { x: 0, y: 0 };
    expect(reset?.disabled?.()).toBe(false);
    commands.find(item => item.label === "Follow the game")?.run();
    expect(ctx.state.camera.follow).toBe(true);
    commands.find(item => item.label === "Go to current node")?.run();
    expect(ctx.state.focus.selected).toBe("main/board>board/awaitIntent");
    commands.find(item => item.label === "Show where the game is")?.run();
    expect(ctx.state.focus.pulse).toBe("main/board>board/awaitIntent");
    const { sidePanelState, updateSidePanel } = await import(
      "../../../panels/shared/side-panel/store"
    );
    updateSidePanel("flow.inspector", { closed: true });
    commands.find(item => item.label === "Show Inspector")?.run();
    expect(sidePanelState("flow.inspector").closed).toBe(false);
    expect(fakes.workspace.show).toHaveBeenCalledWith("flow");
  });

  it("binds the Flow keys to the flow workspace and the three Esc layers", async () => {
    const { ctx, fakes } = createTestCtx();
    initFlowView(ctx);
    const keys = fakes.bindings.flatMap(binding =>
      typeof binding.keys === "string" ? [binding.keys] : [...binding.keys]
    );
    expect(keys).not.toContain("n");
    for (const key of [
      "h",
      "c",
      "\\",
      "alt+arrowleft",
      "f",
      "shift+1",
      "shift+2",
      "+",
      "=",
      "-",
      "0",
      "arrowleft",
      "arrowright",
      "arrowup",
      "arrowdown",
      "enter",
      "mod+s"
    ]) {
      expect(keys).toContain(key);
    }
    expect(fakes.bindings.every(binding => binding.workspace === "flow")).toBe(true);
    expect([...fakes.escapes.keys()]).toEqual(["contextMenu", "codeEdit", "selection"]);
    expect(fakes.escapes.get("contextMenu")?.()).toBe(false);
    await prepare(ctx);
    actionsOf(ctx).focus.select("main/home");
    expect(fakes.escapes.get("selection")?.()).toBe(true);
    expect(ctx.state.focus.selected).toBeUndefined();
    const arrows = fakes.bindings.find(binding => binding.keys.includes("arrowright"));
    expect(arrows?.when?.()).toBe(false);
    const history = fakes.bindings.find(binding => binding.keys === "h");
    history?.run(new KeyboardEvent("keydown", { key: "h" }));
    expect(ctx.state.focus.historyOpen).toBe(true);
    const save = fakes.bindings.find(binding => binding.keys === "mod+s");
    expect(save?.inInputs).toBe(true);
    expect(save?.when?.()).toBe(false);
  });
});

describe("stopFlowView", () => {
  it("waits for a pending save at most 1000 ms, clears timers and rAF, disposes the engine, runs the removers", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const cancel = vi.fn();
    vi.stubGlobal("cancelAnimationFrame", cancel);
    const { ctx, fakes } = createTestCtx();
    initFlowView(ctx);
    const dispose = vi.fn();
    ctx.state.layout.engine = { layout: async input => input, dispose };
    ctx.state.layout.saving = new Promise(() => undefined);
    const timer = setTimeout(() => undefined, 60_000);
    ctx.state.view.timers.add(timer);
    ctx.state.camera.anim = 3;
    let done = false;
    const stopping = stopFlowView(ctx).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    await stopping;
    expect(done).toBe(true);
    expect(ctx.state.view.timers.size).toBe(0);
    expect(cancel).toHaveBeenCalledWith(3);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(ctx.state.view.removers).toEqual([]);
    expect(fakes.removed.length).toBeGreaterThanOrEqual(
      fakes.bindings.length + fakes.escapes.size + 1
    );
  });
});

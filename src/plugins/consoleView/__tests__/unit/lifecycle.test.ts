// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerConsolePanel, startConsole, stopConsole } from "../../lifecycle";
import { createCtx, type TestCtx, traceValue } from "../helpers";

let ctx: TestCtx;

beforeEach(() => {
  ctx = createCtx();
});

describe("registerConsolePanel", () => {
  it("registers the Console panel with no sources", () => {
    registerConsolePanel(ctx);
    expect(ctx.registered).toHaveLength(1);
    expect(ctx.registered[0]).toMatchObject({
      id: "console",
      title: "Console",
      workspace: "console",
      sources: {}
    });
  });
});

describe("startConsole", () => {
  it("opens the game.log watch, adds the palette items and the '/' binding, clears the badge", () => {
    startConsole(ctx);

    expect(ctx.link.active("game.log")).toHaveLength(1);
    expect(ctx.state.stopLog).toBeTypeOf("function");
    expect(ctx.workspace.add).toHaveBeenCalledTimes(1);
    expect(ctx.workspace.items.map(item => [item.id, item.group, item.label])).toEqual([
      ["console:clear", "Commands", "Clear console"],
      ["console:preserve", "Commands", "Preserve log: on / off"]
    ]);
    expect(ctx.workspace.bindings).toEqual([
      expect.objectContaining({ keys: "/", label: "Search the log", workspace: "console" })
    ]);
    expect(ctx.state.removePalette).toHaveLength(2);
    expect(ctx.workspace.badge).toHaveBeenCalledWith("console", undefined);
  });

  it("palette items clear the console and toggle Preserve log", () => {
    startConsole(ctx);
    ctx.link.send("game.log", traceValue());
    const [clear, preserve] = ctx.workspace.items;

    clear?.run();
    expect(ctx.state.lines.map(line => line.kind)).toEqual(["meta"]);
    preserve?.run();
    expect(ctx.state.preserve).toBe(true);
    preserve?.run();
    expect(ctx.state.preserve).toBe(false);
  });

  it("the '/' binding focuses the search field the view registered", () => {
    startConsole(ctx);
    const focus = vi.fn();
    ctx.state.searchEl = { focus } as unknown as HTMLInputElement;
    ctx.workspace.bindings[0]?.run(new KeyboardEvent("keydown", { key: "/" }));
    expect(focus).toHaveBeenCalledTimes(1);

    ctx.state.searchEl = undefined;
    expect(() => ctx.workspace.bindings[0]?.run(new KeyboardEvent("keydown"))).not.toThrow();
  });
});

describe("stopConsole", () => {
  it("drops the watch, every palette remover and every listener", () => {
    startConsole(ctx);
    ctx.state.listeners.add(vi.fn());
    stopConsole({ state: ctx.state });

    expect(ctx.link.active("game.log")).toHaveLength(0);
    expect(ctx.workspace.items).toEqual([]);
    expect(ctx.workspace.bindings).toEqual([]);
    expect(ctx.state.stopLog).toBeUndefined();
    expect(ctx.state.removePalette).toEqual([]);
    expect(ctx.state.listeners.size).toBe(0);

    // A second stop is harmless.
    expect(() => stopConsole({ state: ctx.state })).not.toThrow();
  });
});

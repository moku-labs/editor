import { beforeEach, describe, expect, it, vi } from "vitest";
import { createConsoleApi } from "../../api";
import type { ConsoleApi } from "../../types";
import { startLogWatch } from "../../watch";
import { createCtx, entryLine, flush, type TestCtx, TRACE, traceValue } from "../helpers";

let ctx: TestCtx;
let api: ConsoleApi;

beforeEach(() => {
  ctx = createCtx();
  api = createConsoleApi(ctx);
  startLogWatch(ctx);
  ctx.link.send("game.log", traceValue());
});

describe("consoleView api", () => {
  it("lines() is a copy of every held line, oldest first", () => {
    const lines = api.lines();
    expect(lines).toHaveLength(8);
    expect(lines).not.toBe(ctx.state.lines);
    expect(lines[0]?.key).toBe(1);
  });

  it("counts() counts entries per level", () => {
    expect(api.counts()).toEqual({ all: 8, debug: 0, info: 6, warn: 2, error: 0 });
  });

  it("filter() and setFilter() read and merge the filter and notify", () => {
    const listener = vi.fn();
    api.subscribe(listener);
    expect(api.filter()).toEqual({ level: "all", query: "" });

    api.setFilter({ level: "warn" });
    expect(api.filter()).toEqual({ level: "warn", query: "" });
    expect(api.visible()).toHaveLength(2);

    api.setFilter({ query: "TEXTURE" });
    expect(api.filter()).toEqual({ level: "warn", query: "TEXTURE" });
    expect(api.visible().map(line => line.key)).toEqual([5, 7]);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("clear() leaves one meta row, keeps consumed and resets the badge", () => {
    api.select(3);
    api.clear();
    expect(api.lines()).toEqual([
      expect.objectContaining({ kind: "meta", key: 9, text: "Console cleared" })
    ]);
    expect(api.selected()).toBeUndefined();
    expect(ctx.state.consumed).toBe(8);
    expect(ctx.workspace.badge).toHaveBeenLastCalledWith("console", undefined);

    // The same trace again brings nothing back.
    ctx.link.send("game.log", traceValue());
    expect(api.lines()).toHaveLength(1);
  });

  it("preserve() and setPreserve() read and set Preserve log and notify", () => {
    const listener = vi.fn();
    api.subscribe(listener);
    expect(api.preserve()).toBe(false);
    api.setPreserve(true);
    expect(api.preserve()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("select() and selected() pick the line of the detail drawer", () => {
    api.select(5);
    expect(api.selected()).toMatchObject({ key: 5, source: "assets", level: "warn" });
    api.select(99);
    expect(api.selected()).toBeUndefined();
    api.select(undefined);
    expect(api.selected()).toBeUndefined();
  });

  it("refresh() makes one link.read of game.log and ingests it", async () => {
    ctx.state.lines = [entryLine(1)];
    vi.mocked(ctx.link.api.read).mockResolvedValue(
      traceValue([...TRACE, { level: "error", event: "flow: x", ts: 2000 }])
    );
    api.refresh();
    await flush();
    expect(ctx.link.api.read).toHaveBeenCalledTimes(1);
    expect(ctx.link.api.read).toHaveBeenCalledWith("game.log");
    expect(api.counts().error).toBe(1);
  });

  it("focusFrame() emits workspace:focus-frame and calls no workspace.show", () => {
    api.focusFrame(1778);
    expect(ctx.emit).toHaveBeenCalledWith("workspace:focus-frame", { frame: 1778 });
    expect(ctx.workspace.show).not.toHaveBeenCalled();
  });

  it("subscribe() returns an idempotent unsubscribe", () => {
    const listener = vi.fn();
    const off = api.subscribe(listener);
    api.select(1);
    off();
    off();
    api.select(2);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

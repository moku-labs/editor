import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readOnce, startLogWatch } from "../../watch";
import { createCtx, flush, type TestCtx, TRACE, traceValue } from "../helpers";

let ctx: TestCtx;

beforeEach(() => {
  ctx = createCtx();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("startLogWatch", () => {
  it("opens exactly one game.log watch and returns its unsubscribe", () => {
    const stop = startLogWatch(ctx);
    expect(ctx.link.watch).toHaveBeenCalledTimes(1);
    expect(ctx.link.watch).toHaveBeenCalledWith("game.log", undefined, expect.any(Function));
    stop();
    expect(ctx.link.active("game.log")).toHaveLength(0);
  });

  it("ingests each delivered value with the frame of link.status()", () => {
    const listener = vi.fn();
    ctx.state.listeners.add(listener);
    startLogWatch(ctx);

    ctx.link.send("game.log", traceValue(TRACE.slice(0, 3)));
    expect(ctx.state.lines).toHaveLength(3);
    expect(ctx.state.lines[0]).toMatchObject({ frame: { value: 1840, exact: false } });
    expect(ctx.state.everConnected).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    ctx.link.current = { kind: "paused", frame: 1900 };
    ctx.link.send("game.log", traceValue());
    expect(ctx.state.lines).toHaveLength(8);
    expect(ctx.state.lines[6]).toMatchObject({ frame: { value: 1900, exact: false } });
    expect(ctx.workspace.badge).toHaveBeenLastCalledWith("console", {
      count: 2,
      tone: "warn",
      label: "2 warn"
    });
  });

  it("ingests a new game's trace delivered after a session change", () => {
    startLogWatch(ctx);
    ctx.link.send("game.log", traceValue());
    ctx.link.send("game.log", traceValue([{ level: "info", event: "flow: boot", ts: 99 }]));
    expect(ctx.state.lines.map(line => line.kind)).toEqual(["meta", "entry"]);
  });

  it("resets the lines on a session change after a game that logged nothing", () => {
    const session = vi.spyOn(ctx.link.api, "session").mockReturnValue("s-1");
    startLogWatch(ctx);
    ctx.link.send("game.log", traceValue());
    session.mockReturnValue("s-2");
    ctx.link.send("game.log", []);
    session.mockReturnValue("s-3");
    ctx.link.send("game.log", []);

    expect(ctx.state.session).toBe("s-3");
    expect(ctx.state.lines).toEqual([
      expect.objectContaining({ kind: "meta", text: expect.stringMatching(/^Log cleared/) })
    ]);
  });

  it("warns once per value of the wrong shape and keeps the lines", () => {
    startLogWatch(ctx);
    ctx.link.send("game.log", traceValue());
    ctx.link.send("game.log", { not: "a trace" });
    expect(ctx.log.warn).toHaveBeenCalledWith("consoleView:unexpected-log", { type: "object" });
    expect(ctx.state.lines).toHaveLength(8);
  });

  it("starts no timer and makes no link.read", () => {
    vi.useFakeTimers();
    startLogWatch(ctx);
    ctx.link.send("game.log", traceValue());
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10_000);
    expect(ctx.link.api.read).not.toHaveBeenCalled();
  });
});

describe("readOnce", () => {
  it("reads game.log once and ingests it like a watched value", async () => {
    vi.mocked(ctx.link.api.read).mockResolvedValue(traceValue());
    await readOnce(ctx);
    expect(ctx.link.api.read).toHaveBeenCalledWith("game.log");
    expect(ctx.state.lines).toHaveLength(8);
  });

  it("logs a debug line when the read fails", async () => {
    vi.mocked(ctx.link.api.read).mockRejectedValue(
      Object.assign(new Error("[moku-editor] no session"), { code: -32_001 })
    );
    await readOnce(ctx);
    expect(ctx.log.debug).toHaveBeenCalledWith("consoleView:read-failed", { code: -32_001 });

    vi.mocked(ctx.link.api.read).mockRejectedValue("boom");
    await readOnce(ctx);
    await flush();
    expect(ctx.log.debug).toHaveBeenLastCalledWith("consoleView:read-failed", {
      code: undefined
    });
    expect(ctx.state.lines).toEqual([]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunResult } from "../../../registry/protocol";
import { createHandlers, onCommandRan, onLinkStatus } from "../../handlers";
import { createCtx, type TestCtx } from "../helpers";

let ctx: TestCtx;

beforeEach(() => {
  ctx = createCtx();
});

const RESULT: RunResult = {
  value: { frames: 1 },
  state: { path: "board/awaitIntent", frame: 1841, tainted: false }
};

describe("createHandlers", () => {
  it("hooks link:status and workspace:ran", () => {
    expect(Object.keys(createHandlers(ctx)).toSorted()).toEqual(["link:status", "workspace:ran"]);
  });
});

describe("onLinkStatus", () => {
  it("notifies the view and reads nothing", () => {
    const listener = vi.fn();
    ctx.state.listeners.add(listener);
    onLinkStatus(ctx)({ status: { kind: "connecting" } });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(ctx.state.everConnected).toBe(false);
    expect(ctx.link.api.read).not.toHaveBeenCalled();
    expect(ctx.link.watch).not.toHaveBeenCalled();
  });

  it("marks the console as connected once a game is live or paused", () => {
    onLinkStatus(ctx)({ status: { kind: "live", frame: 3 }, session: "s-1" });
    expect(ctx.state.everConnected).toBe(true);
    onLinkStatus(ctx)({ status: { kind: "empty" } });
    expect(ctx.state.everConnected).toBe(true);
  });
});

describe("onCommandRan", () => {
  it("appends the D1 line for a failed run, prefix stripped, and pushes the badge", () => {
    const listener = vi.fn();
    ctx.state.listeners.add(listener);
    onCommandRan(ctx)({
      id: "game.step",
      input: { frames: "x" },
      origin: "topbar",
      at: 5000,
      ok: false,
      error: {
        code: -32_602,
        message: "[moku-editor] game.step: frames must be a number",
        data: { field: "frames" }
      }
    });

    expect(ctx.state.lines).toEqual([
      expect.objectContaining({
        kind: "entry",
        key: 1,
        level: "error",
        source: "editor",
        message: "-32602 game.step: frames must be a number",
        frame: { value: 1840, exact: false }
      })
    ]);
    expect(ctx.state.nextKey).toBe(2);
    expect(ctx.workspace.badge).toHaveBeenLastCalledWith("console", {
      count: 1,
      tone: "error",
      label: "1 error"
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(ctx.link.api.read).not.toHaveBeenCalled();
  });

  it("does nothing for a successful run", () => {
    onCommandRan(ctx)({
      id: "game.step",
      input: { frames: 1 },
      origin: "panel",
      at: 1,
      ok: true,
      result: RESULT
    });
    expect(ctx.state.lines).toEqual([]);
    expect(ctx.workspace.badge).not.toHaveBeenCalled();
    expect(ctx.link.api.read).not.toHaveBeenCalled();
  });

  it("trims to maxLines", () => {
    const small = createCtx({ maxLines: 1 });
    const failed = {
      id: "game.step",
      input: undefined,
      origin: "key" as const,
      at: 1,
      ok: false as const,
      error: { code: -1, message: "x" }
    };
    onCommandRan(small)(failed);
    onCommandRan(small)(failed);
    expect(small.state.lines.map(line => line.key)).toEqual([2]);
  });
});

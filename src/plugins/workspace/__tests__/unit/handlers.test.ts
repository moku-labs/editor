import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHandlers, handleLinkStatus } from "../../handlers";
import { createCtx, resultOf } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// link:status: everLive, the 1 s ticker for silent/lost, stale step popover
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createHandlers", () => {
  it("hooks link:status", () => {
    const hooks = createHandlers(createCtx());
    expect(Object.keys(hooks)).toEqual(["link:status"]);
  });
});

describe("handleLinkStatus", () => {
  it("stores the status, sets everLive on live or paused and bumps the UI", () => {
    const ctx = createCtx();
    const handle = handleLinkStatus(ctx);
    handle({ status: { kind: "connecting" } });
    expect(ctx.state.everLive).toBe(false);

    handle({ status: { kind: "paused", frame: 3 }, session: "s-1" });
    expect(ctx.state.link).toEqual({ kind: "paused", frame: 3 });
    expect(ctx.state.everLive).toBe(true);
    expect(ctx.state.ui.version).toBe(2);
  });

  it("runs the 1 s ticker only while silent or lost", () => {
    const ctx = createCtx();
    const handle = handleLinkStatus(ctx);
    handle({ status: { kind: "silent", since: 0, lastFrame: 9 } });
    const ticker = ctx.state.ticker;
    expect(ticker).toBeDefined();

    vi.advanceTimersByTime(3000);
    expect(ctx.state.ui.version).toBe(4);

    handle({ status: { kind: "lost", reason: "game_reloaded", lastFrame: 9, retryInMs: 1000 } });
    expect(ctx.state.ticker).toBe(ticker);

    handle({ status: { kind: "live", frame: 10 } });
    expect(ctx.state.ticker).toBeUndefined();
    const version = ctx.state.ui.version;
    vi.advanceTimersByTime(3000);
    expect(ctx.state.ui.version).toBe(version);
  });

  it("closes the step popover once the game is no longer live or paused", () => {
    const ctx = createCtx();
    ctx.state.popover = "step";
    ctx.state.step = {
      id: "game.step",
      input: { frames: 1 },
      origin: "topbar",
      at: 1,
      ok: true,
      result: resultOf()
    };
    const handle = handleLinkStatus(ctx);
    handle({ status: { kind: "paused", frame: 2 } });
    expect(ctx.state.popover).toBe("step");
    handle({ status: { kind: "lost", reason: "socket_closed", lastFrame: 2, retryInMs: 1000 } });
    expect(ctx.state.popover).toBeUndefined();

    ctx.state.popover = "registry";
    handle({ status: { kind: "empty" } });
    expect(ctx.state.popover).toBe("registry");
  });
});

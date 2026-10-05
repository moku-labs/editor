import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onSocketMessage } from "../../socket/messages";
import { addTapListener } from "../../subscriptions/taps";
import { addWatch } from "../../subscriptions/watch";
import { beat, connected, createCtx, FakeWebSocket, type TestCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Routing of hub messages (R1: hub notifications on "editor", agent traffic on "game")
// ─────────────────────────────────────────────────────────────────────────────

let ctx: TestCtx;
let socket: FakeWebSocket;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  FakeWebSocket.instances.length = 0;
  ctx = createCtx();
  socket = await connected(ctx);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("onSocketMessage", () => {
  it("drops undecodable text with a warning", () => {
    onSocketMessage(ctx, "{nope");
    expect(ctx.log.warn).toHaveBeenCalledWith("link:bad-message", {
      error: "[moku-editor] message is not JSON"
    });
  });

  it("a heartbeat of the chosen session → live, stored with receivedAt", () => {
    vi.setSystemTime(42_000);
    beat(socket, "s-1", 1840);
    expect(ctx.state.status).toEqual({ kind: "live", frame: 1840 });
    expect(ctx.state.heartbeat).toEqual({ frame: 1840, paused: false, receivedAt: 42_000 });
  });

  it("a paused heartbeat → paused", () => {
    beat(socket, "s-1", 7, true);
    expect(ctx.state.status).toEqual({ kind: "paused", frame: 7 });
  });

  it("ignores heartbeats of other sessions and malformed ones", () => {
    beat(socket, "s-other", 5);
    socket.notify("game", "heartbeat", { frame: "x", paused: false }, "s-1");
    socket.notify("game", "heartbeat", { frame: 3 });
    expect(ctx.state.status).toEqual({ kind: "connecting" });
  });

  it("a heartbeat with a heap stores it; one without a heap or with a malformed one clears it", () => {
    vi.setSystemTime(42_000);
    const heap = { usedMb: 12.8, limitMb: 4095.8 };

    socket.notify("game", "heartbeat", { frame: 1, paused: false, at: 1, heap }, "s-1");
    expect(ctx.state.heartbeat).toEqual({ frame: 1, paused: false, receivedAt: 42_000, heap });

    socket.notify(
      "game",
      "heartbeat",
      { frame: 2, paused: false, at: 2, heap: { usedMb: 1 } },
      "s-1"
    );
    expect(ctx.state.heartbeat).toEqual({ frame: 2, paused: false, receivedAt: 42_000 });

    socket.notify("game", "heartbeat", { frame: 3, paused: false, at: 3, heap }, "s-1");
    beat(socket, "s-1", 4);
    expect(ctx.state.heartbeat?.heap).toBeUndefined();
  });

  it("a tap of the chosen session reaches the tap listeners; other sessions and bad taps do not", () => {
    const taps: unknown[] = [];
    addTapListener(ctx, tap => taps.push(tap));

    socket.notify("game", "tap", { x: 206, y: 640, at: 15_234.5 }, "s-1");
    socket.notify("game", "tap", { x: 1, y: 2, at: 3 }, "s-other");
    socket.notify("game", "tap", { x: "1", y: 2, at: 3 }, "s-1");
    socket.notify("game", "tap", { x: 1, y: 2 }, "s-1");
    socket.notify("game", "tap", undefined, "s-1");

    expect(taps).toEqual([{ x: 206, y: 640, at: 15_234.5 }]);
  });

  it("delivers a value of the chosen session to its sub; others are dropped", () => {
    const seen: unknown[] = [];
    addWatch(ctx, "game.position", undefined, value => seen.push(value));
    const sub = socket.last("watch").params;
    expect(sub).toMatchObject({ sub: 1 });

    socket.notify("game", "value", { sub: 1, value: { path: "home" } }, "s-1");
    socket.notify("game", "value", { sub: 1, value: "other" }, "s-other");
    socket.notify("game", "value", { sub: 99, value: "unknown" }, "s-1");
    socket.notify("game", "value", { sub: 1 }, "s-1");
    expect(seen).toEqual([{ path: "home" }]);
  });

  it("session open is logged at debug only", () => {
    socket.notify("editor", "session", { id: "s-2", game: "g", open: true });
    expect(ctx.log.debug).toHaveBeenCalledWith("link:session-open", { id: "s-2" });
    expect(ctx.state.chosen).toBe("s-1");
  });

  it("session close of another id changes nothing", () => {
    socket.notify("editor", "session", { id: "s-2", game: "g", open: false });
    expect(ctx.state.chosen).toBe("s-1");
  });

  it("session close of the chosen id → lost game_reloaded by default", () => {
    socket.notify("editor", "session", { id: "s-1", game: "g", open: false });
    expect(ctx.state.status).toMatchObject({
      kind: "lost",
      reason: "game_reloaded",
      retryInMs: 1000
    });
    socket.notify("editor", "session", { id: "s-1", open: "no" });
  });

  it("a malformed sessions notification is dropped with a warning", () => {
    socket.notify("editor", "sessions", { list: "none" });
    expect(ctx.log.warn).toHaveBeenCalledWith("link:bad-sessions", {});
    expect(ctx.state.sessions).toHaveLength(1);
  });

  it("unknown notifications and requests are logged at debug", () => {
    socket.notify("game", "bye", undefined, "s-1");
    expect(ctx.log.debug).toHaveBeenCalledWith("link:unknown-notification", { method: "bye" });
    socket.receive({ jsonrpc: "2.0", id: 5, channel: "game", method: "ping" });
    expect(ctx.log.debug).toHaveBeenCalledWith("link:unexpected-request", { method: "ping" });
  });

  it("does nothing after stop", () => {
    ctx.state.stopped = true;
    beat(socket, "s-1", 5);
    expect(ctx.state.status).toEqual({ kind: "connecting" });
  });
});

// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startLink, stopLink } from "../../lifecycle";
import { request } from "../../rpc/calls";
import { addManifestListener } from "../../sessions/manifest";
import { addWatch } from "../../subscriptions/watch";
import {
  beat,
  createCtx,
  FakeWebSocket,
  installBoot,
  latestSocket,
  sendSessions,
  sessionOf,
  type TestCtx
} from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// onStart / onStop bodies
// ─────────────────────────────────────────────────────────────────────────────

let ctx: TestCtx;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  FakeWebSocket.instances.length = 0;
  ctx = createCtx();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("startLink", () => {
  it("reads the boot tag, opens the socket and starts the silence interval", () => {
    installBoot();
    startLink(ctx);

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(ctx.state.silenceTimer).toBeDefined();
    expect(vi.getTimerCount()).toBe(1);
    expect(ctx.state.status).toEqual({ kind: "connecting" });
    expect(ctx.emit).not.toHaveBeenCalled();
  });

  it("without the boot tag goes lost no_boot and opens nothing", () => {
    startLink(ctx);
    expect(ctx.state.status).toMatchObject({ kind: "lost", reason: "no_boot" });
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("the silence interval turns live into silent after 6 s", () => {
    installBoot();
    startLink(ctx);
    const socket = latestSocket();
    socket.open();
    sendSessions(socket, [sessionOf("s-1")]);
    beat(socket, "s-1", 12);
    vi.advanceTimersByTime(6000);
    expect(ctx.state.status).toMatchObject({ kind: "silent", lastFrame: 12 });
  });
});

describe("stopLink", () => {
  it("clears every timer, rejects pending calls, closes the socket with 1000 and forgets everything", async () => {
    installBoot();
    startLink(ctx);
    const socket = latestSocket();
    socket.open();
    sendSessions(socket, [sessionOf("s-1")]);
    addWatch(ctx, "game.position", undefined, vi.fn());
    addManifestListener(ctx, vi.fn());
    const pending = request(ctx, "game", "read", { id: "x" }, "s-1").catch(
      (error: unknown) => error
    );

    stopLink({ state: ctx.state });

    expect(ctx.state.stopped).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(await pending).toMatchObject({ code: -32_002, data: { reason: "link_closed" } });
    expect(socket.closedWith).toEqual({ code: 1000, reason: "stop" });
    expect(ctx.state.socket).toBeUndefined();
    expect(ctx.state.open).toBe(false);
    expect(ctx.state.subs.size).toBe(0);
    expect(ctx.state.wire.size).toBe(0);
    expect(ctx.state.manifestListeners.size).toBe(0);
  });

  it("events after stop are ignored and nothing reconnects", async () => {
    installBoot();
    startLink(ctx);
    const socket = latestSocket();
    socket.open();
    stopLink({ state: ctx.state });

    socket.drop(1000);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(ctx.state.status).toEqual({ kind: "connecting" });
  });

  it("is safe without a socket", () => {
    stopLink({ state: ctx.state });
    expect(ctx.state.stopped).toBe(true);
  });
});

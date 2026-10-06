import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LinkStatus } from "../../../registry/protocol";
import { createLinkApi } from "../../api";
import { checkLinkConfig, stopLink } from "../../lifecycle";
import { requestHotReload } from "../../server/hot-reload";
import { onSocketClose } from "../../socket/connect";
import { expectReload } from "../../status/reload";
import {
  beat,
  connected,
  createCtx,
  FakeWebSocket,
  flush,
  latestSocket,
  sendSessions,
  sessionOf,
  type TestCtx
} from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// U7: an expected reload reads lost with `reloading: true` until the game beats
// again; after reloadGraceMs without a return it is a plain lost. A real loss is
// a plain lost at once.
// ─────────────────────────────────────────────────────────────────────────────

/** Close code of a server restart. */
const SERVICE_RESTART = 1012;

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
});

/**
 * Connects and makes the session beat at a frame.
 *
 * @param frame - The heartbeat frame.
 * @returns The open socket.
 */
async function liveAt(frame: number): Promise<FakeWebSocket> {
  const socket = await connected(ctx);
  beat(socket, "s-1", frame);
  expect(ctx.state.status).toEqual({ kind: "live", frame });
  return socket;
}

/**
 * Every status link emitted, in order.
 *
 * @returns The statuses.
 */
function emitted(): LinkStatus[] {
  return ctx.emit.mock.calls.flatMap(([, payload]) =>
    "status" in payload ? [payload.status] : []
  );
}

/**
 * A game that said bye, then a server restart, then the reconnect: the socket opens and the hub
 * lists no session yet.
 *
 * @returns The new socket.
 */
async function reconnectedWithoutSessions(): Promise<FakeWebSocket> {
  const socket = await liveAt(1825);
  socket.notify("editor", "session", { id: "s-1", game: "g", open: false, reason: "bye" });
  socket.drop(SERVICE_RESTART, "editor restarting");
  vi.advanceTimersByTime(1000);
  const next = latestSocket();
  next.open();
  sendSessions(next, []);
  return next;
}

describe("a close 1012 (server restart)", () => {
  it("reads lost reloading with the last frame, and live once the game beats again", async () => {
    const socket = await liveAt(1825);
    socket.drop(SERVICE_RESTART, "editor restarting");

    expect(ctx.state.status).toEqual({
      kind: "lost",
      reason: "socket_closed",
      lastFrame: 1825,
      retryInMs: 1000,
      reloading: true
    });

    // The reconnect: the old session is gone, the new one beats.
    vi.advanceTimersByTime(1000);
    const next = latestSocket();
    next.open();
    sendSessions(next, []);
    expect(ctx.state.status).toMatchObject({
      kind: "lost",
      reason: "game_reloaded",
      lastFrame: 1825,
      reloading: true
    });
    sendSessions(next, [sessionOf("s-2")]);
    next.answer(next.last("manifest"), {
      game: "g",
      page: "http://127.0.0.1:3000/",
      embedded: false,
      sources: [],
      commands: []
    });
    await flush();
    beat(next, "s-2", 0, true);

    expect(ctx.state.status).toEqual({ kind: "paused", frame: 0 });
    expect(ctx.state.reload).toBeUndefined();
    expect(emitted().filter(status => status.kind === "lost" && status.reloading !== true)).toEqual(
      []
    );
  });

  it("turns into today's plain lost after reloadGraceMs without a return", async () => {
    ctx = createCtx({ reloadGraceMs: 3000 });
    const socket = await liveAt(1825);
    socket.drop(SERVICE_RESTART, "editor restarting");
    vi.advanceTimersByTime(2999);
    expect(ctx.state.status).toMatchObject({ reloading: true });

    vi.advanceTimersByTime(1);
    expect(ctx.state.status).toEqual({
      kind: "lost",
      reason: "socket_closed",
      lastFrame: 1825,
      retryInMs: 1000
    });
    expect(ctx.state.reload).toBeUndefined();
    expect(ctx.emit).toHaveBeenLastCalledWith("link:status", {
      status: ctx.state.status,
      session: "s-1"
    });
  });
});

describe("the reconnect inside a reload window", () => {
  it("keeps lost reloading through socket-open and an empty session list", async () => {
    await reconnectedWithoutSessions();

    expect(ctx.state.status).toEqual({
      kind: "lost",
      reason: "socket_closed",
      lastFrame: 1825,
      retryInMs: 1000,
      reloading: true
    });
    const afterLive = emitted().slice(emitted().findIndex(status => status.kind === "lost"));
    expect(afterLive.filter(status => status.kind !== "lost" || status.reloading !== true)).toEqual(
      []
    );
  });

  it("ends with the heartbeat of the new game", async () => {
    const next = await reconnectedWithoutSessions();
    sendSessions(next, [sessionOf("s-2")]);
    expect(ctx.state.status).toMatchObject({ kind: "lost", reloading: true });

    next.answer(next.last("manifest"), {
      game: "g",
      page: "http://127.0.0.1:3000/",
      embedded: false,
      sources: [],
      commands: []
    });
    await flush();
    beat(next, "s-2", 0);

    expect(ctx.state.status).toEqual({ kind: "live", frame: 0 });
    expect(ctx.state.reload).toBeUndefined();
  });

  it("turns into a plain lost after reloadGraceMs without a heartbeat", async () => {
    ctx = createCtx({ reloadGraceMs: 3000 });
    await reconnectedWithoutSessions();
    vi.advanceTimersByTime(2000);

    expect(ctx.state.status).toEqual({
      kind: "lost",
      reason: "socket_closed",
      lastFrame: 1825,
      retryInMs: 1000
    });
    expect(ctx.state.reload).toBeUndefined();
  });
});

describe("a real loss", () => {
  it("a close 1006 is a plain lost at once", async () => {
    const socket = await liveAt(1825);
    socket.drop(1006);
    expect(ctx.state.status).toEqual({
      kind: "lost",
      reason: "socket_closed",
      lastFrame: 1825,
      retryInMs: 1000
    });
  });

  it("a session closed without bye is a plain lost at once", async () => {
    const socket = await liveAt(40);
    socket.notify("editor", "session", { id: "s-1", game: "g", open: false });
    expect(ctx.state.status).toEqual({
      kind: "lost",
      reason: "game_reloaded",
      lastFrame: 40,
      retryInMs: 1000
    });
  });

  it("expectReload does not turn a loss that happened before it neutral", async () => {
    const socket = await liveAt(40);
    socket.drop(1006);
    expectReload(ctx);
    expect(ctx.state.status).not.toHaveProperty("reloading");
  });

  it("a retry after expectReload keeps a loss of before it plain", async () => {
    const socket = await liveAt(40);
    socket.drop(1006);
    expectReload(ctx);

    // The reconnect fails: the retry applies the loss again.
    vi.advanceTimersByTime(1000);
    latestSocket().drop(1006);

    expect(ctx.state.status).toEqual({
      kind: "lost",
      reason: "socket_closed",
      lastFrame: 40,
      retryInMs: 2000
    });
    expect(emitted().filter(status => status.kind === "lost" && status.reloading === true)).toEqual(
      []
    );
  });

  it("no_boot is never a reload", () => {
    expectReload(ctx);
    onSocketClose(ctx, { code: SERVICE_RESTART, reason: "" });
    ctx.state.boot = undefined;
    createLinkApi(ctx).retry();
    expect(ctx.state.status).toEqual({
      kind: "lost",
      reason: "no_boot",
      lastFrame: 0,
      retryInMs: 0
    });
  });
});

describe("a session that said bye", () => {
  it("reads lost reloading and lives again with the new session", async () => {
    const socket = await liveAt(310);
    socket.notify("editor", "session", { id: "s-1", game: "g", open: false, reason: "bye" });

    expect(ctx.state.status).toEqual({
      kind: "lost",
      reason: "bye",
      lastFrame: 310,
      retryInMs: 1000,
      reloading: true
    });

    sendSessions(socket, [sessionOf("s-2")]);
    socket.answer(socket.last("manifest"), {
      game: "g",
      page: "http://127.0.0.1:3000/",
      embedded: false,
      sources: [],
      commands: []
    });
    await flush();
    beat(socket, "s-2", 311);
    expect(ctx.state.status).toEqual({ kind: "live", frame: 311 });
    expect(ctx.state.reload).toBeUndefined();
  });
});

describe("expectReload (a reload the editor started)", () => {
  it("makes the session close that follows read lost reloading", async () => {
    const socket = await liveAt(1200);
    createLinkApi(ctx).expectReload();
    socket.notify("editor", "session", { id: "s-1", game: "g", open: false });

    expect(ctx.state.status).toMatchObject({
      kind: "lost",
      reason: "game_reloaded",
      lastFrame: 1200,
      reloading: true
    });
  });

  it("a heartbeat of the old page before the close keeps the window open", async () => {
    const socket = await liveAt(1200);
    expectReload(ctx);
    beat(socket, "s-1", 1201);
    socket.notify("editor", "session", { id: "s-1", game: "g", open: false });

    expect(ctx.state.status).toMatchObject({ lastFrame: 1201, reloading: true });
  });

  it("a renewed window waits for its own loss: a beat of the old page does not end it", async () => {
    const socket = await liveAt(88);
    socket.drop(SERVICE_RESTART, "editor restarting");
    vi.advanceTimersByTime(1000);
    const next = latestSocket();
    next.open();
    sendSessions(next, [sessionOf("s-2")]);
    next.answer(next.last("manifest"), {
      game: "g",
      page: "http://127.0.0.1:3000/",
      embedded: false,
      sources: [],
      commands: []
    });
    await flush();
    expect(ctx.state.status).toMatchObject({ kind: "lost", reloading: true });

    // workspace reloads the frame before the game beat again; the old page beats once more.
    expectReload(ctx);
    beat(next, "s-2", 89);
    next.notify("editor", "session", { id: "s-2", game: "g", open: false });

    expect(ctx.state.status).toMatchObject({
      kind: "lost",
      reason: "game_reloaded",
      lastFrame: 89,
      reloading: true
    });
  });

  it("an unused window ends after reloadGraceMs and a later loss is red at once", async () => {
    const socket = await liveAt(1200);
    expectReload(ctx);
    vi.advanceTimersByTime(5000);
    expect(ctx.state.reload).toBeUndefined();
    expect(ctx.state.status).toEqual({ kind: "live", frame: 1200 });

    socket.drop(1006);
    expect(ctx.state.status).not.toHaveProperty("reloading");
  });

  it("does nothing after stop", () => {
    stopLink(ctx);
    expectReload(ctx);
    expect(ctx.state.reload).toBeUndefined();
  });
});

describe("setHotReload (the bin restarts its server)", () => {
  it("a change the bin makes opens the window before the POST", async () => {
    const socket = await liveAt(77);
    ctx.state.hotReload = { hmr: true, owner: "bin" };
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    void requestHotReload(ctx, false);
    expect(ctx.state.reload).toBeDefined();

    socket.drop(1006);
    expect(ctx.state.status).toMatchObject({ kind: "lost", lastFrame: 77, reloading: true });
  });

  it("an ask that changes nothing, or a game's own server, opens no window", async () => {
    await liveAt(77);
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    ctx.state.hotReload = { hmr: true, owner: "bin" };
    void requestHotReload(ctx, true);
    ctx.state.hotReload = { hmr: true, owner: "server" };
    void requestHotReload(ctx, false);
    expect(ctx.state.reload).toBeUndefined();
  });
});

describe("stopLink", () => {
  it("clears the window and its timer", async () => {
    await liveAt(5);
    expectReload(ctx);
    stopLink(ctx);
    expect(ctx.state.reload).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("checkLinkConfig", () => {
  it("accepts a positive reloadGraceMs", () => {
    expect(() => checkLinkConfig(ctx)).not.toThrow();
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("refuses reloadGraceMs %s", value => {
    expect(() => checkLinkConfig(createCtx({ reloadGraceMs: value }))).toThrow(
      "[moku-editor] link.reloadGraceMs is invalid.\n  Use a positive number of milliseconds."
    );
  });
});

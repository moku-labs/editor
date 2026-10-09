import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LinkStatus } from "../../../registry/protocol";
import { linkPlugin } from "../..";
import { createLinkApi } from "../../api";
import { checkLinkConfig, stopLink } from "../../lifecycle";
import { requestHotReload } from "../../server/hot-reload";
import { backoffDelay } from "../../socket/backoff";
import { onSocketClose } from "../../socket/connect";
import { expectReload } from "../../status/reload";
import { type Config, EMPTY_AFTER_LOST_MS } from "../../types";
import {
  BOOT,
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

// ─────────────────────────────────────────────────────────────────────────────
// The default window against the slowest restart of the bin (D-57): its port is
// closed for up to 6 s (closeAll 500 ms + stop 500 ms + the bundler wait 5000 ms).
// link's retries land 1 s, 3 s and 7 s after the close, so the one at 7 s is the
// first that reaches the restarted server.
// ─────────────────────────────────────────────────────────────────────────────

/** The longest time the bin's port is closed in a restart: closeAll, stop and the bundler wait. */
const LONGEST_RESTART_MS = 6000;

/** The manifest of the game after the restart. */
const AFTER_RESTART = {
  game: "g",
  page: "http://127.0.0.1:3000/",
  embedded: false,
  sources: [],
  commands: []
};

/**
 * The config link ships with.
 *
 * @returns The default config of the plugin.
 */
function shippedConfig(): Config {
  const { config } = linkPlugin.spec;
  if (config === undefined) throw new Error("link has no default config");
  return config;
}

/** The tools page: the hello of a retry is fetched relative to it. */
const TOOLS_PAGE = { href: "http://127.0.0.1:3000/__editor/" };

/**
 * A close 1012 under the default config, then a port that stays closed: the socket of the retry
 * at 1 s is refused and the hello of the retry at 3 s fails.
 *
 * @returns Resolves 6999 ms after the close, one ms before the third retry.
 */
async function restartingSlowly(): Promise<void> {
  ctx = createCtx(shippedConfig());
  const socket = await liveAt(1825);
  const hello = vi.fn(async () => {
    throw new TypeError("Failed to fetch");
  });
  vi.stubGlobal("location", TOOLS_PAGE);
  vi.stubGlobal("fetch", hello);
  socket.drop(SERVICE_RESTART, "editor restarting");

  // 1 s: the port is closed, the socket never opens.
  await vi.advanceTimersByTimeAsync(1000);
  latestSocket().drop(1006);
  expect(ctx.state.status).toMatchObject({ retryInMs: 2000 });

  // 3 s: the hello before the next socket fails.
  await vi.advanceTimersByTimeAsync(2000);
  await flush();
  expect(hello).toHaveBeenCalledTimes(1);
  expect(ctx.state.status).toMatchObject({ retryInMs: 4000 });

  await vi.advanceTimersByTimeAsync(3999);
}

/**
 * The retry at 7 s: the server is back, the hello answers and the socket opens.
 *
 * @returns The open socket.
 */
async function reachedAtSevenSeconds(): Promise<FakeWebSocket> {
  vi.stubGlobal("fetch", async () => Response.json({ ws: BOOT.ws, token: BOOT.token }));
  await vi.advanceTimersByTimeAsync(1);
  await flush();
  expect(FakeWebSocket.instances).toHaveLength(3);

  const next = latestSocket();
  next.open();
  return next;
}

describe("the default window and a restart that keeps the port closed for 6 s (D-57)", () => {
  it("still reads reloading when the retry at 7 s reaches the server; no plain lost at all", async () => {
    await restartingSlowly();
    expect(ctx.state.status).toEqual({
      kind: "lost",
      reason: "socket_closed",
      lastFrame: 1825,
      retryInMs: 4000,
      reloading: true
    });

    const next = await reachedAtSevenSeconds();
    sendSessions(next, [sessionOf("s-2")]);
    next.answer(next.last("manifest"), AFTER_RESTART);
    await flush();
    expect(ctx.state.status).toMatchObject({ kind: "lost", lastFrame: 1825, reloading: true });

    beat(next, "s-2", 0);
    expect(ctx.state.status).toEqual({ kind: "live", frame: 0 });
    expect(ctx.state.reload).toBeUndefined();
    expect(emitted().filter(status => status.kind === "lost" && status.reloading !== true)).toEqual(
      []
    );
  });

  it("ends 8 s after the close: a game that is not back by then reads a plain lost", async () => {
    await restartingSlowly();
    const next = await reachedAtSevenSeconds();
    sendSessions(next, []);

    await vi.advanceTimersByTimeAsync(999);
    expect(ctx.state.status).toMatchObject({ kind: "lost", lastFrame: 1825, reloading: true });

    await vi.advanceTimersByTimeAsync(1);
    expect(ctx.state.status).toMatchObject({ kind: "lost", lastFrame: 1825 });
    expect(ctx.state.status).not.toHaveProperty("reloading");
    expect(ctx.state.reload).toBeUndefined();
  });

  it("a bye with no new session: reloading to 8 s, a plain lost to 10 s, then empty", async () => {
    ctx = createCtx(shippedConfig());
    const socket = await liveAt(310);
    socket.notify("editor", "session", { id: "s-1", game: "g", open: false, reason: "bye" });
    sendSessions(socket, []);

    await vi.advanceTimersByTimeAsync(7999);
    expect(ctx.state.status).toMatchObject({ kind: "lost", reloading: true });

    await vi.advanceTimersByTimeAsync(1);
    expect(ctx.state.status).toMatchObject({ kind: "lost" });
    expect(ctx.state.status).not.toHaveProperty("reloading");

    await vi.advanceTimersByTimeAsync(1999);
    expect(ctx.state.status).toMatchObject({ kind: "lost" });

    await vi.advanceTimersByTimeAsync(1);
    expect(ctx.state.status).toEqual({ kind: "empty" });
  });

  it("the default is past the first retry after the longest restart and under EMPTY_AFTER_LOST_MS", () => {
    const { retryMs, reloadGraceMs } = shippedConfig();

    // The retries land at 1 s, 3 s, 7 s, 15 s: the first one after a 6 s restart is at 7 s.
    let retryAt = 0;
    let attempt = 0;
    while (retryAt < LONGEST_RESTART_MS) {
      retryAt += backoffDelay(attempt, retryMs);
      attempt += 1;
    }
    expect(retryAt).toBe(7000);
    expect(reloadGraceMs).toBeGreaterThan(retryAt);

    // A window still open when lost turns into empty would swallow that step.
    expect(reloadGraceMs).toBeLessThan(EMPTY_AFTER_LOST_MS);
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
    vi.advanceTimersByTime(7999);
    expect(ctx.state.reload).toBeDefined();

    vi.advanceTimersByTime(1);
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

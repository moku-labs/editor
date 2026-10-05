// @vitest-environment happy-dom
/* eslint-disable sonarjs/no-clear-text-protocols -- the hub serves plain http on 127.0.0.1 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "../../rpc/calls";
import {
  bootOrigin,
  connect,
  createSocket,
  onSocketClose,
  openSocket,
  reconnect,
  scheduleReconnect,
  socketOrigin
} from "../../socket/connect";
import {
  BOOT,
  connected,
  createCtx,
  FakeWebSocket,
  flush,
  installBoot,
  latestSocket,
  sessionOf,
  type TestCtx
} from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Socket: URL and Origin (R1, R8), open, close, reconnect and the hello refresh
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

/**
 * Every argument the log mock received, as one string.
 *
 * @returns The log trace text.
 */
function logText(): string {
  return JSON.stringify([
    ctx.log.info.mock.calls,
    ctx.log.debug.mock.calls,
    ctx.log.warn.mock.calls,
    ctx.log.error.mock.calls
  ]);
}

describe("createSocket", () => {
  it("passes no second argument without an origin (browser)", () => {
    createSocket("ws://h/ws", undefined);
    expect(latestSocket().url).toBe("ws://h/ws");
    expect(latestSocket().extra).toEqual([]);
  });

  it("passes { headers: { origin } } with an origin (Bun)", () => {
    createSocket("ws://h/ws", "http://h");
    expect(latestSocket().extra).toEqual([{ headers: { origin: "http://h" } }]);
  });
});

describe("bootOrigin", () => {
  it("maps ws to http and wss to https", () => {
    expect(bootOrigin("ws://127.0.0.1:3000/__editor/ws", "http://x/")).toBe(
      "http://127.0.0.1:3000"
    );
    expect(bootOrigin("wss://example.com/__editor/ws", "http://x/")).toBe("https://example.com");
  });

  it("resolves a relative ws against the base", () => {
    expect(bootOrigin("/__editor/ws", "http://127.0.0.1:4000/__editor")).toBe(
      "http://127.0.0.1:4000"
    );
  });
});

describe("openSocket", () => {
  it("opens {ws}?token=…&kind=tools&role=page with the boot page origin outside a browser", () => {
    ctx.state.boot = BOOT;
    openSocket(ctx);

    const socket = latestSocket();
    expect(socket.url).toBe(
      "ws://127.0.0.1:3000/__editor/ws?token=secret-token-1&kind=tools&role=page"
    );
    expect(socket.extra).toEqual([{ headers: { origin: "http://127.0.0.1:3000" } }]);
    expect(ctx.state.socket).toBe(socket);
  });

  it("passes no Origin in a browser (no Bun global) and the page origin under Bun (R8)", () => {
    expect(socketOrigin(BOOT.ws, {})).toBeUndefined();
    expect(socketOrigin(BOOT.ws, { Bun: {} })).toBe("http://127.0.0.1:3000");
    expect(socketOrigin(BOOT.ws)).toBe("http://127.0.0.1:3000");
  });

  it("encodes the token and never logs it", () => {
    ctx.state.boot = { ...BOOT, token: "a b&c" };
    openSocket(ctx);
    expect(latestSocket().url).toContain("token=a%20b%26c&kind=tools");
    expect(ctx.log.info).toHaveBeenCalledWith("link:connect", { ws: BOOT.ws });
    expect(logText()).not.toContain("a b&c");
    expect(logText()).not.toContain("a%20b%26c");
  });

  it("does nothing without a boot", () => {
    openSocket(ctx);
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("schedules a reconnect when the constructor throws, without logging the token", () => {
    vi.stubGlobal(
      "WebSocket",
      class {
        constructor(url: string) {
          throw new SyntaxError(`bad url ${url}`);
        }
      }
    );
    ctx.state.boot = BOOT;
    openSocket(ctx);

    expect(ctx.state.socket).toBeUndefined();
    expect(ctx.state.status).toMatchObject({
      kind: "lost",
      reason: "socket_closed",
      retryInMs: 1000
    });
    expect(ctx.state.retryTimer).toBeDefined();
    expect(logText()).not.toContain(BOOT.token);
  });

  it("open resets the attempt and keeps status connecting", () => {
    ctx.state.boot = BOOT;
    ctx.state.attempt = 3;
    openSocket(ctx);
    latestSocket().open();

    expect(ctx.state.open).toBe(true);
    expect(ctx.state.attempt).toBe(0);
    expect(ctx.state.status).toEqual({ kind: "connecting" });
  });

  it("an error event only logs", () => {
    ctx.state.boot = BOOT;
    openSocket(ctx);
    latestSocket().fail();
    expect(ctx.log.warn).toHaveBeenCalledWith("link:socket-error", { ws: BOOT.ws });
    expect(ctx.state.socket).toBe(latestSocket());
  });

  it("ignores events of a replaced socket", () => {
    ctx.state.boot = BOOT;
    openSocket(ctx);
    const old = latestSocket();
    ctx.state.socket = undefined;
    old.open();
    old.drop();
    expect(ctx.state.open).toBe(false);
    expect(ctx.state.attempt).toBe(0);
  });

  it("drops a binary message with a warning", () => {
    ctx.state.boot = BOOT;
    openSocket(ctx);
    latestSocket().open();
    latestSocket().receiveRaw(new Uint8Array([1, 2]));
    expect(ctx.log.warn).toHaveBeenCalledWith("link:binary-message", {});
  });
});

describe("connect", () => {
  it("reads the boot tag and opens the socket", () => {
    installBoot();
    connect(ctx);
    expect(ctx.state.boot).toEqual(BOOT);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("without a tag logs link:no-boot and goes lost no_boot", () => {
    connect(ctx);
    expect(ctx.log.error).toHaveBeenCalledWith("link:no-boot", { selector: "#moku-editor-boot" });
    expect(ctx.state.status).toEqual({
      kind: "lost",
      reason: "no_boot",
      lastFrame: 0,
      retryInMs: 0
    });
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(ctx.emit).toHaveBeenCalledWith("link:status", { status: ctx.state.status });
  });
});

describe("onSocketClose", () => {
  it("a socket that never opened: lost, pending fail link_closed, hello refresh, new token", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ws: BOOT.ws, token: "fresh-token" }));
    vi.stubGlobal("fetch", fetchMock);
    ctx.state.boot = BOOT;
    openSocket(ctx);
    const first = latestSocket();
    first.fail();
    first.drop(1002);

    expect(ctx.state.open).toBe(false);
    expect(ctx.state.socket).toBeUndefined();
    expect(ctx.state.attempt).toBe(1);
    expect(ctx.state.status).toEqual({
      kind: "lost",
      reason: "socket_closed",
      lastFrame: 0,
      retryInMs: 1000
    });

    await vi.advanceTimersByTimeAsync(1000);
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(latestSocket().url).toContain("token=fresh-token");
    expect(ctx.state.boot?.token).toBe("fresh-token");
  });

  it("a socket that was open: fails pending calls, keeps records, reconnects without hello", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const socket = await connected(ctx);
    const pending = request(ctx, "game", "read", { id: "game.graph" }, "s-1").catch(
      (error: unknown) => error
    );

    socket.drop(1001, "going away");

    expect(await pending).toMatchObject({ code: -32_002, data: { reason: "link_closed" } });
    expect(ctx.state.attempt).toBe(1);
    expect(ctx.state.sessions).toEqual([]);
    expect(ctx.state.chosen).toBe("s-1");
    expect(ctx.state.wire.size).toBe(0);

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("consecutive failures back off: 1000 then 2000", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ ws: BOOT.ws, token: BOOT.token }));
    ctx.state.boot = BOOT;
    openSocket(ctx);
    latestSocket().drop();
    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    latestSocket().drop();
    expect(ctx.state.attempt).toBe(2);
    expect(ctx.state.status).toMatchObject({ kind: "lost", retryInMs: 2000 });
  });

  it("a failed hello schedules the next attempt without opening", async () => {
    vi.stubGlobal("fetch", async () => new Response("down", { status: 503 }));
    ctx.state.boot = BOOT;
    openSocket(ctx);
    latestSocket().drop();
    await vi.advanceTimersByTimeAsync(1000);
    await flush();

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(ctx.state.attempt).toBe(2);
    expect(ctx.state.status).toMatchObject({ kind: "lost", retryInMs: 2000 });
    expect(ctx.state.retryTimer).toBeDefined();
    expect(ctx.log.warn).toHaveBeenCalledWith("link:hello-failed", { path: BOOT.path });
  });

  it("logs the close without the token", () => {
    ctx.state.boot = BOOT;
    openSocket(ctx);
    latestSocket().open();
    onSocketClose(ctx, { code: 1006, reason: "" });
    expect(ctx.log.info).toHaveBeenCalledWith("link:closed", { code: 1006, reason: "" });
    expect(logText()).not.toContain(BOOT.token);
  });
});

describe("reconnect", () => {
  it("does nothing after stop or while a socket exists", () => {
    ctx.state.boot = BOOT;
    ctx.state.stopped = true;
    reconnect(ctx, false);
    expect(FakeWebSocket.instances).toHaveLength(0);

    ctx.state.stopped = false;
    openSocket(ctx);
    reconnect(ctx, false);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("scheduleReconnect replaces a pending timer", () => {
    ctx.state.boot = BOOT;
    ctx.state.attempt = 1;
    scheduleReconnect(ctx, false);
    scheduleReconnect(ctx, false);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("a stale hello answer after a newer socket is dropped", async () => {
    const hello = Promise.withResolvers<Response>();
    vi.stubGlobal("fetch", () => hello.promise);
    ctx.state.boot = BOOT;
    reconnect(ctx, true);
    openSocket(ctx);
    hello.resolve(Response.json({ ws: BOOT.ws, token: "late" }));
    await flush();
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(ctx.state.boot.token).toBe(BOOT.token);
  });
});

describe("re-attach after reconnect", () => {
  it("the same session is preferred and re-attached from the cache", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const socket = await connected(ctx, [sessionOf("s-1")]);
    expect(ctx.state.chosen).toBe("s-1");
    socket.drop(1001);
    await vi.advanceTimersByTimeAsync(1000);

    const next = latestSocket();
    next.open();
    next.notify("editor", "sessions", {
      list: [
        { id: "s-1", game: "g", page: "p", embedded: false, connectedAt: 1000 },
        { id: "s-2", game: "g", page: "p", embedded: false, connectedAt: 9000 }
      ]
    });
    await flush();

    expect(ctx.state.chosen).toBe("s-1");
    expect(next.requests("manifest")).toHaveLength(0);
    expect(ctx.emit).toHaveBeenLastCalledWith("link:status", {
      status: { kind: "connecting" },
      session: "s-1"
    });
  });
});

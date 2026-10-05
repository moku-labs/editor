/* eslint-disable sonarjs/no-clear-text-protocols -- local test URLs */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Json } from "../../../registry/protocol";
import { isResponse, notification, success, toWireValue } from "../../../registry/protocol";
import {
  connect,
  connectInBackground,
  fail,
  onBeat,
  onClose,
  onOpen,
  sendBeat
} from "../../connection/loop";
import type { HelloResponse } from "../../types";
import type { FakeSocket, TestDeps } from "../helpers";
import {
  createDeps,
  deferred,
  flush,
  helloOk,
  helloStatus,
  MANIFEST,
  openDeps,
  requestText
} from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// connect → hello → socket → open, failures with backoff, close, the beat tick.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The FakeSocket the bridge opened at an index.
 *
 * @param deps - The test deps.
 * @param index - Which opened socket.
 * @returns The socket.
 */
function socketAt(deps: TestDeps, index = 0): FakeSocket {
  const opened = deps.net.sockets[index];
  if (opened === undefined) throw new Error(`no socket ${String(index)}`);
  return opened.socket;
}

/**
 * The status kinds emitted so far.
 *
 * @param deps - The test deps.
 * @returns The kinds in order.
 */
function emittedKinds(deps: TestDeps): string[] {
  return deps.emit.mock.calls.map(([payload]) => payload.status.kind);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("connect — happy path", () => {
  it("fetches hello, opens the socket URL, sends hello first and then a heartbeat", async () => {
    const deps = createDeps();

    await connect(deps);

    expect(deps.net.fetches.map(fetched => fetched.url)).toEqual([
      "http://127.0.0.1:3000/__editor/hello"
    ]);
    expect(deps.net.fetches[0]?.init).toMatchObject({
      cache: "no-store",
      credentials: "same-origin"
    });
    expect(deps.net.sockets[0]?.url).toBe("ws://127.0.0.1:3000/__editor/ws?token=t1&kind=agent");
    expect(deps.state.phase).toBe("connecting");

    socketAt(deps).open();

    expect(socketAt(deps).messages()).toEqual([
      notification("game", "hello", { manifest: toWireValue(MANIFEST) }),
      notification("game", "heartbeat", deps.channel.beat)
    ]);
    expect(deps.state.phase).toBe("open");
    expect(deps.state.lastFrame).toBe(12);
    expect(deps.emit).toHaveBeenCalledTimes(1);
    expect(deps.emit).toHaveBeenCalledWith({ status: { kind: "live", frame: 12 } });
    expect(deps.log.info).toHaveBeenCalledWith("bridge:connected", {
      url: "http://127.0.0.1:3000/__editor/hello"
    });
  });

  it("sends the hello origin as a header and a socket option outside a browser", async () => {
    const deps = createDeps({
      config: { hello: "http://127.0.0.1:4000/__editor/hello" },
      page: { href: undefined, document: undefined, window: undefined }
    });

    await connect(deps);

    expect(deps.net.fetches[0]?.init.headers).toEqual({ origin: "http://127.0.0.1:4000" });
    expect(deps.net.sockets[0]?.origin).toBe("http://127.0.0.1:4000");
  });

  it("sends the hello origin in a Bun process even when the page has a document", async () => {
    const deps = createDeps();

    await connect(deps);

    expect(deps.page.document).toBeDefined();
    expect(deps.net.fetches[0]?.init.headers).toEqual({ origin: "http://127.0.0.1:3000" });
    expect(deps.net.sockets[0]?.origin).toBe("http://127.0.0.1:3000");
  });

  it("never logs the token", async () => {
    const deps = createDeps();
    deps.net.answers.push(helloOk({ ws: "/__editor/ws", token: "secret-token" }));

    await connect(deps);
    socketAt(deps).open();
    socketAt(deps).emit("close", { code: 1006, reason: "" });

    const logged = JSON.stringify([
      deps.log.info.mock.calls,
      deps.log.warn.mock.calls,
      deps.log.debug.mock.calls,
      deps.log.error.mock.calls
    ]);
    expect(logged).not.toContain("secret-token");
  });

  it("routes socket messages to the dispatcher", async () => {
    const deps = createDeps();
    await connect(deps);
    socketAt(deps).open();
    socketAt(deps).clear();

    socketAt(deps).emit("message", { data: requestText(1, "read", { id: "game.position" }) });
    await flush();

    expect(socketAt(deps).messages()).toEqual([success(1, { path: "home" })]);
  });

  it("logs a socket error at debug and waits for the close", async () => {
    const deps = createDeps();
    await connect(deps);

    socketAt(deps).emit("error");

    expect(deps.log.debug).toHaveBeenCalledWith("bridge:socket-error", {
      url: "http://127.0.0.1:3000/__editor/hello"
    });
    expect(deps.state.phase).toBe("connecting");
  });

  it("ignores events of a socket that is no longer current", async () => {
    const deps = createDeps();
    await connect(deps);
    const stale = socketAt(deps);
    deps.state.socket = undefined;

    stale.open();
    stale.emit("message", { data: requestText(1, "manifest") });
    stale.emit("close", { code: 1000, reason: "" });
    await flush();

    expect(stale.sent).toEqual([]);
    expect(deps.state.phase).toBe("connecting");
  });
});

describe("connect — failures", () => {
  it("404: lost with a retry after 1000 ms, then 2000 ms; warn once, then debug", async () => {
    const deps = createDeps();
    deps.net.answers.push(helloStatus(404), helloStatus(404));

    await connect(deps);

    expect(deps.state.phase).toBe("lost");
    expect(deps.emit).toHaveBeenLastCalledWith({
      status: { kind: "lost", reason: "hello 404", lastFrame: 0, retryInMs: 1000 }
    });
    expect(deps.log.warn).toHaveBeenCalledWith("bridge:lost", {
      reason: "hello 404",
      retryInMs: 1000
    });

    await vi.advanceTimersByTimeAsync(999);
    expect(deps.net.fetches).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(deps.net.fetches).toHaveLength(2);

    expect(deps.emit).toHaveBeenLastCalledWith({
      status: { kind: "lost", reason: "hello 404", lastFrame: 0, retryInMs: 2000 }
    });
    expect(emittedKinds(deps)).toEqual(["lost", "connecting", "lost"]);
    expect(deps.log.warn).toHaveBeenCalledTimes(1);
    expect(deps.log.debug).toHaveBeenCalledWith("bridge:lost", {
      reason: "hello 404",
      retryInMs: 2000
    });
  });

  it("no WebSocket: lost for good, retryInMs 0, no timer, no fetch", async () => {
    vi.stubGlobal("WebSocket", undefined);
    const deps = createDeps();

    await connect(deps);

    expect(deps.state.status).toEqual({
      kind: "lost",
      reason: "no WebSocket in this runtime",
      lastFrame: 0,
      retryInMs: 0
    });
    expect(vi.getTimerCount()).toBe(0);
    expect(deps.net.fetches).toEqual([]);
    expect(deps.log.error).toHaveBeenCalledWith("bridge:disabled", {
      reason: "no WebSocket in this runtime"
    });
  });

  it("a relative hello without a page URL: lost for good", async () => {
    const deps = createDeps({ page: { href: undefined, document: undefined, window: undefined } });

    await connect(deps);

    expect(deps.state.status).toMatchObject({
      kind: "lost",
      reason: "no page URL for /__editor/hello",
      retryInMs: 0
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ["a network error", new TypeError("fetch failed"), "hello unreachable"],
    ["a body without token", helloOk({ ws: "/x" }), "hello answered without ws and token"],
    ["a bad ws URL", helloOk({ ws: "ftp://x/y", token: "t" }), "hello answered a bad ws URL"]
  ])("%s: lost with a retry", async (_name, answer: HelloResponse | Error, reason) => {
    const deps = createDeps();
    deps.net.answers.push(answer);

    await connect(deps);

    expect(deps.state.status).toEqual({ kind: "lost", reason, lastFrame: 0, retryInMs: 1000 });
    expect(vi.getTimerCount()).toBe(1);
  });

  it("a socket constructor that throws: lost with a retry", async () => {
    const deps = createDeps();
    deps.net.socketError = new SyntaxError("bad url");

    await connect(deps);

    expect(deps.state.status).toMatchObject({ kind: "lost", reason: "socket failed" });
    expect(deps.state.socket).toBeUndefined();
  });

  it("stop during the hello fetch opens no socket", async () => {
    const deps = createDeps();
    const hello = deferred<HelloResponse>();
    deps.net.answers.push(hello.promise);

    const connecting = connect(deps);
    deps.state.phase = "stopped";
    hello.resolve(helloOk());
    await connecting;

    expect(deps.net.sockets).toEqual([]);
    expect(deps.state.phase).toBe("stopped");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does nothing once stopped", async () => {
    const deps = createDeps();
    deps.state.phase = "stopped";

    await connect(deps);

    expect(deps.net.fetches).toEqual([]);
  });

  it("open resets the failure streak", async () => {
    const deps = createDeps();
    deps.net.answers.push(helloStatus(404));
    await connect(deps);
    expect(deps.state.attempt).toBe(1);

    await vi.advanceTimersByTimeAsync(1000);
    socketAt(deps).open();

    expect(deps.state.attempt).toBe(0);
    expect(deps.state.failureLogged).toBe(false);
    expect(deps.state.retryTimer).toBeUndefined();
    expect(deps.state.phase).toBe("open");
  });

  it("logs a crash of connect", async () => {
    const deps = createDeps();
    deps.state.status = { kind: "lost", reason: "x", lastFrame: 0, retryInMs: 0 };
    deps.emit.mockImplementation(() => {
      throw new Error("hook broke");
    });

    connectInBackground(deps);
    await flush();

    expect(deps.log.error).toHaveBeenCalledWith(
      "bridge:connect-crashed",
      undefined,
      new Error("hook broke")
    );
  });
});

describe("onClose and fail", () => {
  it("drops subs, pending values, inflight timers and the session, then reconnects", async () => {
    const deps = createDeps();
    await connect(deps);
    socketAt(deps).open();
    deps.state.session = "s-1";
    const stop = vi.fn();
    deps.state.subs.set(1, {
      sub: 1,
      id: "game.position",
      input: undefined,
      changes: "edge",
      stop,
      lastSent: undefined
    });
    deps.state.pending.set(1, 5);
    deps.state.inflight.set(
      7,
      setTimeout(() => {}, 10_000)
    );

    socketAt(deps).emit("close", { code: 1006, reason: "" });

    expect(stop).toHaveBeenCalledOnce();
    expect(deps.state.subs.size).toBe(0);
    expect(deps.state.pending.size).toBe(0);
    expect(deps.state.inflight.size).toBe(0);
    expect(deps.state.session).toBeUndefined();
    expect(deps.state.socket).toBeUndefined();
    expect(deps.state.status).toEqual({
      kind: "lost",
      reason: "socket closed (1006)",
      lastFrame: 12,
      retryInMs: 1000
    });
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(1000);

    expect(deps.net.fetches).toHaveLength(2);
    expect(deps.net.sockets).toHaveLength(2);
  });

  it("names the close code and the hub's reason", () => {
    const { deps } = openDeps();

    onClose(deps, 1008, "hello first");

    expect(deps.state.status).toMatchObject({ reason: "socket closed (1008): hello first" });
  });

  it("logs a 1012 restart close at info, not warn, and reconnects as after any close (U11)", async () => {
    const deps = createDeps();
    await connect(deps);
    socketAt(deps).open();

    socketAt(deps).emit("close", { code: 1012, reason: "editor restarting" });

    expect(deps.log.info).toHaveBeenCalledWith("bridge:lost", {
      reason: "socket closed (1012): editor restarting",
      retryInMs: 1000
    });
    expect(deps.log.warn).not.toHaveBeenCalled();
    expect(deps.state.status).toMatchObject({
      kind: "lost",
      reason: "socket closed (1012): editor restarting",
      retryInMs: 1000
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(deps.net.fetches).toHaveLength(2);
    expect(deps.net.sockets).toHaveLength(2);
  });

  it("logs the failures after a 1012 close at debug: the restart opened the streak", async () => {
    const deps = createDeps();
    await connect(deps);
    socketAt(deps).open();
    deps.net.answers.push(helloStatus(503));

    socketAt(deps).emit("close", { code: 1012, reason: "editor restarting" });
    await vi.advanceTimersByTimeAsync(1000);

    expect(deps.log.warn).not.toHaveBeenCalled();
    expect(deps.log.debug).toHaveBeenCalledWith("bridge:lost", {
      reason: "hello 503",
      retryInMs: 2000
    });
  });

  it("still warns on any other close", () => {
    const { deps } = openDeps();

    onClose(deps, 1001, "editor stopping");

    expect(deps.log.warn).toHaveBeenCalledWith("bridge:lost", {
      reason: "socket closed (1001): editor stopping",
      retryInMs: expect.any(Number)
    });
  });

  it("does nothing more once stopped", () => {
    const { deps } = openDeps();
    deps.state.phase = "stopped";

    fail(deps, "socket closed (1000)", true);

    expect(deps.state.phase).toBe("stopped");
    expect(deps.state.socket).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    expect(deps.emit).not.toHaveBeenCalled();
  });

  it("without retry: lost for good and logged as an error", () => {
    const { deps } = openDeps();
    deps.state.lastFrame = 9;

    fail(deps, "no WebSocket in this runtime", false);

    expect(deps.state.status).toEqual({
      kind: "lost",
      reason: "no WebSocket in this runtime",
      lastFrame: 9,
      retryInMs: 0
    });
    expect(deps.log.error).toHaveBeenCalledWith("bridge:disabled", {
      reason: "no WebSocket in this runtime"
    });
  });
});

describe("onOpen, sendBeat and onBeat", () => {
  it("onOpen announces paused when the game is paused", () => {
    const { deps, socket } = openDeps();
    deps.state.phase = "connecting";
    deps.channel.beat = { frame: 30, paused: true, at: 5 };

    onOpen(deps);

    expect(socket.messages()[1]).toEqual(
      notification("game", "heartbeat", { frame: 30, paused: true, at: 5 })
    );
    expect(deps.emit).toHaveBeenCalledWith({ status: { kind: "paused", frame: 30 } });
  });

  it("sendBeat sends the beat and records its frame", () => {
    const { deps, socket } = openDeps();

    sendBeat(deps, { frame: 44, paused: false, at: 9 });

    expect(socket.messages()).toEqual([
      notification("game", "heartbeat", { frame: 44, paused: false, at: 9 })
    ]);
    expect(deps.state.lastFrame).toBe(44);
  });

  it("onBeat beats, flips the status kind, flushes the backlog and samples frame sources", async () => {
    const { deps, socket } = openDeps();
    deps.state.status = { kind: "live", frame: 12 };
    deps.state.subs.set(3, {
      sub: 3,
      id: "game.render",
      input: undefined,
      changes: "frame",
      stop: undefined,
      lastSent: JSON.stringify({ fps: 30 })
    });
    deps.state.pending.set(9, "late");

    onBeat(deps, { frame: 50, paused: true, at: 1 });
    await flush();

    const sent = socket.messages().filter(message => !isResponse(message));
    expect(sent).toEqual([
      notification("game", "heartbeat", { frame: 50, paused: true, at: 1 }),
      notification("game", "value", { sub: 9, value: "late" }),
      notification("game", "value", { sub: 3, value: { fps: 60 } as Json })
    ]);
    expect(deps.emit).toHaveBeenCalledWith({ status: { kind: "paused", frame: 50 } });
  });

  it("onBeat does nothing while not open", () => {
    const { deps, socket } = openDeps();
    deps.state.phase = "lost";

    onBeat(deps, { frame: 50, paused: false, at: 1 });

    expect(socket.sent).toEqual([]);
    expect(deps.state.lastFrame).toBe(0);
  });
});

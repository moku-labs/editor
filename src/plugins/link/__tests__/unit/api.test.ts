// @vitest-environment happy-dom
/* eslint-disable unicorn/no-null -- null is a JSON value on the wire */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tap } from "../../../registry/protocol";
import { isRetryable, toWireValue } from "../../../registry/protocol";
import { createLinkApi } from "../../api";
import { connect } from "../../socket/connect";
import {
  BOOT,
  beat,
  connected,
  createCtx,
  FakeWebSocket,
  flush,
  installBoot,
  latestSocket,
  manifestOf,
  sendSessions,
  sessionOf,
  type TestCtx
} from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The link api over a mock ctx and the fake socket
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

describe("read and run", () => {
  it("reject -32003 no_session before attach, not retryable", async () => {
    const link = createLinkApi(ctx);
    for (const call of [link.read("game.graph"), link.run("game.step", { frames: 1 })]) {
      const error: unknown = await call.catch((error_: unknown) => error_);
      expect(error).toBeInstanceOf(Error);
      expect(error).toMatchObject({
        code: -32_003,
        message: "[moku-editor] No game is connected.",
        data: { reason: "no_session", retryable: false }
      });
      expect(isRetryable(error)).toBe(false);
    }
  });

  it("read sends { id, input? } with the session and resolves the result", async () => {
    const socket = await connected(ctx);
    const link = createLinkApi(ctx);
    const graph = link.read("game.graph");
    link.read("game.history", { last: 20 }).catch(() => undefined);
    const [first, second] = socket.requests("read");
    expect(first).toMatchObject({ channel: "game", params: { id: "game.graph" }, session: "s-1" });
    expect(second?.params).toEqual({ id: "game.history", input: { last: 20 } });
    if (first === undefined) throw new Error("missing");
    socket.answer(first, { nodes: [] });
    await expect(graph).resolves.toEqual({ nodes: [] });
  });

  it("run resolves a checked RunResult and rejects a bad shape", async () => {
    const socket = await connected(ctx);
    const link = createLinkApi(ctx);
    const ran = link.run("game.step", { frames: 1 });
    socket.answer(socket.last("run"), {
      value: null,
      state: { path: "board", frame: 1841, tainted: false }
    });
    await expect(ran).resolves.toEqual({
      value: null,
      state: { path: "board", frame: 1841, tainted: false }
    });

    const bad = link.run("game.step").catch((error: unknown) => error);
    expect(socket.last("run").params).toEqual({ id: "game.step" });
    socket.answer(socket.last("run"), { value: 1 });
    expect(await bad).toMatchObject({ code: -32_600 });
  });

  it("run of editor.series waits CALL_TIMEOUT_MS + durationMs", async () => {
    await connected(ctx);
    const link = createLinkApi(ctx);
    const series = link
      .run("editor.series", { durationMs: 20_000, intervalMs: 100 })
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(ctx.state.pending.size).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await series).toMatchObject({ code: -32_002, data: { reason: "timeout" } });
  });
});

describe("state readers", () => {
  it("status() is a copy of the current status", async () => {
    const link = createLinkApi(ctx);
    const status = link.status();
    expect(status).toEqual({ kind: "connecting" });
    expect(status).not.toBe(ctx.state.status);
  });

  it("manifest, sessions and session follow the attach", async () => {
    const link = createLinkApi(ctx);
    expect(link.manifest()).toBeUndefined();
    expect(link.sessions()).toEqual([]);
    expect(link.session()).toBeUndefined();

    await connected(ctx);
    expect(link.manifest()).toEqual(manifestOf());
    expect(link.sessions()).toEqual([sessionOf("s-1")]);
    expect(link.sessions()).not.toBe(ctx.state.sessions);
    expect(link.session()).toBe("s-1");
  });

  it("boot() returns the parsed tag, undefined without it", () => {
    const link = createLinkApi(ctx);
    connect(ctx);
    expect(link.boot()).toBeUndefined();

    const other = createCtx();
    installBoot();
    connect(other);
    expect(createLinkApi(other).boot()).toEqual(BOOT);
  });
});

describe("frameUrl and isOtherTab", () => {
  it("frameUrl tags a game URL with the frame id of this tools page", () => {
    const link = createLinkApi(ctx);
    const url = link.frameUrl("http://127.0.0.1:3000/");
    expect(url).toBe(`http://127.0.0.1:3000/?__editorFrame=${ctx.state.frame}`);
    expect(link.frameUrl("http://127.0.0.1:3000/")).toBe(url);
    expect(createLinkApi(createCtx()).frameUrl("http://127.0.0.1:3000/")).not.toBe(url);
  });

  it("isOtherTab is true only for a page tagged by another tools page", () => {
    const link = createLinkApi(ctx);
    const theirs = createLinkApi(createCtx()).frameUrl("http://127.0.0.1:3000/");
    expect(link.isOtherTab(theirs)).toBe(true);
    expect(link.isOtherTab(link.frameUrl("http://127.0.0.1:3000/"))).toBe(false);
    expect(link.isOtherTab("http://127.0.0.1:3000/")).toBe(false);
  });
});

describe("onManifest", () => {
  it("calls at once when a manifest exists, then on every change, until unsubscribed", async () => {
    const socket = await connected(ctx);
    const link = createLinkApi(ctx);
    const seen: unknown[] = [];
    const stop = link.onManifest(manifest => seen.push(manifest?.sources.length));
    expect(seen).toEqual([2]);

    socket.notify("editor", "session", { id: "s-1", game: "g", open: false });
    expect(seen).toEqual([2, undefined]);

    stop();
    sendSessions(socket, [sessionOf("s-2")]);
    socket.answer(socket.last("manifest"), toWireValue(manifestOf(["a"])));
    await flush();
    expect(seen).toEqual([2, undefined]);
  });

  it("does not call at once without a manifest; a throwing listener is logged", async () => {
    const link = createLinkApi(ctx);
    const fn = vi.fn(() => {
      throw new Error("palette broke");
    });
    link.onManifest(fn);
    expect(fn).not.toHaveBeenCalled();

    await connected(ctx);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(ctx.log.error).toHaveBeenCalledWith(
      "link:manifest-listener-failed",
      {},
      new Error("palette broke")
    );
  });
});

describe("onTap", () => {
  it("passes every tap of the chosen session until unsubscribed", async () => {
    const socket = await connected(ctx);
    const link = createLinkApi(ctx);
    const taps: Tap[] = [];
    const stop = link.onTap(tap => taps.push(tap));

    socket.notify("game", "tap", { x: 206, y: 640, at: 15_234.5 }, "s-1");
    stop();
    stop();
    socket.notify("game", "tap", { x: 1, y: 2, at: 3 }, "s-1");

    expect(taps).toEqual([{ x: 206, y: 640, at: 15_234.5 }]);
  });

  it("the same listener added twice is called twice; a throwing listener is logged", async () => {
    const socket = await connected(ctx);
    const link = createLinkApi(ctx);
    const seen = vi.fn();
    link.onTap(() => {
      throw new Error("ripple broke");
    });
    link.onTap(seen);
    link.onTap(seen);

    socket.notify("game", "tap", { x: 1, y: 2, at: 3 }, "s-1");

    expect(seen).toHaveBeenCalledTimes(2);
    expect(seen).toHaveBeenCalledWith({ x: 1, y: 2, at: 3 });
    expect(ctx.log.error).toHaveBeenCalledWith(
      "link:tap-listener-failed",
      {},
      new Error("ripple broke")
    );
  });
});

describe("heap", () => {
  const heap = { usedMb: 12.8, limitMb: 4095.8 };

  it("is undefined until a heartbeat reports it, then a copy of the last one", async () => {
    const socket = await connected(ctx);
    const link = createLinkApi(ctx);
    expect(link.heap()).toBeUndefined();

    beat(socket, "s-1", 1);
    expect(link.heap()).toBeUndefined();

    socket.notify("game", "heartbeat", { frame: 2, paused: false, at: 2, heap }, "s-1");
    expect(link.heap()).toEqual(heap);
    expect(link.heap()).not.toBe(ctx.state.heartbeat?.heap);
  });

  it("is undefined again after the chosen session changes", async () => {
    const socket = await connected(ctx, [sessionOf("s-1"), sessionOf("s-2")]);
    const link = createLinkApi(ctx);
    socket.notify("game", "heartbeat", { frame: 2, paused: false, at: 2, heap }, "s-1");
    socket.notify(
      "game",
      "heartbeat",
      { frame: 9, paused: false, at: 9, heap: { usedMb: 1, limitMb: 2 } },
      "s-2"
    );
    expect(link.heap()).toEqual(heap);

    const chosen = link.choose("s-2");
    socket.answer(socket.last("manifest"), toWireValue(manifestOf()));
    await chosen;

    expect(link.session()).toBe("s-2");
    expect(link.heap()).toBeUndefined();
  });

  it("is undefined again after the chosen session closes", async () => {
    const socket = await connected(ctx);
    const link = createLinkApi(ctx);
    socket.notify("game", "heartbeat", { frame: 2, paused: false, at: 2, heap }, "s-1");

    socket.notify("editor", "session", { id: "s-1", game: "g", open: false });

    expect(link.heap()).toBeUndefined();
  });
});

describe("choose", () => {
  it("rejects choose_session for an id that is not open", async () => {
    const link = createLinkApi(ctx);
    const error: unknown = await link.choose("s-x").catch((error_: unknown) => error_);
    expect(error).toMatchObject({
      code: -32_003,
      message: '[moku-editor] Session "s-x" is not open.',
      data: { reason: "choose_session", retryable: false }
    });
  });

  it("makes the choice sticky and resolves with its manifest", async () => {
    const socket = await connected(ctx, [sessionOf("s-1", { embedded: true }), sessionOf("s-2")]);
    const link = createLinkApi(ctx);
    const choosing = link.choose("s-2");
    socket.answer(socket.last("manifest"), toWireValue(manifestOf(["only.one"])));

    await expect(choosing).resolves.toEqual(manifestOf(["only.one"]));
    expect(ctx.state.sticky).toBe(true);
    expect(link.session()).toBe("s-2");

    sendSessions(socket, [sessionOf("s-1", { embedded: true }), sessionOf("s-2")]);
    expect(link.session()).toBe("s-2");
  });

  it("choosing the attached session only makes it sticky", async () => {
    const socket = await connected(ctx);
    const link = createLinkApi(ctx);
    await expect(link.choose("s-1")).resolves.toEqual(manifestOf());
    expect(ctx.state.sticky).toBe(true);
    expect(socket.requests("manifest")).toHaveLength(1);
  });
});

describe("retry", () => {
  it("cancels the reconnect timer and reconnects now", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ ws: BOOT.ws, token: "t2" }));
    const socket = await connected(ctx);
    socket.drop();
    expect(vi.getTimerCount()).toBe(1);

    createLinkApi(ctx).retry();
    await flush();

    expect(vi.getTimerCount()).toBe(0);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(latestSocket().url).toContain("token=t2");
  });

  it("re-reads the boot tag after no_boot", () => {
    const link = createLinkApi(ctx);
    connect(ctx);
    expect(ctx.state.status).toMatchObject({ kind: "lost", reason: "no_boot" });

    link.retry();
    expect(FakeWebSocket.instances).toHaveLength(0);

    installBoot();
    link.retry();
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(link.boot()).toEqual(BOOT);
  });

  it("re-picks a session now when only the session was lost", async () => {
    const socket = await connected(ctx);
    socket.notify("editor", "session", { id: "s-1", game: "g", open: false });
    ctx.state.sessions = [sessionOf("s-5")];

    createLinkApi(ctx).retry();
    expect(ctx.state.chosen).toBe("s-5");
  });

  it("is a no-op while connecting, live or empty, and after stop", async () => {
    const link = createLinkApi(ctx);
    const socket = await connected(ctx);
    link.retry();
    socket.notify("game", "heartbeat", { frame: 1, paused: false, at: 0 }, "s-1");
    link.retry();
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(ctx.state.chosen).toBe("s-1");

    ctx.state.stopped = true;
    socket.drop();
    link.retry();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});

describe("watch and files", () => {
  it("watch is accepted while disconnected and files is a FilesClient", () => {
    const link = createLinkApi(ctx);
    const stop = link.watch("game.position", undefined, vi.fn());
    expect(ctx.state.subs.size).toBe(1);
    stop();
    expect(ctx.state.subs.size).toBe(0);
    expect(typeof link.files.readBinary).toBe("function");
  });
});

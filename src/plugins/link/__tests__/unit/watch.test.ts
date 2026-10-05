/* eslint-disable unicorn/no-null -- null is a JSON value on the wire */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Manifest } from "../../../registry/protocol";
import { toWireValue } from "../../../registry/protocol";
import { stopLink } from "../../lifecycle";
import { attach } from "../../sessions/choose";
import { addManifestListener } from "../../sessions/manifest";
import { addWatch, deliver, detachAll } from "../../subscriptions/watch";
import {
  connected,
  createCtx,
  FakeWebSocket,
  flush,
  latestSocket,
  manifestOf,
  sendSessions,
  sessionOf,
  type TestCtx
} from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Watches: kept while disconnected, numeric never-reused wire subs (R4, R6)
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
});

describe("addWatch", () => {
  it("a watch before attach is sent on attach with a numeric sub", async () => {
    const seen: unknown[] = [];
    addWatch(ctx, "game.history", { last: 20 }, value => seen.push(value));
    addWatch(ctx, "game.position", undefined, vi.fn());
    expect(ctx.state.subs.size).toBe(2);

    const socket = await connected(ctx);
    const watches = socket.requests("watch");
    expect(watches.map(watch => watch.params)).toEqual([
      { sub: 1, id: "game.history", input: { last: 20 } },
      { sub: 2, id: "game.position" }
    ]);
    expect(watches.every(watch => watch.session === "s-1")).toBe(true);

    socket.notify("game", "value", { sub: 1, value: [1, 2] }, "s-1");
    expect(seen).toEqual([[1, 2]]);
  });

  it("an attached watch is sent at once", async () => {
    const socket = await connected(ctx);
    addWatch(ctx, "game.position", null, vi.fn());
    expect(socket.last("watch").params).toEqual({ sub: 1, id: "game.position", input: null });
  });

  it("a re-attach uses new subs; values of the old sub are dropped", async () => {
    const seen: unknown[] = [];
    const socket = await connected(ctx);
    addWatch(ctx, "game.position", undefined, value => seen.push(value));
    socket.notify("editor", "session", { id: "s-1", game: "g", open: false });
    sendSessions(socket, [sessionOf("s-2")]);
    socket.answer(socket.last("manifest"), toWireValue(manifestOf()));
    await flush();

    expect(socket.last("watch")).toMatchObject({ params: { sub: 2 }, session: "s-2" });
    socket.notify("game", "value", { sub: 1, value: "old" }, "s-2");
    socket.notify("game", "value", { sub: 2, value: "new" }, "s-2");
    expect(seen).toEqual(["new"]);
    expect(ctx.state.nextSub).toBe(3);
  });

  it("a voluntary switch unwatches the old subs on the old session", async () => {
    const socket = await connected(ctx, [sessionOf("s-1"), sessionOf("s-2", { connectedAt: 1 })]);
    addWatch(ctx, "game.position", undefined, vi.fn());
    const switching = attach(ctx, "s-2");
    socket.answer(socket.last("manifest"), toWireValue(manifestOf()));
    await switching;

    expect(socket.last("unwatch")).toMatchObject({ params: { sub: 1 }, session: "s-1" });
    expect(socket.last("watch")).toMatchObject({ params: { sub: 2 }, session: "s-2" });
  });

  it("unsubscribe sends unwatch once and forgets the record", async () => {
    const socket = await connected(ctx);
    const stop = addWatch(ctx, "game.position", undefined, vi.fn());
    stop();
    stop();
    expect(socket.requests("unwatch")).toHaveLength(1);
    expect(socket.last("unwatch").params).toEqual({ sub: 1 });
    expect(ctx.state.subs.size).toBe(0);
    expect(ctx.state.wire.size).toBe(0);
  });

  it("unsubscribe while disconnected sends nothing", () => {
    const stop = addWatch(ctx, "game.position", undefined, vi.fn());
    stop();
    expect(ctx.state.subs.size).toBe(0);
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("a source missing from the manifest is skipped with a warning and kept", async () => {
    addWatch(ctx, "game.nope", undefined, vi.fn());
    const socket = await connected(ctx);
    expect(socket.requests("watch")).toHaveLength(0);
    expect(ctx.log.warn).toHaveBeenCalledWith("link:source-missing", { id: "game.nope" });
    expect(ctx.state.subs.size).toBe(1);
  });

  it("a watch error logs link:watch-failed, keeps the record and retries on the next attach", async () => {
    const socket = await connected(ctx);
    addWatch(ctx, "game.position", undefined, vi.fn());
    socket.reject(socket.last("watch"), {
      code: -32_601,
      message: "[moku-editor] unknown id",
      data: { reason: "unknown_id", retryable: false }
    });
    await flush();

    expect(ctx.log.error).toHaveBeenCalledWith("link:watch-failed", {
      id: "game.position",
      code: -32_601,
      reason: "unknown_id"
    });
    expect(ctx.state.subs.size).toBe(1);
    expect(ctx.state.wire.size).toBe(0);

    const again = attach(ctx, "s-1");
    await again;
    expect(socket.last("watch").params).toMatchObject({ sub: 2, id: "game.position" });
  });

  it("a watch the hub refuses with no_session (the session just closed) logs at debug and retries on the next attach", async () => {
    const socket = await connected(ctx);
    addWatch(ctx, "game.position", undefined, vi.fn());
    socket.reject(socket.last("watch"), {
      code: -32_003,
      message: "[moku-editor] no session",
      data: { reason: "no_session", retryable: false }
    });
    await flush();

    expect(ctx.log.error).not.toHaveBeenCalled();
    expect(ctx.log.debug).toHaveBeenCalledWith("link:watch-deferred", {
      id: "game.position",
      code: -32_003,
      reason: "no_session"
    });
    expect(ctx.state.subs.size).toBe(1);

    await attach(ctx, "s-1");
    expect(socket.last("watch").params).toMatchObject({ sub: 2, id: "game.position" });
  });

  it("a watch in flight at stop logs no error: the link closed it itself", async () => {
    const socket = await connected(ctx);
    addWatch(ctx, "game.position", undefined, vi.fn());
    expect(socket.requests("watch")).toHaveLength(1);
    stopLink(ctx);
    await flush();

    expect(ctx.log.error).not.toHaveBeenCalled();
    expect(ctx.state.wire.size).toBe(0);
  });

  it("an unwatch failure is logged at debug", async () => {
    const socket = await connected(ctx);
    const stop = addWatch(ctx, "game.position", undefined, vi.fn());
    stop();
    socket.reject(socket.last("unwatch"), { code: -32_600, message: "[moku-editor] x" });
    await flush();
    expect(ctx.log.debug).toHaveBeenCalledWith("link:unwatch-failed", { sub: 1, code: -32_600 });
  });
});

/**
 * A manifest whose game.effects source the game does not have.
 *
 * @returns The manifest: game.position available, game.effects not installed.
 */
function withoutEffects(): Manifest {
  const manifest = manifestOf(["game.position"]);
  return {
    ...manifest,
    sources: [
      ...manifest.sources,
      {
        id: "game.effects",
        title: "Effects",
        input: {},
        changes: "frame",
        available: false,
        reason: "app.effects is undefined"
      }
    ]
  };
}

/** The -32008 answer of a source the game does not have. */
const NOT_INSTALLED = {
  code: -32_008,
  message:
    "[moku-editor] source game.effects is not available in this game: app.effects is undefined",
  data: { reason: "not_installed" as const, retryable: false, id: "game.effects" }
};

describe("a source the game does not have (-32008 not_installed)", () => {
  it("a refused watch logs no link:watch-failed and is not retried on the next attach", async () => {
    const socket = await connected(ctx, [sessionOf("s-1")], manifestOf(["game.effects"]));
    addWatch(ctx, "game.effects", undefined, vi.fn());
    socket.reject(socket.last("watch"), NOT_INSTALLED);
    await flush();

    expect(ctx.log.error).not.toHaveBeenCalled();
    expect(ctx.log.warn).not.toHaveBeenCalled();
    expect(ctx.log.debug).toHaveBeenCalledWith("link:source-unavailable", {
      id: "game.effects",
      code: -32_008,
      reason: "not_installed"
    });
    expect(ctx.state.wire.size).toBe(0);
    expect(ctx.state.subs.size).toBe(1);

    await attach(ctx, "s-1");
    expect(socket.requests("watch")).toHaveLength(1);
  });

  it("a new session gets the refused watch again", async () => {
    const socket = await connected(ctx, [sessionOf("s-1")], withoutEffects());
    addWatch(ctx, "game.effects", undefined, vi.fn());
    socket.reject(socket.last("watch"), NOT_INSTALLED);
    await flush();
    socket.notify("editor", "session", { id: "s-1", game: "g", open: false });
    sendSessions(socket, [sessionOf("s-2")]);
    socket.answer(socket.last("manifest"), toWireValue(manifestOf(["game.effects"])));
    await flush();

    expect(socket.last("watch")).toMatchObject({
      params: { id: "game.effects" },
      session: "s-2"
    });
  });
});

describe("a watch added by a manifest listener", () => {
  it("is sent once per attach, and a reconnect re-sends it once", async () => {
    let stop: (() => void) | undefined;
    addManifestListener(ctx, manifest => {
      if (manifest === undefined || stop !== undefined) return;
      stop = addWatch(ctx, "game.position", undefined, vi.fn());
    });

    const socket = await connected(ctx);
    expect(socket.requests("watch").map(watch => watch.params)).toEqual([
      { sub: 1, id: "game.position" }
    ]);
    expect([...ctx.state.wire.keys()]).toEqual([1]);

    socket.drop(1001);
    await vi.advanceTimersByTimeAsync(1000);
    const next = latestSocket();
    next.open();
    sendSessions(next, [sessionOf("s-1")]);
    await flush();

    expect(next).not.toBe(socket);
    expect(next.requests("watch").map(watch => watch.params)).toEqual([
      { sub: 2, id: "game.position" }
    ]);
    expect([...ctx.state.wire.keys()]).toEqual([2]);
  });
});

describe("deliver and detachAll", () => {
  it("a throwing onValue is logged and does not break delivery", async () => {
    const socket = await connected(ctx);
    addWatch(ctx, "game.position", undefined, () => {
      throw new Error("panel broke");
    });
    deliver(ctx, 1, "x");
    expect(ctx.log.error).toHaveBeenCalledWith(
      "link:on-value-failed",
      { id: "game.position" },
      new Error("panel broke")
    );
    expect(socket.requests("watch")).toHaveLength(1);
  });

  it("detachAll clears the wire and every wireSub but keeps the records", async () => {
    await connected(ctx);
    addWatch(ctx, "game.position", undefined, vi.fn());
    detachAll(ctx);
    expect(ctx.state.wire.size).toBe(0);
    expect([...ctx.state.subs.values()].map(sub => sub.wireSub)).toEqual([undefined]);
    expect(latestSocket().requests("unwatch")).toHaveLength(0);
  });
});

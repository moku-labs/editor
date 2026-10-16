import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLinkApi } from "../../api";
import { stopLink } from "../../lifecycle";
import { readEngine } from "../../server/engine";
import { connected, createCtx, FakeWebSocket, latestSocket, type TestCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The computer's engine fingerprint on the tools page: the hub's editor.engine
// notification is kept across reconnects; its replay calls no listener.
// ─────────────────────────────────────────────────────────────────────────────

const ENGINE = { id: "0.14.13+1ab7f2", version: "0.14.13", dist: "1ab7f2c0" };

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

/**
 * Drops the socket and lets the reconnect open a new one.
 *
 * @returns The new open socket.
 */
async function reconnect(): Promise<FakeWebSocket> {
  socket.drop();
  await vi.advanceTimersByTimeAsync(1000);
  const next = latestSocket();
  expect(next).not.toBe(socket);
  next.open();
  socket = next;
  return next;
}

describe("readEngine", () => {
  it("reads the id of an EngineInfo, null for unknown, undefined for anything else", () => {
    expect(readEngine(ENGINE)).toBe("0.14.13+1ab7f2");
    expect(readEngine({ ...ENGINE, id: "unknown" })).toBeNull();
    expect(readEngine({ ...ENGINE, id: "" })).toBeUndefined();
    expect(readEngine({ version: "0.14.13" })).toBeUndefined();
    expect(readEngine("0.14.13+1ab7f2")).toBeUndefined();
  });
});

describe("editor.engine notification", () => {
  it("the first editor.engine stores the id and calls the listeners", () => {
    const api = createLinkApi(ctx);
    const seen: (string | undefined)[] = [];
    api.onEngine(id => seen.push(id));
    expect(api.engine()).toBeUndefined();

    socket.notify("editor", "engine", ENGINE);

    expect(api.engine()).toBe("0.14.13+1ab7f2");
    expect(seen).toEqual(["0.14.13+1ab7f2"]);
  });

  it("the replay of the same id after a reconnect calls nothing; the id survives the reconnect", async () => {
    const api = createLinkApi(ctx);
    const listener = vi.fn();
    socket.notify("editor", "engine", ENGINE);
    api.onEngine(listener);
    listener.mockClear();

    const next = await reconnect();
    expect(api.engine()).toBe("0.14.13+1ab7f2");
    next.notify("editor", "engine", ENGINE);

    expect(listener).not.toHaveBeenCalled();
    expect(api.engine()).toBe("0.14.13+1ab7f2");
  });

  it("a new id calls the listeners", () => {
    const api = createLinkApi(ctx);
    const seen: (string | undefined)[] = [];
    socket.notify("editor", "engine", ENGINE);
    api.onEngine(id => seen.push(id));

    socket.notify("editor", "engine", { ...ENGINE, id: "0.14.14+77aa01" });

    expect(seen).toEqual(["0.14.13+1ab7f2", "0.14.14+77aa01"]);
    expect(api.engine()).toBe("0.14.14+77aa01");
  });

  it("a malformed value warns link:bad-engine and keeps the id", () => {
    const api = createLinkApi(ctx);
    socket.notify("editor", "engine", ENGINE);

    socket.notify("editor", "engine", { id: 7 });

    expect(ctx.log.warn).toHaveBeenCalledWith("link:bad-engine", {});
    expect(api.engine()).toBe("0.14.13+1ab7f2");
  });

  it("an 'unknown' id is held as unknown and never makes STALE", () => {
    const api = createLinkApi(ctx);
    const listener = vi.fn();
    api.onEngine(listener);

    socket.notify("editor", "engine", { ...ENGINE, id: "unknown" });
    expect(api.engine()).toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
  });

  it("a change from a known id to 'unknown' calls the listeners with undefined (review I5)", () => {
    const api = createLinkApi(ctx);
    const listener = vi.fn();
    api.onEngine(listener);

    socket.notify("editor", "engine", ENGINE);
    socket.notify("editor", "engine", { ...ENGINE, id: "unknown" });
    socket.notify("editor", "engine", { ...ENGINE, id: "unknown" });

    expect(api.engine()).toBeUndefined();
    expect(listener.mock.calls).toEqual([["0.14.13+1ab7f2"], [undefined]]);
  });

  it("onEngine is called at once when the id is known; its unsubscribe is idempotent", () => {
    const api = createLinkApi(ctx);
    socket.notify("editor", "engine", ENGINE);
    const listener = vi.fn();

    const stop = api.onEngine(listener);
    expect(listener).toHaveBeenCalledWith("0.14.13+1ab7f2");

    stop();
    stop();
    socket.notify("editor", "engine", { ...ENGINE, id: "0.14.14+77aa01" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("a throwing listener is logged and the next one still runs", () => {
    const api = createLinkApi(ctx);
    const after = vi.fn();
    api.onEngine(() => {
      throw new Error("boom");
    });
    api.onEngine(after);

    socket.notify("editor", "engine", ENGINE);

    expect(ctx.log.error).toHaveBeenCalledWith(
      "link:engine-listener-failed",
      {},
      expect.any(Error)
    );
    expect(after).toHaveBeenCalledWith("0.14.13+1ab7f2");
  });

  it("stop forgets the listeners", () => {
    const api = createLinkApi(ctx);
    const listener = vi.fn();
    api.onEngine(listener);

    stopLink(ctx);

    expect(ctx.state.engineListeners.size).toBe(0);
  });
});

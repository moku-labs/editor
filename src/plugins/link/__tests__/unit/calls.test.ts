/* eslint-disable unicorn/no-null -- null is a JSON value on the wire */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isRetryable, isWireError } from "../../../registry/protocol";
import {
  describeError,
  failAll,
  gameRequest,
  linkClosedError,
  noSessionError,
  request,
  settle,
  timeoutFor
} from "../../rpc/calls";
import { openSocket } from "../../socket/connect";
import { BOOT, createCtx, FakeWebSocket, latestSocket, type TestCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// JSON-RPC calls over the fake socket
// ─────────────────────────────────────────────────────────────────────────────

let ctx: TestCtx;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  FakeWebSocket.instances.length = 0;
  ctx = createCtx();
  ctx.state.boot = BOOT;
  openSocket(ctx);
  latestSocket().open();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("request", () => {
  it("sends requests with increasing ids, params and the session", () => {
    request(ctx, "game", "read", { id: "game.graph" }, "s-1").catch(() => undefined);
    request(ctx, "files", "list", { dir: "" }).catch(() => undefined);

    const [first, second] = latestSocket().requests();
    expect(first).toEqual({
      jsonrpc: "2.0",
      id: 1,
      channel: "game",
      method: "read",
      params: { id: "game.graph" },
      session: "s-1"
    });
    expect(second).toEqual({
      jsonrpc: "2.0",
      id: 2,
      channel: "files",
      method: "list",
      params: { dir: "" }
    });
    expect(ctx.state.pending.size).toBe(2);
  });

  it("resolves with the result of the response and clears the timer", async () => {
    const call = request(ctx, "game", "read", { id: "game.graph" }, "s-1");
    latestSocket().answer(latestSocket().last("read"), { nodes: [] });

    await expect(call).resolves.toEqual({ nodes: [] });
    expect(ctx.state.pending.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects with a wire error rebuilt from an error response", async () => {
    const call = request(ctx, "files", "write", { path: "a.ts", text: "x", version: "v0" });
    latestSocket().reject(latestSocket().last("write"), {
      code: -32_005,
      message: "[moku-editor] version conflict: a.ts",
      data: { reason: "version_conflict", retryable: false }
    });

    const error: unknown = await call.catch((error_: unknown) => error_);
    expect(error).toBeInstanceOf(Error);
    expect(isWireError(error)).toBe(true);
    expect(error).toMatchObject({
      code: -32_005,
      message: "[moku-editor] version conflict: a.ts",
      data: { reason: "version_conflict", retryable: false }
    });
  });

  it("rejects -32002 timeout after 10 s", async () => {
    const call = request(ctx, "game", "read", { id: "game.graph" }, "s-1");
    const caught = call.catch((error: unknown) => error);
    vi.advanceTimersByTime(10_000);

    const error = await caught;
    expect(error).toMatchObject({
      code: -32_002,
      message: "[moku-editor] read timed out after 10000 ms.",
      data: { reason: "timeout", retryable: true }
    });
    expect(ctx.state.pending.size).toBe(0);
  });

  it("rejects link_closed at once when the socket is not open", async () => {
    ctx.state.open = false;
    const error: unknown = await request(ctx, "files", "list", { dir: "" }).catch(
      (error_: unknown) => error_
    );
    expect(error).toMatchObject({
      code: -32_002,
      data: { reason: "link_closed", retryable: true }
    });
    expect(latestSocket().requests()).toHaveLength(0);
  });

  it("rejects and forgets the call when send throws", async () => {
    const socket = latestSocket();
    socket.send = () => {
      throw new Error("socket is closing");
    };
    const error: unknown = await request(ctx, "files", "list", { dir: "" }).catch(
      (error_: unknown) => error_
    );
    expect(error).toMatchObject({ code: -32_002, data: { reason: "link_closed" } });
    expect(ctx.state.pending.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("settle", () => {
  it("ignores a response with an unknown id", () => {
    expect(() => settle(ctx, { jsonrpc: "2.0", id: 99, result: null })).not.toThrow();
    expect(ctx.log.debug).toHaveBeenCalledWith("link:unknown-response", { id: 99 });
  });
});

describe("failAll", () => {
  it("rejects every pending call with link_closed and clears every timer", async () => {
    const calls = [
      request(ctx, "game", "read", { id: "a" }, "s-1"),
      request(ctx, "files", "list", { dir: "" })
    ].map(call => call.catch((error: unknown) => error));
    expect(vi.getTimerCount()).toBe(2);

    failAll(ctx, linkClosedError());

    for (const error of await Promise.all(calls)) {
      expect(error).toMatchObject({
        code: -32_002,
        message: "[moku-editor] The link to the editor server closed.",
        data: { reason: "link_closed", retryable: true }
      });
    }
    expect(ctx.state.pending.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("gameRequest", () => {
  it("rejects no_session at once when nothing is chosen", async () => {
    const error: unknown = await gameRequest(ctx, "read", { id: "x" }).catch(
      (error_: unknown) => error_
    );
    expect(error).toMatchObject({
      code: -32_003,
      message: "[moku-editor] No game is connected.",
      data: { reason: "no_session", retryable: false }
    });
    expect(isRetryable(error)).toBe(false);
  });

  it("sends with the chosen session", () => {
    ctx.state.chosen = "s-9";
    gameRequest(ctx, "run", { id: "game.step" }).catch(() => undefined);
    expect(latestSocket().last("run").session).toBe("s-9");
  });
});

describe("errors", () => {
  it("every link-made error starts with [moku-editor]", () => {
    for (const error of [linkClosedError(), noSessionError()]) {
      expect(error.message.startsWith("[moku-editor] ")).toBe(true);
    }
  });

  it("describeError keeps code and reason only", () => {
    expect(describeError(noSessionError())).toEqual({ code: -32_003, reason: "no_session" });
    expect(describeError(new Error("plain"))).toEqual({});
  });
});

describe("timeoutFor", () => {
  it("extends run of editor.series by durationMs (R1)", () => {
    expect(
      timeoutFor("run", { id: "editor.series", input: { durationMs: 20_000, intervalMs: 100 } })
    ).toBe(30_000);
  });

  it("caps the extension at 60 s", () => {
    expect(timeoutFor("run", { id: "editor.series", input: { durationMs: 90_000 } })).toBe(70_000);
  });

  it("gives 10 s to everything else", () => {
    expect(timeoutFor("run", { id: "editor.series", input: {} })).toBe(10_000);
    expect(timeoutFor("run", { id: "editor.series", input: { durationMs: -5 } })).toBe(10_000);
    expect(timeoutFor("run", { id: "editor.series" })).toBe(10_000);
    expect(timeoutFor("run", { id: "game.step", input: { durationMs: 20_000 } })).toBe(10_000);
    expect(timeoutFor("read", { id: "editor.series", input: { durationMs: 20_000 } })).toBe(10_000);
    expect(timeoutFor("run", undefined)).toBe(10_000);
    expect(timeoutFor("run", ["x"])).toBe(10_000);
  });
});

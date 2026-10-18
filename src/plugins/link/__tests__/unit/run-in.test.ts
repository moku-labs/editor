/* eslint-disable unicorn/no-null -- null is a JSON value on the wire */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLinkApi } from "../../api";
import type { LinkApi } from "../../types";
import { connected, createCtx, FakeWebSocket, flush, sessionOf, type TestCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// runIn (spec 11 § 5.2): a command on a named open session, the choice untouched
// — activeSource pauses the local preview while a device is the source.
// ─────────────────────────────────────────────────────────────────────────────

const RAN = { value: true, state: { path: "home", frame: 1840, tainted: false } };

let ctx: TestCtx;
let socket: FakeWebSocket;
let api: LinkApi;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  FakeWebSocket.instances.length = 0;
  ctx = createCtx();
  socket = await connected(ctx, [sessionOf("s-9"), sessionOf("s-1", { embedded: true })]);
  api = createLinkApi(ctx);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("runIn", () => {
  it("runs on the named session with its input while the chosen session stays", async () => {
    expect(api.session()).toBe("s-1");

    const paused = api.runIn("s-9", "game.pause");
    const pause = socket.last("run");
    const stepped = api.runIn("s-9", "game.step", { frames: 1 });
    const step = socket.last("run");
    expect(pause).toMatchObject({ channel: "game", session: "s-9", params: { id: "game.pause" } });
    expect(step).toMatchObject({
      session: "s-9",
      params: { id: "game.step", input: { frames: 1 } }
    });
    socket.answer(pause, RAN);
    socket.answer(step, RAN);

    await expect(paused).resolves.toEqual(RAN);
    await expect(stepped).resolves.toEqual(RAN);
    await flush();
    expect(api.session()).toBe("s-1");
    expect(socket.requests("manifest")).toHaveLength(1);
  });

  it("rejects -32003 no_session for an id that is not open and sends nothing", async () => {
    // Bug: a pause sent to the reloaded frame's old session, which no longer exists.
    await expect(api.runIn("s-gone", "game.pause")).rejects.toMatchObject({
      code: -32_003,
      data: { reason: "no_session", retryable: false }
    });
    expect(socket.requests("run")).toEqual([]);
  });

  it("rejects -32003 no_session while the socket is closed", async () => {
    socket.drop();

    await expect(api.runIn("s-1", "game.resume")).rejects.toMatchObject({ code: -32_003 });
  });

  it("the command's own error is the rejection", async () => {
    // Bug: a refused game.pause read as paused, so activeSource never shows "unpausable".
    const resumed = api.runIn("s-1", "game.pause");
    socket.reject(socket.last("run"), {
      code: -32_000,
      message: "[moku-editor] game.pause is not available.",
      data: { reason: "command_failed", retryable: false }
    });

    await expect(resumed).rejects.toMatchObject({
      code: -32_000,
      data: { reason: "command_failed" }
    });
  });

  it("an answer that is not a RunResult rejects -32600", async () => {
    const ran = api.runIn("s-1", "game.pause");
    socket.answer(socket.last("run"), null);

    await expect(ran).rejects.toMatchObject({ code: -32_600 });
  });
});

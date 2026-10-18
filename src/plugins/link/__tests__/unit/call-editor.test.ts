/* eslint-disable unicorn/no-null -- null is a JSON value on the wire */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLinkApi } from "../../api";
import type { LinkApi } from "../../types";
import { connected, createCtx, FakeWebSocket, latestSocket, type TestCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// callEditor (spec 11 § 5.2): an editor-channel method another server plugin
// registered on the hub (connect.*), with no session.
// ─────────────────────────────────────────────────────────────────────────────

const LISTEN = { listen: { port: 47_600, adb: "127.0.0.1:47600", lan: null } };

let ctx: TestCtx;
let socket: FakeWebSocket;
let api: LinkApi;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  FakeWebSocket.instances.length = 0;
  ctx = createCtx();
  socket = await connected(ctx);
  api = createLinkApi(ctx);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("callEditor", () => {
  it("sends an editor-channel request with no session and resolves with its result", async () => {
    const wired = api.callEditor("connect.wire");
    const watched = api.callEditor("connect.watch", { device: "d-7f3a" });
    const wire = socket.last("connect.wire");
    const watch = socket.last("connect.watch");

    expect(wire).toEqual({
      jsonrpc: "2.0",
      id: wire.id,
      channel: "editor",
      method: "connect.wire"
    });
    expect(watch).toEqual({
      jsonrpc: "2.0",
      id: watch.id,
      channel: "editor",
      method: "connect.watch",
      params: { device: "d-7f3a" }
    });
    socket.answer(wire, LISTEN);
    socket.answer(watch, null);

    await expect(wired).resolves.toEqual(LISTEN);
    await expect(watched).resolves.toBeNull();
  });

  it("rejects link_closed at once while disconnected and sends nothing", async () => {
    // Bug: the Connect panel's "By wire" waiting 10 s on a dead socket.
    socket.drop();
    const before = latestSocket().sent.length;

    await expect(api.callEditor("connect.scan")).rejects.toMatchObject({
      code: -32_002,
      data: { reason: "link_closed", retryable: true }
    });
    expect(latestSocket().sent).toHaveLength(before);
  });

  it("the method's wire error is the rejection, code and data kept", async () => {
    const called = api.callEditor("connect.confirm", { ticket: "p-3", code: "4821" });
    socket.reject(socket.last("connect.confirm"), {
      code: -32_602,
      message: "[moku-editor] connect.confirm has no ticket p-3.",
      data: { reason: "invalid_input", retryable: false }
    });

    await expect(called).rejects.toMatchObject({
      code: -32_602,
      data: { reason: "invalid_input", retryable: false }
    });
  });
});

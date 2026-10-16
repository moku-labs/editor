import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "../../../registry/protocol";
import { createLinkApi } from "../../api";
import type { LinkApi } from "../../types";
import {
  connected,
  createCtx,
  FakeWebSocket,
  sendSessions,
  sessionOf,
  type TestCtx
} from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// onSessions (spec 11 § 5.2): called after every `sessions` notification is
// applied — how activeSource sees a device link up (B3) or leave (B6).
// ─────────────────────────────────────────────────────────────────────────────

const DEVICE = {
  id: "d-7f3a",
  model: "SM-A266B",
  link: "adb",
  address: "127.0.0.1",
  port: 47_600,
  engine: "0.15.0+1ab7f2",
  build: "debug"
} as const;

let ctx: TestCtx;
let socket: FakeWebSocket;
let api: LinkApi;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  FakeWebSocket.instances.length = 0;
  ctx = createCtx();
  socket = await connected(ctx, [sessionOf("s-1", { embedded: true })]);
  api = createLinkApi(ctx);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("onSessions", () => {
  it("is called after each sessions notification, with the list and the choice applied", () => {
    // Bug: activeSource missing a phone that links, or one that leaves.
    const heard: { ids: string[]; chosen: string | undefined }[] = [];
    api.onSessions(list => heard.push({ ids: list.map(({ id }) => id), chosen: api.session() }));

    sendSessions(socket, [
      sessionOf("s-1", { embedded: true }),
      sessionOf("s-9", { device: DEVICE })
    ]);
    sendSessions(socket, [sessionOf("s-9", { device: DEVICE })]);

    expect(heard).toEqual([
      { ids: ["s-1", "s-9"], chosen: "s-1" },
      { ids: ["s-9"], chosen: "s-9" }
    ]);
  });

  it("gives every listener the same frozen list, with the device of a device session", () => {
    const lists: (readonly SessionInfo[])[] = [];
    api.onSessions(list => lists.push(list));
    api.onSessions(list => lists.push(list));

    sendSessions(socket, [sessionOf("s-9", { device: DEVICE })]);

    expect(lists[0]).toBe(lists[1]);
    expect(Object.isFrozen(lists[0])).toBe(true);
    expect(lists[0]?.[0]?.device).toEqual(DEVICE);
  });

  it("a malformed sessions notification and a socket close call nothing", () => {
    // Bug: a tools socket reconnect read as "every phone left".
    const listener = vi.fn();
    api.onSessions(listener);

    socket.notify("editor", "sessions", { list: "nope" });
    socket.drop();

    expect(listener).not.toHaveBeenCalled();
  });

  it("a throwing listener is logged and the next one still runs; the unsubscribe stops one", () => {
    const failure = new Error("boom");
    const next = vi.fn();
    const removed = vi.fn();
    api.onSessions(() => {
      throw failure;
    });
    api.onSessions(next);
    api.onSessions(removed)();

    sendSessions(socket, [sessionOf("s-1", { embedded: true })]);

    expect(ctx.log.error).toHaveBeenCalledWith("link:sessions-listener-failed", {}, failure);
    expect(next).toHaveBeenCalledTimes(1);
    expect(removed).not.toHaveBeenCalled();
  });
});

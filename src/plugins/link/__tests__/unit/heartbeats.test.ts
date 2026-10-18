import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLinkApi } from "../../api";
import { stopLink } from "../../lifecycle";
import type { LinkApi, ReceivedHeartbeat } from "../../types";
import { connected, createCtx, FakeWebSocket, sessionOf, type TestCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// onHeartbeat (spec 11 § 5.2 L10): the chosen session's heartbeats with the
// phone's `at` and this computer's arrival time — what activeSource's clock
// offset is estimated from.
// ─────────────────────────────────────────────────────────────────────────────

/** This computer's clock in the tests. */
const NOW = 1_791_986_100_000;

let ctx: TestCtx;
let socket: FakeWebSocket;
let api: LinkApi;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubGlobal("WebSocket", FakeWebSocket);
  FakeWebSocket.instances.length = 0;
  ctx = createCtx();
  socket = await connected(ctx, [sessionOf("s-2"), sessionOf("s-1", { embedded: true })]);
  api = createLinkApi(ctx);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("onHeartbeat", () => {
  it("passes each beat of the chosen session with the phone's at and the arrival time", () => {
    // Bug: the clock offset of a device never estimated (clockOffsetMs null forever).
    const beats: ReceivedHeartbeat[] = [];
    api.onHeartbeat(beat => beats.push(beat));

    socket.notify("game", "heartbeat", { frame: 40, paused: false, at: NOW - 412 }, "s-1");
    socket.notify("game", "heartbeat", { frame: 41, paused: false, at: NOW - 400 }, "s-2");
    socket.notify("game", "heartbeat", { frame: 42, paused: false }, "s-1");

    expect(api.session()).toBe("s-1");
    expect(beats).toEqual([{ session: "s-1", at: NOW - 412, receivedAt: NOW }]);
    expect(Object.isFrozen(beats[0])).toBe(true);
    expect(api.status()).toEqual({ kind: "live", frame: 42 });
  });

  it("logs a throwing listener and still calls the next; unsubscribe and stop call nobody", () => {
    const heard = vi.fn();
    const off = api.onHeartbeat(() => {
      throw new Error("boom");
    });
    api.onHeartbeat(heard);

    socket.notify("game", "heartbeat", { frame: 1, paused: false, at: NOW }, "s-1");
    expect(heard).toHaveBeenCalledTimes(1);
    expect(ctx.log.error).toHaveBeenCalledWith(
      "link:heartbeat-listener-failed",
      {},
      expect.any(Error)
    );

    off();
    stopLink(ctx);
    socket.notify("game", "heartbeat", { frame: 2, paused: false, at: NOW }, "s-1");
    expect(heard).toHaveBeenCalledTimes(1);
    expect(ctx.state.heartbeatListeners.size).toBe(0);
  });
});

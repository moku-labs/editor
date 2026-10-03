import { describe, expect, it } from "vitest";
import { notification, success } from "../../../registry/protocol";
import { congested, flushPending, sendNow, sendValue } from "../../dispatch/send";
import type { Subscription } from "../../types";
import { HIGH_WATER, LOW_WATER } from "../../types";
import type { TestDeps } from "../helpers";
import { FakeSocket, openDeps } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Sending: at once when open, coalesced latest-wins while congested, flushed in
// insertion order below the low water mark.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Adds a subscription record.
 *
 * @param deps - The test deps.
 * @param sub - Its sub id.
 * @returns The record.
 */
function addSub(deps: TestDeps, sub: number): Subscription {
  const record: Subscription = {
    sub,
    id: "game.position",
    input: undefined,
    changes: "edge",
    stop: undefined,
    lastSent: undefined
  };
  deps.state.subs.set(sub, record);
  return record;
}

describe("sendNow", () => {
  it("sends the encoded message when the socket is open", () => {
    const { deps, socket } = openDeps();

    sendNow(deps, success(1, "ok"));

    expect(socket.sent).toEqual([JSON.stringify(success(1, "ok"))]);
  });

  it("drops the message when the socket is not open or missing", () => {
    const { deps, socket } = openDeps();
    socket.readyState = 0;
    sendNow(deps, success(1, "ok"));
    deps.state.socket = undefined;
    sendNow(deps, success(2, "ok"));

    expect(socket.sent).toEqual([]);
  });

  it("logs a send that throws at debug", () => {
    const { deps, socket } = openDeps();
    socket.onSend = () => {
      throw new Error("closing");
    };

    sendNow(deps, success(1, "ok"));

    expect(deps.log.debug).toHaveBeenCalledWith("bridge:send-failed", { message: "closing" });
  });

  it("sends heartbeats and responses even while congested", () => {
    const { deps, socket } = openDeps();
    socket.bufferedAmount = HIGH_WATER * 2;

    sendNow(deps, notification("game", "heartbeat", { frame: 1, paused: false, at: 1 }));
    sendNow(deps, success(1, "ok"));

    expect(socket.sent).toHaveLength(2);
  });
});

describe("congested", () => {
  it("is true above HIGH_WATER only; a missing bufferedAmount counts as 0", () => {
    const socket = new FakeSocket();
    socket.bufferedAmount = HIGH_WATER;
    expect(congested(socket)).toBe(false);
    socket.bufferedAmount = HIGH_WATER + 1;
    expect(congested(socket)).toBe(true);
    expect(
      congested({
        readyState: 1,
        send: () => {},
        close: () => {},
        addEventListener: () => {}
      })
    ).toBe(false);
  });
});

describe("sendValue", () => {
  it("sends a value notification and records its text", () => {
    const { deps, socket } = openDeps();
    const record = addSub(deps, 1);

    sendValue(deps, 1, { a: 1 }, '{"a":1}');

    expect(socket.messages()).toEqual([notification("game", "value", { sub: 1, value: { a: 1 } })]);
    expect(record.lastSent).toBe('{"a":1}');
  });

  it("keeps only the latest value per sub while congested", () => {
    const { deps, socket } = openDeps();
    const record = addSub(deps, 1);
    socket.bufferedAmount = HIGH_WATER + 1;

    sendValue(deps, 1, 1, "1");
    sendValue(deps, 1, 2, "2");

    expect(socket.sent).toEqual([]);
    expect([...deps.state.pending]).toEqual([[1, 2]]);
    expect(record.lastSent).toBe("2");
  });
});

describe("flushPending", () => {
  it("sends the backlog in insertion order below LOW_WATER", () => {
    const { deps, socket } = openDeps();
    deps.state.pending.set(1, "a");
    deps.state.pending.set(2, "b");
    // eslint-disable-next-line sonarjs/no-element-overwrite -- latest wins, position kept
    deps.state.pending.set(1, "c");
    socket.bufferedAmount = LOW_WATER - 1;

    flushPending(deps);

    expect(socket.messages()).toEqual([
      notification("game", "value", { sub: 1, value: "c" }),
      notification("game", "value", { sub: 2, value: "b" })
    ]);
    expect(deps.state.pending.size).toBe(0);
  });

  it("stops when the socket is congested again", () => {
    const { deps, socket } = openDeps();
    deps.state.pending.set(1, "a");
    deps.state.pending.set(2, "b");
    socket.onSend = () => {
      socket.bufferedAmount = HIGH_WATER + 1;
    };

    flushPending(deps);

    expect(socket.sent).toHaveLength(1);
    expect([...deps.state.pending.keys()]).toEqual([2]);
  });

  it("waits at or above LOW_WATER, and without a socket", () => {
    const { deps, socket } = openDeps();
    deps.state.pending.set(1, "a");
    socket.bufferedAmount = LOW_WATER;

    flushPending(deps);
    deps.state.socket = undefined;
    flushPending(deps);

    expect(socket.sent).toEqual([]);
    expect(deps.state.pending.size).toBe(1);
  });
});

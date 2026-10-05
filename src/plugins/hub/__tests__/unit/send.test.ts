/* eslint-disable unicorn/no-null -- null is a JSON value on the wire */
import { describe, expect, it } from "vitest";
import { notification, success } from "../../../registry/protocol";
import { flushBacklog, sendDroppable, sendJson, sendValue } from "../../sockets/send";
import type { AgentConn, ToolsConn } from "../../types";
import type { FakeSocket } from "../helpers";
import { fakeSocket, NULL, paramsOf } from "../helpers";

/**
 * A tools conn on a fake socket.
 *
 * @returns The conn and its socket.
 */
function toolsConn(): { conn: ToolsConn; socket: FakeSocket } {
  const socket = fakeSocket("tools", 1);
  const conn: ToolsConn = {
    kind: "tools",
    conn: 1,
    socket,
    page: false,
    subs: new Map(),
    pending: 0,
    congested: false,
    backlog: new Map(),
    invalid: 0
  };
  return { conn, socket };
}

describe("sendJson", () => {
  it("sends the encoded message", () => {
    const { conn, socket } = toolsConn();

    sendJson(conn, success(3, NULL));

    expect(socket.sent).toEqual(['{"jsonrpc":"2.0","id":3,"result":null}']);
    expect(conn.congested).toBe(false);
  });

  it("marks a tools conn congested when send returns -1", () => {
    const { conn, socket } = toolsConn();
    socket.result = -1;

    sendJson(conn, success(3, NULL));

    expect(conn.congested).toBe(true);
  });

  it("ignores 0 (socket closing)", () => {
    const { conn, socket } = toolsConn();
    socket.result = 0;

    sendJson(conn, success(3, NULL));

    expect(conn.congested).toBe(false);
  });

  it("sends to an agent conn without congestion bookkeeping", () => {
    const socket = fakeSocket("agent", 2);
    socket.result = -1;
    const conn: AgentConn = {
      kind: "agent",
      conn: 2,
      socket,
      session: undefined,
      bye: false,
      invalid: 0
    };

    sendJson(conn, notification("editor", "session", { id: "s-1", game: "g", open: true }));

    expect(socket.sent).toHaveLength(1);
  });
});

describe("congestion", () => {
  it("stores only the latest value per sub, keeps responses, drops heartbeats", () => {
    const { conn, socket } = toolsConn();
    conn.congested = true;

    sendValue(conn, 1, "s-a", "first");
    sendValue(conn, 2, "s-a", 20);
    sendValue(conn, 1, "s-a", "latest");
    sendDroppable(
      conn,
      notification("game", "heartbeat", { frame: 1, paused: false, at: 1 }, "s-a")
    );
    sendJson(conn, success(9, NULL));

    expect(socket.messages()).toEqual([{ jsonrpc: "2.0", id: 9, result: null }]);
    expect([...conn.backlog.entries()]).toEqual([
      [1, { session: "s-a", value: "latest" }],
      [2, { session: "s-a", value: 20 }]
    ]);
  });

  it("sends values and heartbeats while not congested", () => {
    const { conn, socket } = toolsConn();

    sendValue(conn, 4, "s-a", { x: 1 });
    sendDroppable(
      conn,
      notification("game", "heartbeat", { frame: 1, paused: false, at: 1 }, "s-a")
    );

    expect(socket.messages()).toEqual([
      {
        jsonrpc: "2.0",
        channel: "game",
        method: "value",
        params: { sub: 4, value: { x: 1 } },
        session: "s-a"
      },
      {
        jsonrpc: "2.0",
        channel: "game",
        method: "heartbeat",
        params: { frame: 1, paused: false, at: 1 },
        session: "s-a"
      }
    ]);
  });

  it("becomes congested by a value that hits backpressure", () => {
    const { conn, socket } = toolsConn();
    socket.result = -1;

    sendValue(conn, 4, "s-a", 1);
    sendValue(conn, 4, "s-a", 2);

    expect(socket.sent).toHaveLength(1);
    expect(conn.congested).toBe(true);
    expect(conn.backlog.get(4)).toEqual({ session: "s-a", value: 2 });
  });
});

describe("flushBacklog (drain)", () => {
  it("clears congestion and sends the backlog in insertion order", () => {
    const { conn, socket } = toolsConn();
    conn.congested = true;
    sendValue(conn, 2, "s-a", "b");
    sendValue(conn, 1, "s-b", "a");

    flushBacklog(conn);

    expect(conn.congested).toBe(false);
    expect(conn.backlog.size).toBe(0);
    expect(
      socket
        .notes("game", "value")
        .map(message => [paramsOf(message), "session" in message ? message.session : ""])
    ).toEqual([
      [{ sub: 2, value: "b" }, "s-a"],
      [{ sub: 1, value: "a" }, "s-b"]
    ]);
  });

  it("keeps the rest of the backlog when the socket congests again mid-flush", () => {
    const { conn, socket } = toolsConn();
    conn.congested = true;
    sendValue(conn, 1, "s", 1);
    sendValue(conn, 2, "s", 2);
    sendValue(conn, 3, "s", 3);
    socket.result = -1;

    flushBacklog(conn);

    expect(socket.sent).toHaveLength(1);
    expect(conn.congested).toBe(true);
    expect([...conn.backlog.keys()]).toEqual([2, 3]);
  });
});

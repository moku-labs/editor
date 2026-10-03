import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Json } from "../../../registry/protocol";
import { notification, request, success, toWireValue } from "../../../registry/protocol";
import type { FakeSocket, Harness } from "../helpers";
import { createHarness, errorOf, fakeSocket, MANIFEST, NULL, paramsOf, resultOf } from "../helpers";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/**
 * A hub with one session and one tools conn (open notifications cleared).
 *
 * @returns The harness, the sockets and the session id.
 */
function setup() {
  const harness: Harness = createHarness();
  const { agent, session } = harness.hello();
  const tools = harness.connect("tools");
  tools.clear();
  return { harness, agent, tools, session };
}

/**
 * Sends a tools request on the game channel.
 *
 * @param harness - The harness.
 * @param tools - The tools socket.
 * @param id - Request id.
 * @param method - Method.
 * @param params - Params.
 * @param session - Optional session.
 */
function game(
  harness: Harness,
  tools: FakeSocket,
  id: number,
  method: string,
  params?: Json,
  session?: string
): void {
  harness.send(tools, request(id, "game", method, params, session));
}

describe("tools open", () => {
  it("sends sessions {list} on channel editor at once", () => {
    const harness = createHarness();
    harness.hello();

    const tools = harness.connect("tools");

    const messages = tools.messages();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ channel: "editor", method: "sessions" });
    expect(paramsOf(messages[0])?.list).toHaveLength(1);
  });

  it("closes a socket that opens after stop with 1001", () => {
    const harness = createHarness();
    harness.ctx.state.token = undefined;

    const tools = harness.connect("tools");

    expect(tools.closes).toEqual([{ code: 1001, reason: "editor stopping" }]);
    expect(harness.ctx.state.conns.size).toBe(0);
  });
});

describe("tools game channel", () => {
  it("answers manifest from the chosen session, not forwarded", () => {
    const { harness, agent, tools } = setup();

    game(harness, tools, 1, "manifest");

    expect(resultOf(tools, 1)).toEqual(toWireValue(MANIFEST));
    expect(agent.requests()).toEqual([]);
  });

  it("forwards read and answers with the tools id", () => {
    const { harness, agent, tools, session } = setup();

    game(harness, tools, 9, "read", { id: "game.history", input: { last: 5 } }, session);

    const [forwarded] = agent.requests();
    expect(forwarded).toMatchObject({
      method: "read",
      params: { id: "game.history", input: { last: 5 } }
    });
    harness.send(agent, success(forwarded?.id ?? 0, [1, 2]));
    expect(resultOf(tools, 9)).toEqual([1, 2]);
  });

  it("refuses an id not in the manifest with -32601 unknown_id, nothing sent (H31)", () => {
    const { harness, agent, tools } = setup();

    game(harness, tools, 1, "read", { id: "game.secrets" });
    game(harness, tools, 2, "run", { id: "game.position" });
    game(harness, tools, 3, "watch", { sub: 1, id: "game.step" });

    for (const id of [1, 2, 3]) {
      expect(errorOf(tools, id)).toMatchObject({
        code: -32_601,
        message: expect.stringMatching(/^\[moku-editor] /),
        data: { reason: "unknown_id", retryable: false }
      });
    }
    expect(errorOf(tools, 1)?.data?.id).toBe("game.secrets");
    expect(agent.requests()).toEqual([]);
  });

  it("refuses bad input with -32602 naming the field, nothing sent (H32)", () => {
    const { harness, agent, tools } = setup();

    game(harness, tools, 1, "run", { id: "game.step", input: { frames: 1, turbo: true } });
    game(harness, tools, 2, "run", { id: "game.step", input: { frames: "1" } });
    game(harness, tools, 3, "read", { id: "game.history", input: { last: "x" } });

    expect(errorOf(tools, 1)).toMatchObject({ code: -32_602, data: { field: "turbo" } });
    expect(errorOf(tools, 2)).toMatchObject({ code: -32_602, data: { field: "frames" } });
    expect(errorOf(tools, 3)).toMatchObject({ code: -32_602, data: { field: "last" } });
    expect(agent.requests()).toEqual([]);
  });

  it("refuses bad request params with -32602", () => {
    const { harness, tools } = setup();

    game(harness, tools, 1, "read", { input: {} });
    game(harness, tools, 2, "read", [1]);
    game(harness, tools, 3, "manifest", { extra: 1 });

    expect(errorOf(tools, 1)).toMatchObject({ code: -32_602, data: { field: "id" } });
    expect(errorOf(tools, 2)?.code).toBe(-32_602);
    expect(errorOf(tools, 3)?.code).toBe(-32_602);
  });

  it("forwards run", () => {
    const { harness, agent, tools } = setup();

    game(harness, tools, 4, "run", { id: "game.step", input: { frames: 2 } });

    expect(agent.requests()[0]).toMatchObject({
      channel: "game",
      method: "run",
      params: { id: "game.step", input: { frames: 2 } }
    });
  });

  it("checks watch subs: a safe integer ≥ 0, unique per conn (R6)", () => {
    const { harness, agent, tools } = setup();

    game(harness, tools, 1, "watch", { sub: -1, id: "game.position" });
    game(harness, tools, 2, "watch", { sub: 1.5, id: "game.position" });
    game(harness, tools, 3, "watch", { sub: "1", id: "game.position" });
    game(harness, tools, 4, "watch", { sub: 7, id: "game.position" });
    game(harness, tools, 5, "watch", { sub: 7, id: "game.history" });

    expect(errorOf(tools, 1)).toMatchObject({ code: -32_602, data: { field: "sub" } });
    expect(errorOf(tools, 2)).toMatchObject({ code: -32_602, data: { field: "sub" } });
    expect(errorOf(tools, 3)).toMatchObject({ code: -32_602, data: { field: "sub" } });
    expect(errorOf(tools, 5)).toMatchObject({ code: -32_600 });
    expect(agent.requests().filter(message => message.method === "watch")).toHaveLength(1);
  });

  it("answers unwatch of an unknown sub with null", () => {
    const { harness, tools } = setup();

    game(harness, tools, 1, "unwatch", { sub: 42 });
    game(harness, tools, 2, "unwatch", { sub: -1 });

    expect(resultOf(tools, 1)).toBeNull();
    expect(errorOf(tools, 2)).toMatchObject({ code: -32_602, data: { field: "sub" } });
  });

  it("refuses an unknown game method with -32601", () => {
    const { harness, tools } = setup();

    game(harness, tools, 1, "eval", { code: "1" });

    expect(errorOf(tools, 1)?.code).toBe(-32_601);
  });
});

describe("tools session choice", () => {
  it("fails -32003 for an unknown requested session, naming it", () => {
    const { harness, tools } = setup();

    game(harness, tools, 1, "read", { id: "game.position" }, "s-none");

    expect(errorOf(tools, 1)).toMatchObject({
      code: -32_003,
      data: { reason: "no_session", id: "s-none" }
    });
  });

  it("fails -32003 no_session with no game", () => {
    const harness = createHarness();
    const tools = harness.connect("tools");

    harness.send(tools, request(1, "game", "manifest"));

    expect(errorOf(tools, 1)).toMatchObject({ code: -32_003, data: { reason: "no_session" } });
  });

  it("fails -32003 choose_session with two sessions and none embedded", () => {
    const harness = createHarness();
    harness.hello();
    harness.hello();
    const tools = harness.connect("tools");

    harness.send(tools, request(1, "game", "read", { id: "game.position" }));

    expect(errorOf(tools, 1)).toMatchObject({ code: -32_003, data: { reason: "choose_session" } });
  });

  it("picks the embedded session among several", () => {
    const harness = createHarness();
    harness.hello();
    const embedded = harness.hello({ ...MANIFEST, embedded: true });
    const tools = harness.connect("tools");

    harness.send(tools, request(1, "game", "read", { id: "game.position" }));

    expect(embedded.agent.requests()).toHaveLength(1);
  });
});

describe("tools other messages", () => {
  it("refuses another channel with -32601", () => {
    const { harness, tools } = setup();

    harness.send(tools, request(1, "editor", "sessions"));

    expect(errorOf(tools, 1)?.code).toBe(-32_601);
  });

  it("ignores notifications and responses from tools", () => {
    const { harness, agent, tools } = setup();

    harness.send(tools, notification("game", "heartbeat", { frame: 1, paused: false, at: 1 }));
    harness.send(tools, success(3, NULL));

    expect(tools.sent).toEqual([]);
    expect(agent.sent).toEqual([]);
    expect(tools.closes).toEqual([]);
  });

  it("refuses the 257th concurrent pending call with -32600 (H36)", () => {
    const { harness, agent, tools } = setup();

    for (let id = 1; id <= 256; id += 1) game(harness, tools, id, "read", { id: "game.position" });
    game(harness, tools, 257, "read", { id: "game.position" });

    expect(agent.requests()).toHaveLength(256);
    expect(errorOf(tools, 257)).toEqual({
      code: -32_600,
      message: "[moku-editor] too many pending calls",
      data: { retryable: false }
    });

    harness.send(agent, success(agent.requests()[0]?.id ?? 0, NULL));
    game(harness, tools, 258, "read", { id: "game.position" });
    expect(agent.requests()).toHaveLength(257);
  });

  it("discards pending replies of a closed tools conn", () => {
    const { harness, agent, tools } = setup();
    game(harness, tools, 1, "read", { id: "game.position" });
    harness.close(tools);
    tools.clear();

    harness.send(agent, success(agent.requests()[0]?.id ?? 0, NULL));

    expect(tools.sent).toEqual([]);
    expect(harness.ctx.state.pending.size).toBe(0);
  });

  it("closes 1003 on a binary frame and 1008 after ten undecodable frames (H34, H35)", () => {
    const { harness, tools } = setup();
    const other = harness.connect("tools");

    harness.handler.message(tools, new Uint8Array([0]));
    for (let index = 0; index < 10; index += 1) harness.handler.message(other, "not json");

    expect(tools.closes).toEqual([{ code: 1003, reason: "binary frames are not accepted" }]);
    expect(other.closes).toEqual([{ code: 1008, reason: "too many invalid messages" }]);
  });

  it("flushes the backlog on drain", () => {
    const { harness, agent, tools } = setup();
    game(harness, tools, 1, "watch", { sub: 3, id: "game.position" });
    const watch = agent.requests()[0];
    harness.send(agent, success(watch?.id ?? 0, NULL));
    harness.toolsConn(tools).congested = true;
    harness.send(
      agent,
      notification("game", "value", { sub: Number(paramsOf(watch)?.sub), value: 1 })
    );
    harness.send(
      agent,
      notification("game", "value", { sub: Number(paramsOf(watch)?.sub), value: 2 })
    );
    tools.clear();

    harness.handler.drain(tools);

    expect(tools.notes("game", "value").map(message => paramsOf(message))).toEqual([
      { sub: 3, value: 2 }
    ]);
    expect(harness.toolsConn(tools).congested).toBe(false);
  });

  it("ignores messages, closes and drains of unknown sockets", () => {
    const { harness } = setup();
    const stranger = fakeSocket("tools", 999);

    expect(() => {
      harness.handler.message(stranger, "{}");
      harness.handler.drain(stranger);
      harness.handler.close(stranger, 1000, "");
    }).not.toThrow();
  });
});

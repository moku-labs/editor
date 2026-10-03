/* eslint-disable unicorn/no-null -- null is a JSON value on the wire */
import { describe, expect, it } from "vitest";
import type { Request as RpcRequest } from "../../../registry/protocol";
import { failure, notification, request, success } from "../../../registry/protocol";
import { dropSession, subKey } from "../../routing/subscriptions";
import type { FakeSocket, Harness } from "../helpers";
import { createHarness, errorOf, NULL, paramsOf, resultOf } from "../helpers";

/**
 * A hub with one agent session.
 *
 * @returns The harness, the agent and the session id.
 */
function setup() {
  const harness: Harness = createHarness();
  const { agent, session } = harness.hello();
  return { harness, agent, session };
}

/**
 * Sends a tools watch request.
 *
 * @param harness - The harness.
 * @param tools - The tools socket.
 * @param id - Request id.
 * @param sub - Tools sub id.
 * @param input - Source input.
 * @param source - Source id.
 */
function watchFrom(
  harness: Harness,
  tools: FakeSocket,
  id: number,
  sub: number,
  input?: Parameters<typeof subKey>[2],
  source = "game.history"
): void {
  const params = input === undefined ? { sub, id: source } : { sub, id: source, input };
  harness.send(tools, request(id, "game", "watch", params));
}

/**
 * The game requests the agent received for a method.
 *
 * @param agent - The agent socket.
 * @param method - The method.
 * @returns The requests.
 */
function agentCalls(agent: FakeSocket, method: string): RpcRequest[] {
  return agent.requests().filter(message => message.method === method);
}

/**
 * The value notifications a tools socket received.
 *
 * @param tools - The tools socket.
 * @returns Their params and session.
 */
function valuesOf(tools: FakeSocket) {
  return tools.notes("game", "value").map(message => ({
    params: paramsOf(message),
    session: "session" in message ? message.session : undefined
  }));
}

describe("subKey", () => {
  it("is the same for inputs with keys in another order, nested too", () => {
    expect(subKey("s", "x", { a: 1, b: { d: 1, c: 2 } })).toBe(
      subKey("s", "x", { b: { c: 2, d: 1 }, a: 1 })
    );
  });

  it("differs by session, source and input", () => {
    const base = subKey("s", "x", { a: 1 });

    expect(subKey("t", "x", { a: 1 })).not.toBe(base);
    expect(subKey("s", "y", { a: 1 })).not.toBe(base);
    expect(subKey("s", "x", { a: 2 })).not.toBe(base);
    expect(subKey("s", "x", [1, 2])).not.toBe(subKey("s", "x", [2, 1]));
  });

  it("treats no input as null", () => {
    expect(subKey("s", "x", NULL)).toContain("null");
  });
});

describe("fan-out of watches", () => {
  it("shares one agent watch between two tools conns", () => {
    const { harness, agent, session } = setup();
    const first = harness.connect("tools");
    const second = harness.connect("tools");

    watchFrom(harness, first, 1, 10, { last: 5 });
    watchFrom(harness, second, 2, 20, { last: 5 });

    const watches = agentCalls(agent, "watch");
    expect(watches).toHaveLength(1);
    const agentSub = paramsOf(watches[0])?.sub;
    expect(paramsOf(watches[0])).toEqual({ sub: agentSub, id: "game.history", input: { last: 5 } });
    expect(watches[0]?.session).toBeUndefined();

    expect(resultOf(first, 1)).toBeUndefined();
    harness.send(agent, success(watches[0]?.id ?? 0, NULL));
    expect(resultOf(first, 1)).toBeNull();
    expect(resultOf(second, 2)).toBeNull();

    harness.send(agent, notification("game", "value", { sub: agentSub ?? 0, value: [1, 2] }));
    expect(valuesOf(first)).toEqual([{ params: { sub: 10, value: [1, 2] }, session }]);
    expect(valuesOf(second)).toEqual([{ params: { sub: 20, value: [1, 2] }, session }]);
  });

  it("gives a late subscriber null, then the last value", () => {
    const { harness, agent } = setup();
    const first = harness.connect("tools");
    watchFrom(harness, first, 1, 10);
    const watch = agentCalls(agent, "watch")[0];
    harness.send(agent, success(watch?.id ?? 0, NULL));
    harness.send(
      agent,
      notification("game", "value", { sub: Number(paramsOf(watch)?.sub), value: 3 })
    );

    const second = harness.connect("tools");
    second.clear();
    watchFrom(harness, second, 5, 50);

    const sent = second.messages();
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual({ jsonrpc: "2.0", id: 5, result: null });
    expect(paramsOf(sent[1])).toEqual({ sub: 50, value: 3 });
    expect(agentCalls(agent, "watch")).toHaveLength(1);
  });

  it("delivers values that arrive before the agent acknowledges", () => {
    const { harness, agent } = setup();
    const tools = harness.connect("tools");
    watchFrom(harness, tools, 1, 10);
    const watch = agentCalls(agent, "watch")[0];

    harness.send(
      agent,
      notification("game", "value", { sub: Number(paramsOf(watch)?.sub), value: "early" })
    );

    expect(valuesOf(tools).map(entry => entry.params)).toEqual([{ sub: 10, value: "early" }]);
  });

  it("forwards one agent watch per distinct input, one key for reordered inputs", () => {
    const { harness, agent } = setup();
    const tools = harness.connect("tools");

    watchFrom(harness, tools, 1, 1, { last: 5 });
    watchFrom(harness, tools, 2, 2, { last: 6 });
    harness.send(tools, request(3, "game", "watch", { sub: 3, id: "game.position" }));
    harness.send(tools, request(4, "game", "watch", { sub: 4, id: "game.position", input: {} }));

    expect(agentCalls(agent, "watch")).toHaveLength(4);
  });

  it("forwards one agent unwatch when the last subscriber leaves", () => {
    const { harness, agent } = setup();
    const first = harness.connect("tools");
    const second = harness.connect("tools");
    watchFrom(harness, first, 1, 10);
    watchFrom(harness, second, 2, 20);
    const watch = agentCalls(agent, "watch")[0];
    harness.send(agent, success(watch?.id ?? 0, NULL));

    harness.send(first, request(3, "game", "unwatch", { sub: 10 }));
    expect(resultOf(first, 3)).toBeNull();
    expect(agentCalls(agent, "unwatch")).toHaveLength(0);

    harness.send(second, request(4, "game", "unwatch", { sub: 20 }));
    const unwatches = agentCalls(agent, "unwatch");
    expect(unwatches).toHaveLength(1);
    expect(paramsOf(unwatches[0])).toEqual({ sub: paramsOf(watch)?.sub });
    expect(harness.ctx.state.shared.size).toBe(0);

    const before = second.sent.length;
    harness.send(agent, success(unwatches[0]?.id ?? 0, NULL));
    expect(second.sent).toHaveLength(before);
  });

  it("gives every waiting subscriber the agent error and forgets the key", () => {
    const { harness, agent } = setup();
    const first = harness.connect("tools");
    const second = harness.connect("tools");
    watchFrom(harness, first, 1, 10);
    watchFrom(harness, second, 2, 20);
    const watch = agentCalls(agent, "watch")[0];
    const error = {
      code: -32_601,
      message: "[moku-editor] unknown source",
      data: { reason: "unknown_id" as const }
    };

    harness.send(agent, failure(watch?.id ?? 0, error));

    expect(errorOf(first, 1)).toEqual(error);
    expect(errorOf(second, 2)).toEqual(error);
    expect(harness.ctx.state.shared.size).toBe(0);
    expect(harness.toolsConn(first).subs.size).toBe(0);

    watchFrom(harness, first, 3, 10);
    expect(agentCalls(agent, "watch")).toHaveLength(2);
  });

  it("drops a tools conn's subscriptions when it closes", () => {
    const { harness, agent } = setup();
    const first = harness.connect("tools");
    const second = harness.connect("tools");
    watchFrom(harness, first, 1, 10);
    watchFrom(harness, first, 2, 11, { last: 3 });
    watchFrom(harness, second, 3, 20);
    for (const watch of agentCalls(agent, "watch")) harness.send(agent, success(watch.id, NULL));

    harness.close(first);

    expect(agentCalls(agent, "unwatch")).toHaveLength(1);
    expect(harness.ctx.state.shared.size).toBe(1);
    const [shared] = harness.ctx.state.shared.values();
    expect([...(shared?.subscribers.keys() ?? [])]).toEqual([second.data.conn]);
  });

  it("answers null to a watch whose last subscriber left before the agent acknowledged", () => {
    const { harness, agent } = setup();
    const tools = harness.connect("tools");
    watchFrom(harness, tools, 1, 10);
    const watch = agentCalls(agent, "watch")[0];

    harness.send(tools, request(2, "game", "unwatch", { sub: 10 }));

    expect(resultOf(tools, 1)).toBeNull();
    expect(resultOf(tools, 2)).toBeNull();
    expect(agentCalls(agent, "unwatch")).toHaveLength(1);

    watchFrom(harness, tools, 3, 10);
    harness.send(agent, success(watch?.id ?? 0, NULL));
    expect(resultOf(tools, 3)).toBeUndefined();
    expect(agentCalls(agent, "watch")).toHaveLength(2);
  });

  it("ignores a value for an unknown agent sub", () => {
    const { harness, agent } = setup();
    const tools = harness.connect("tools");
    tools.clear();

    harness.send(agent, notification("game", "value", { sub: 999, value: 1 }));

    expect(tools.sent).toEqual([]);
  });

  it("dropSession forgets the session's keys and the tools subs", () => {
    const { harness, agent, session } = setup();
    const tools = harness.connect("tools");
    watchFrom(harness, tools, 1, 10);
    harness.send(agent, success(agentCalls(agent, "watch")[0]?.id ?? 0, NULL));
    const entry = harness.ctx.state.sessions.get(session);
    if (entry === undefined) throw new Error("no session");

    dropSession(harness.ctx, entry);

    expect(harness.ctx.state.shared.size).toBe(0);
    expect(harness.toolsConn(tools).subs.size).toBe(0);
  });
});

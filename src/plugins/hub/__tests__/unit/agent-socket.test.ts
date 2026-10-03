/* eslint-disable unicorn/no-null -- null is a JSON value on the wire */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notification, request, success, toWireValue } from "../../../registry/protocol";
import { forward } from "../../routing/calls";
import { createHarness, errorOf, helloOf, MANIFEST, NULL, paramsOf, resultOf } from "../helpers";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_790_000_000_000);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("agent hello", () => {
  it("opens a session and tells the agent its id on channel editor at once (R6)", () => {
    const harness = createHarness();
    const agent = harness.connect("agent");

    harness.send(agent, helloOf());

    const messages = agent.messages();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      jsonrpc: "2.0",
      channel: "editor",
      method: "session",
      params: { id: expect.stringMatching(/^s-[\da-f]{4}$/), game: MANIFEST.game, open: true }
    });
    const id = paramsOf(messages[0])?.id;
    expect(harness.agentConn(agent).session).toBe(id);
    expect(harness.ctx.state.sessions.get(String(id))).toMatchObject({
      conn: agent.data.conn,
      connectedAt: 1_790_000_000_000,
      lastBeatAt: 1_790_000_000_000,
      silent: false,
      heartbeat: null
    });
  });

  it("emits hub:session open and tells tools: session, then sessions", () => {
    const harness = createHarness();
    const tools = harness.connect("tools");
    tools.clear();

    const { session } = harness.hello();

    expect(harness.ctx.emit).toHaveBeenCalledWith("hub:session", {
      id: session,
      game: MANIFEST.game,
      open: true
    });
    const methods = tools.messages().map(message => ("method" in message ? message.method : ""));
    expect(methods).toEqual(["session", "sessions"]);
    expect(paramsOf(tools.notes("editor", "session")[0])).toEqual({
      id: session,
      game: MANIFEST.game,
      open: true
    });
  });

  it("logs a failed emit instead of throwing", () => {
    const harness = createHarness();
    harness.ctx.emit.mockImplementation(() => {
      throw new Error("hook exploded");
    });

    expect(() => harness.hello()).not.toThrow();
    expect(harness.ctx.log.error).toHaveBeenCalledWith("hub:emit-failed", expect.any(Object));
  });

  it("closes 1008 when the first message is not hello (H28)", () => {
    const harness = createHarness();
    const agent = harness.connect("agent");

    harness.send(agent, notification("game", "heartbeat", { frame: 1, paused: false, at: 1 }));

    expect(agent.closes).toEqual([{ code: 1008, reason: "hello first" }]);
    expect(harness.ctx.state.sessions.size).toBe(0);
  });

  it("closes 1008 on a request before hello", () => {
    const harness = createHarness();
    const agent = harness.connect("agent");

    harness.send(agent, request(1, "game", "read", { id: "x" }));

    expect(agent.closes[0]?.code).toBe(1008);
  });

  it("closes 1008 on a second hello (H29)", () => {
    const harness = createHarness();
    const { agent } = harness.hello();

    harness.send(agent, helloOf());

    expect(agent.closes).toEqual([{ code: 1008, reason: "hello twice" }]);
    expect(harness.ctx.state.sessions.size).toBe(1);
  });

  it("closes 1008 on a bad manifest (H30)", () => {
    const noSources = Object.fromEntries(
      Object.entries(MANIFEST).filter(([key]) => key !== "sources")
    );
    const bad = [
      noSources,
      { ...MANIFEST, sources: [{ id: "a".repeat(129), title: "t", input: {}, changes: "frame" }] },
      { ...MANIFEST, commands: [{ id: "c", title: "c", input: {}, effect: "sudo" }] }
    ];
    for (const manifest of bad) {
      const harness = createHarness();
      const agent = harness.connect("agent");

      harness.send(agent, helloOf(toWireValue(manifest)));

      expect(agent.closes).toEqual([{ code: 1008, reason: "bad manifest" }]);
      expect(harness.ctx.state.sessions.size).toBe(0);
      expect(harness.ctx.emit).not.toHaveBeenCalled();
    }
  });

  it("closes 1008 on a hello without params", () => {
    const harness = createHarness();
    const agent = harness.connect("agent");

    harness.send(agent, notification("game", "hello"));

    expect(agent.closes[0]?.code).toBe(1008);
  });
});

describe("agent heartbeat", () => {
  it("stores it and forwards it to every tools conn with the session", () => {
    const harness = createHarness();
    const { agent, session } = harness.hello();
    const first = harness.connect("tools");
    const second = harness.connect("tools");
    first.clear();
    second.clear();
    vi.setSystemTime(1_790_000_001_000);

    harness.send(agent, notification("game", "heartbeat", { frame: 12, paused: false, at: 5 }));

    const entry = harness.ctx.state.sessions.get(session);
    expect(entry?.heartbeat).toEqual({ frame: 12, paused: false, at: 5 });
    expect(entry?.lastBeatAt).toBe(1_790_000_001_000);
    const forwarded = {
      jsonrpc: "2.0",
      channel: "game",
      method: "heartbeat",
      params: { frame: 12, paused: false, at: 5 },
      session
    };
    expect(first.messages()).toEqual([forwarded]);
    expect(second.messages()).toEqual([forwarded]);
  });

  it("drops it for a congested tools conn", () => {
    const harness = createHarness();
    const { agent } = harness.hello();
    const tools = harness.connect("tools");
    tools.clear();
    harness.toolsConn(tools).congested = true;

    harness.send(agent, notification("game", "heartbeat", { frame: 12, paused: false, at: 5 }));

    expect(tools.sent).toEqual([]);
  });

  it("ignores a malformed heartbeat and counts it", () => {
    const harness = createHarness();
    const { agent, session } = harness.hello();
    const tools = harness.connect("tools");
    tools.clear();

    harness.send(
      agent,
      notification("game", "heartbeat", { frame: Number.MAX_VALUE, paused: "no", at: 1 })
    );

    expect(harness.ctx.state.sessions.get(session)?.heartbeat).toBeNull();
    expect(tools.sent).toEqual([]);
    expect(harness.agentConn(agent).invalid).toBe(1);
  });
});

describe("agent requests and responses", () => {
  it("answers any agent request -32007 unauthorized; nothing dispatched (H26, H27)", () => {
    const harness = createHarness();
    const { agent } = harness.hello();

    harness.send(agent, request(5, "files", "write", { path: "src/a.ts", text: "x" }));
    harness.send(agent, request(6, "game", "run", { id: "game.step", input: { frames: 1 } }));
    harness.send(agent, request(7, "editor", "sessions"));

    const unauthorized = {
      code: -32_007,
      message: "[moku-editor] agents cannot send requests",
      data: { reason: "unauthorized", retryable: false }
    };
    expect(errorOf(agent, 5)).toEqual(unauthorized);
    expect(errorOf(agent, 6)).toEqual(unauthorized);
    expect(errorOf(agent, 7)).toEqual(unauthorized);
    expect(harness.ctx.files.write).not.toHaveBeenCalled();
    expect(agent.closes).toEqual([]);
  });

  it("settles a pending call with its response", () => {
    const harness = createHarness();
    const { agent, session } = harness.hello();
    const tools = harness.connect("tools");
    const entry = harness.ctx.state.sessions.get(session);
    if (entry === undefined) throw new Error("no session");
    forward(
      harness.ctx,
      entry,
      "read",
      { id: "game.position" },
      { kind: "tools", conn: tools.data.conn, toolsId: 77 }
    );
    const hubId = agent.requests()[0]?.id ?? 0;

    harness.send(agent, success(hubId, { frame: 3 }));

    expect(resultOf(tools, 77)).toEqual({ frame: 3 });
  });

  it("ignores a response with an unknown id (late) at debug level", () => {
    const harness = createHarness();
    const { agent } = harness.hello();

    harness.send(agent, success(404, NULL));

    expect(harness.ctx.log.debug).toHaveBeenCalledWith("hub:late-response", { id: 404 });
    expect(agent.closes).toEqual([]);
  });

  it("ignores an unknown notification", () => {
    const harness = createHarness();
    const { agent } = harness.hello();

    harness.send(agent, notification("game", "dance"));

    expect(agent.closes).toEqual([]);
    expect(agent.sent).toEqual([]);
  });
});

describe("agent bye and close", () => {
  it("fails pending calls -32001, emits hub:session closed and tells tools (game_reloaded)", () => {
    const harness = createHarness();
    const { agent, session } = harness.hello();
    const tools = harness.connect("tools");
    const entry = harness.ctx.state.sessions.get(session);
    if (entry === undefined) throw new Error("no session");
    forward(
      harness.ctx,
      entry,
      "read",
      { id: "game.position" },
      { kind: "tools", conn: tools.data.conn, toolsId: 5 }
    );
    tools.clear();
    harness.ctx.emit.mockClear();

    harness.close(agent);

    expect(errorOf(tools, 5)).toEqual({
      code: -32_001,
      message: "[moku-editor] game reloaded",
      data: { retryable: true, reason: "game_reloaded" }
    });
    expect(harness.ctx.emit).toHaveBeenCalledWith("hub:session", {
      id: session,
      game: MANIFEST.game,
      open: false,
      reason: "game_reloaded"
    });
    expect(paramsOf(tools.notes("editor", "session")[0])).toEqual({
      id: session,
      game: MANIFEST.game,
      open: false,
      reason: "game_reloaded"
    });
    expect(paramsOf(tools.notes("editor", "sessions")[0])).toEqual({ list: [] });
    expect(harness.ctx.state.sessions.size).toBe(0);
    expect(harness.ctx.state.conns.has(agent.data.conn)).toBe(false);
  });

  it("closes with reason bye after a bye notification", () => {
    const harness = createHarness();
    const { agent, session } = harness.hello();

    harness.send(agent, notification("game", "bye"));
    expect(harness.agentConn(agent).bye).toBe(true);
    harness.close(agent, 1000);

    expect(harness.ctx.emit).toHaveBeenLastCalledWith("hub:session", {
      id: session,
      game: MANIFEST.game,
      open: false,
      reason: "bye"
    });
  });

  it("closing before hello emits nothing", () => {
    const harness = createHarness();
    const agent = harness.connect("agent");

    harness.close(agent);

    expect(harness.ctx.emit).not.toHaveBeenCalled();
    expect(harness.ctx.state.conns.size).toBe(0);
  });
});

describe("agent frames", () => {
  it("closes 1003 on a binary frame (H34)", () => {
    const harness = createHarness();
    const { agent } = harness.hello();

    harness.handler.message(agent, new Uint8Array([1, 2, 3]));

    expect(agent.closes).toEqual([{ code: 1003, reason: "binary frames are not accepted" }]);
  });

  it("counts undecodable frames and closes 1008 at the tenth (H35)", () => {
    const harness = createHarness();
    const { agent } = harness.hello();

    for (let index = 0; index < 9; index += 1) harness.handler.message(agent, "{nope");
    expect(agent.closes).toEqual([]);
    expect(harness.agentConn(agent).invalid).toBe(9);

    harness.handler.message(agent, "[]");
    expect(agent.closes).toEqual([{ code: 1008, reason: "too many invalid messages" }]);
  });
});

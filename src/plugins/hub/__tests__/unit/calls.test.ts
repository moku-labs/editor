import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Json } from "../../../registry/protocol";
import { failure, success } from "../../../registry/protocol";
import { deadlineFor, failSession, forward, settle } from "../../routing/calls";
import type { Session } from "../../types";
import type { Harness } from "../helpers";
import { createHarness, errorOf, NULL, resultOf } from "../helpers";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/**
 * A hub with one agent session and one tools conn.
 *
 * @param callTimeoutMs - The call timeout.
 * @returns The harness, the sockets and the session.
 */
function setup(callTimeoutMs = 5000) {
  const harness: Harness = createHarness({ callTimeoutMs });
  const { agent, session } = harness.hello();
  const tools = harness.connect("tools");
  tools.clear();
  const entry = harness.ctx.state.sessions.get(session);
  if (entry === undefined) throw new Error("no session");
  return { harness, agent, tools, session: entry };
}

/**
 * Forwards a call answered to a tools request id.
 *
 * @param harness - The harness.
 * @param session - The session.
 * @param toolsConn - The tools connection number.
 * @param toolsId - The tools request id.
 * @param method - The method.
 * @param params - The params.
 */
function call(
  harness: Harness,
  session: Session,
  toolsConn: number,
  toolsId: number,
  method = "read",
  params?: Parameters<typeof forward>[3]
): void {
  forward(harness.ctx, session, method, params ?? { id: "game.position" }, {
    kind: "tools",
    conn: toolsConn,
    toolsId
  });
}

/**
 * The params of a run of editor.sheet.
 *
 * @param input - The sheet input.
 * @returns The params.
 */
function sheet(input: Json): Json {
  return { id: "editor.sheet", input };
}

describe("deadlineFor (R1)", () => {
  it("is callTimeoutMs for every ordinary call", () => {
    expect(deadlineFor("read", { id: "game.position" }, 5000)).toBe(5000);
    expect(deadlineFor("run", { id: "game.step", input: { frames: 1 } }, 5000)).toBe(5000);
    expect(deadlineFor("watch", undefined, 5000)).toBe(5000);
  });

  it("adds durationMs for a run of editor.series", () => {
    const params = { id: "editor.series", input: { durationMs: 20_000, intervalMs: 100 } };

    expect(deadlineFor("run", params, 5000)).toBe(25_000);
  });

  it("caps the extension at 60 s", () => {
    const params = { id: "editor.series", input: { durationMs: 90_000, intervalMs: 100 } };

    expect(deadlineFor("run", params, 5000)).toBe(65_000);
  });

  it("adds frames × everyMs for a run of editor.sheet, capped at 60 s", () => {
    expect(deadlineFor("run", sheet({ frames: 6, everyMs: 500, maxWidth: 1080 }), 5000)).toBe(8000);
    expect(deadlineFor("run", sheet({ frames: 12, everyMs: 5000 }), 5000)).toBe(65_000);
    expect(deadlineFor("run", sheet({ frames: 13, everyMs: 5000 }), 5000)).toBe(65_000);
  });

  it("keeps callTimeoutMs for editor.sheet without good frames and everyMs, or a read of it", () => {
    expect(deadlineFor("run", sheet({ frames: 6 }), 5000)).toBe(5000);
    expect(deadlineFor("run", sheet({ frames: "6", everyMs: 500 }), 5000)).toBe(5000);
    expect(deadlineFor("run", sheet({ frames: 6, everyMs: -1 }), 5000)).toBe(5000);
    expect(deadlineFor("run", { id: "editor.sheet" }, 5000)).toBe(5000);
    expect(deadlineFor("read", sheet({ frames: 6, everyMs: 500 }), 5000)).toBe(5000);
    expect(
      deadlineFor("run", { id: "game.capture", input: { frames: 6, everyMs: 500 } }, 5000)
    ).toBe(5000);
  });

  it("ignores durationMs on another id, a read of editor.series, or a bad value", () => {
    expect(deadlineFor("run", { id: "game.step", input: { durationMs: 20_000 } }, 5000)).toBe(5000);
    expect(deadlineFor("read", { id: "editor.series", input: { durationMs: 20_000 } }, 5000)).toBe(
      5000
    );
    expect(deadlineFor("run", { id: "editor.series", input: { durationMs: -1 } }, 5000)).toBe(5000);
    expect(deadlineFor("run", { id: "editor.series", input: { durationMs: "9" } }, 5000)).toBe(
      5000
    );
    expect(deadlineFor("run", { id: "editor.series" }, 5000)).toBe(5000);
    expect(deadlineFor("run", [], 5000)).toBe(5000);
  });
});

describe("forward and settle", () => {
  it("remaps ids: the agent sees the hub id, tools get their own id back", () => {
    const { harness, agent, tools, session } = setup();
    call(harness, session, tools.data.conn, 41);
    call(harness, session, tools.data.conn, 42, "run", { id: "game.step", input: { frames: 1 } });

    const [first, second] = agent.requests();
    expect(first).toEqual({
      jsonrpc: "2.0",
      id: 1,
      channel: "game",
      method: "read",
      params: { id: "game.position" }
    });
    expect(second?.id).toBe(2);
    expect(harness.toolsConn(tools).pending).toBe(2);

    settle(harness.ctx, success(2, { value: 1, state: { path: "a", frame: 1, tainted: false } }));
    settle(harness.ctx, success(1, { frame: 7 }));

    expect(resultOf(tools, 41)).toEqual({ frame: 7 });
    expect(resultOf(tools, 42)).toEqual({
      value: 1,
      state: { path: "a", frame: 1, tainted: false }
    });
    expect(harness.ctx.state.pending.size).toBe(0);
    expect(harness.toolsConn(tools).pending).toBe(0);
  });

  it("passes an agent error through unchanged", () => {
    const { harness, tools, session } = setup();
    call(harness, session, tools.data.conn, 7);
    const error = {
      code: -32_602,
      message: "[moku-editor] frames must be a number",
      data: { field: "frames" }
    };

    settle(harness.ctx, failure(1, error));

    expect(errorOf(tools, 7)).toEqual(error);
  });

  it("ignores a late response and logs it at debug", () => {
    const { harness, tools } = setup();

    settle(harness.ctx, success(99, NULL));

    expect(tools.sent).toEqual([]);
    expect(harness.ctx.log.debug).toHaveBeenCalledWith("hub:late-response", { id: 99 });
  });

  it("discards the answer when the tools conn is gone", () => {
    const { harness, tools, session } = setup();
    call(harness, session, tools.data.conn, 7);
    harness.close(tools);

    expect(() => settle(harness.ctx, success(1, NULL))).not.toThrow();
    expect(tools.sent).toEqual([]);
  });

  it("answers -32001 when the agent conn is missing", () => {
    const { harness, agent, tools, session } = setup();
    harness.ctx.state.conns.delete(agent.data.conn);

    call(harness, session, tools.data.conn, 7);

    expect(errorOf(tools, 7)).toMatchObject({ code: -32_001, data: { reason: "game_reloaded" } });
    expect(harness.ctx.state.pending.size).toBe(0);
  });
});

describe("timeouts", () => {
  it("fails -32002 timeout, retryable, after callTimeoutMs", () => {
    const { harness, tools, session } = setup(300);
    call(harness, session, tools.data.conn, 7);

    vi.advanceTimersByTime(299);
    expect(errorOf(tools, 7)).toBeUndefined();

    vi.advanceTimersByTime(1);
    expect(errorOf(tools, 7)).toEqual({
      code: -32_002,
      message: "[moku-editor] call timed out",
      data: { retryable: true, reason: "timeout" }
    });
    expect(harness.ctx.state.pending.size).toBe(0);
    expect(harness.toolsConn(tools).pending).toBe(0);
  });

  it("waits durationMs longer for a run of editor.series", () => {
    const { harness, tools, session } = setup();
    call(harness, session, tools.data.conn, 7, "run", {
      id: "editor.series",
      input: { durationMs: 20_000, intervalMs: 100 }
    });

    vi.advanceTimersByTime(24_999);
    expect(errorOf(tools, 7)).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(errorOf(tools, 7)?.code).toBe(-32_002);
  });

  it("a response after the timeout is late", () => {
    const { harness, tools, session } = setup(300);
    call(harness, session, tools.data.conn, 7);
    vi.advanceTimersByTime(300);
    tools.clear();

    settle(harness.ctx, success(1, NULL));

    expect(tools.sent).toEqual([]);
  });
});

describe("failSession", () => {
  it("fails every pending call of that session only with -32001 retryable", () => {
    const harness = createHarness();
    const first = harness.hello();
    const second = harness.hello();
    const tools = harness.connect("tools");
    const sessionA = harness.ctx.state.sessions.get(first.session);
    const sessionB = harness.ctx.state.sessions.get(second.session);
    if (sessionA === undefined || sessionB === undefined) throw new Error("no sessions");
    call(harness, sessionA, tools.data.conn, 1);
    call(harness, sessionA, tools.data.conn, 2);
    call(harness, sessionB, tools.data.conn, 3);

    failSession(harness.ctx, first.session);

    const reloaded = {
      code: -32_001,
      message: "[moku-editor] game reloaded",
      data: { retryable: true, reason: "game_reloaded" }
    };
    expect(errorOf(tools, 1)).toEqual(reloaded);
    expect(errorOf(tools, 2)).toEqual(reloaded);
    expect(errorOf(tools, 3)).toBeUndefined();
    expect(harness.ctx.state.pending.size).toBe(1);

    vi.advanceTimersByTime(10_000);
    expect(errorOf(tools, 1)).toEqual(reloaded);
  });
});

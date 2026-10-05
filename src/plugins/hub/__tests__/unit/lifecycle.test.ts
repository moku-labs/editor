import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startHub, stopHub } from "../../lifecycle";
import { createCtx, createHarness } from "../helpers";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("startHub", () => {
  it("creates a new token every start and never logs it", () => {
    const first = createCtx();
    const second = createCtx();

    startHub(first);
    startHub(second);

    expect(first.state.token).toMatch(/^[\w-]{43}$/);
    expect(second.state.token).not.toBe(first.state.token);
    const logged = JSON.stringify([first.log.info.mock.calls, first.log.debug.mock.calls]);
    expect(logged).not.toContain(first.state.token ?? "none");
    stopHub(first);
    stopHub(second);
  });

  it("ticks the silent check every min(1000, silentAfterMs / 2) ms", () => {
    const harness = createHarness({ silentAfterMs: 600 });
    startHub(harness.ctx);
    const { session } = harness.hello();

    vi.advanceTimersByTime(600);
    expect(harness.ctx.state.sessions.get(session)?.silent).toBe(false);

    vi.advanceTimersByTime(300);
    expect(harness.ctx.state.sessions.get(session)?.silent).toBe(true);
    stopHub(harness.ctx);
  });

  it("ticks at most once a second with the default silentAfterMs", () => {
    const harness = createHarness();
    startHub(harness.ctx);
    const { session } = harness.hello();

    vi.advanceTimersByTime(6000);
    expect(harness.ctx.state.sessions.get(session)?.silent).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(harness.ctx.state.sessions.get(session)?.silent).toBe(true);
    stopHub(harness.ctx);
  });
});

describe("stopHub", () => {
  it("closes every socket with 1001, clears timers, maps and the token", () => {
    const harness = createHarness();
    startHub(harness.ctx);
    const { agent, session } = harness.hello();
    const tools = harness.connect("tools");
    const entry = harness.ctx.state.sessions.get(session);
    harness.send(tools, {
      jsonrpc: "2.0",
      id: 1,
      channel: "game",
      method: "read",
      params: { id: "game.position" }
    });
    harness.send(tools, {
      jsonrpc: "2.0",
      id: 2,
      channel: "game",
      method: "watch",
      params: { sub: 1, id: "game.position" }
    });
    tools.clear();

    stopHub(harness.ctx);

    expect(agent.closes).toEqual([{ code: 1001, reason: "editor stopping" }]);
    expect(tools.closes).toEqual([{ code: 1001, reason: "editor stopping" }]);
    const { state } = harness.ctx;
    expect(state.token).toBeUndefined();
    expect(state.silentTimer).toBeUndefined();
    expect([state.conns.size, state.sessions.size, state.pending.size, state.shared.size]).toEqual([
      0, 0, 0, 0
    ]);

    vi.advanceTimersByTime(60_000);
    expect(tools.sent).toEqual([]);
    expect(entry?.silent).toBe(false);
  });

  it("forgets the selection's page and keeps the selection as null: no page is left (A7)", () => {
    const harness = createHarness();
    startHub(harness.ctx);
    const page = harness.page();
    harness.send(page, {
      jsonrpc: "2.0",
      channel: "editor",
      method: "selection",
      params: { ref: { kind: "entity", id: 7 }, name: "slime", type: "entity", at: 1 }
    });

    stopHub(harness.ctx);

    expect(harness.ctx.state.selectionConn).toBeUndefined();
    expect(harness.ctx.state.published.get("selection")).toBeNull();
  });

  it("keeps no selection when none was published", () => {
    const harness = createHarness();
    startHub(harness.ctx);

    stopHub(harness.ctx);

    expect(harness.ctx.state.published.has("selection")).toBe(false);
  });

  it("runs with the teardown context only and twice in a row", () => {
    const ctx = createCtx();
    startHub(ctx);

    expect(() => {
      stopHub({ state: ctx.state });
      stopHub({ state: ctx.state });
    }).not.toThrow();
  });
});

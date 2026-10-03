/* eslint-disable unicorn/no-null -- null is a JSON value on the wire */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Json, Manifest } from "../../../registry/protocol";
import { notification, toWireValue } from "../../../registry/protocol";
import {
  chooseSession,
  isManifest,
  PAUSED_SILENT_AFTER_MS,
  sessionIdFrom,
  sessionList,
  tickSilent,
  toSessionInfo
} from "../../routing/sessions";
import type { Session } from "../../types";
import { createHarness, MANIFEST, paramsOf } from "../helpers";

/**
 * A manifest with changes applied, as plain JSON.
 *
 * @param changes - Top-level fields to replace.
 * @returns The manifest JSON.
 */
function manifestWith(changes: Record<string, Json>): Json {
  const base = toWireValue(MANIFEST);
  return typeof base === "object" && base !== null && !Array.isArray(base)
    ? { ...base, ...changes }
    : base;
}

/**
 * A session record for direct tests.
 *
 * @param id - Session id.
 * @param connectedAt - Epoch ms.
 * @param embedded - Manifest embedded flag.
 * @returns The session.
 */
function sessionOf(id: string, connectedAt: number, embedded = false): Session {
  return {
    id,
    conn: 1,
    manifest: { ...MANIFEST, embedded },
    connectedAt,
    heartbeat: null,
    lastBeatAt: connectedAt,
    silent: false,
    nextSub: 1
  };
}

/**
 * The manifest without its sources, as plain JSON.
 *
 * @returns The manifest JSON.
 */
function withoutSources(): Json {
  const base = toWireValue(MANIFEST);
  return typeof base === "object" && base !== null && !Array.isArray(base)
    ? Object.fromEntries(Object.entries(base).filter(([key]) => key !== "sources"))
    : base;
}

/**
 * A source descriptor with an id.
 *
 * @param id - Source id.
 * @returns The descriptor JSON.
 */
function source(id: string): Json {
  return { id, title: "t", input: {}, changes: "frame" };
}

/**
 * A command descriptor with an effect.
 *
 * @param effect - Command effect.
 * @returns The descriptor JSON.
 */
function command(effect: string): Json {
  return { id: "c", title: "c", input: {}, effect };
}

/**
 * The error a call throws.
 *
 * @param run - The call.
 * @returns The thrown error.
 */
function thrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("did not throw");
}

describe("isManifest", () => {
  it("accepts a well-formed manifest, with or without panels", () => {
    expect(isManifest(toWireValue(MANIFEST))).toBe(true);
    expect(isManifest(manifestWith({ panels: [] }))).toBe(true);
    expect(isManifest(manifestWith({ panels: [{ id: "p", module: "/p.js" }] }))).toBe(true);
  });

  it("rejects non-objects", () => {
    expect(isManifest(null)).toBe(false);
    expect(isManifest([])).toBe(false);
    expect(isManifest("manifest")).toBe(false);
  });

  it("rejects missing or wrong top-level fields (H30)", () => {
    expect(isManifest(withoutSources())).toBe(false);
    expect(isManifest(manifestWith({ commands: {} }))).toBe(false);
    expect(isManifest(manifestWith({ game: 1 }))).toBe(false);
    expect(isManifest(manifestWith({ page: "x".repeat(2049) }))).toBe(false);
    expect(isManifest(manifestWith({ game: "x".repeat(2049) }))).toBe(false);
    expect(isManifest(manifestWith({ embedded: "yes" }))).toBe(false);
    expect(isManifest(manifestWith({ panels: "none" }))).toBe(false);
    expect(isManifest(manifestWith({ panels: [{ id: 1 }] }))).toBe(false);
  });

  it("rejects a 129-character id and accepts 128 (H30)", () => {
    expect(isManifest(manifestWith({ sources: [source("a".repeat(129))] }))).toBe(false);
    expect(isManifest(manifestWith({ sources: [source("a".repeat(128))] }))).toBe(true);
    expect(isManifest(manifestWith({ sources: [source("")] }))).toBe(false);
  });

  it("rejects an unknown effect, changes or input kind (H30)", () => {
    expect(isManifest(manifestWith({ commands: [command("sudo")] }))).toBe(false);
    expect(isManifest(manifestWith({ commands: [command("raw")] }))).toBe(true);
    expect(
      isManifest(manifestWith({ sources: [{ id: "s", title: "s", input: {}, changes: "always" }] }))
    ).toBe(false);
    expect(
      isManifest(
        manifestWith({ sources: [{ id: "s", title: "s", input: { a: "int" }, changes: "frame" }] })
      )
    ).toBe(false);
    expect(
      isManifest(
        manifestWith({
          sources: [{ id: "s", title: "s", input: { a: "json?" }, changes: "frame" }]
        })
      )
    ).toBe(true);
    expect(isManifest(manifestWith({ sources: [{ id: "s", input: {}, changes: "frame" }] }))).toBe(
      false
    );
    expect(
      isManifest(manifestWith({ sources: [{ id: "s", title: "s", input: [], changes: "frame" }] }))
    ).toBe(false);
  });

  it("rejects more than 1000 sources or commands", () => {
    const many = Array.from({ length: 1001 }, (_, index) => ({
      id: `c${index}`,
      title: "c",
      input: {},
      effect: "read"
    }));

    expect(isManifest(manifestWith({ commands: many }))).toBe(false);
    expect(isManifest(manifestWith({ commands: many.slice(0, 1000) }))).toBe(true);
  });
});

describe("sessionIdFrom", () => {
  it("builds s- plus four hex digits and retries on collision", () => {
    const taken = new Map([["s-0000", true]]);
    const hex = ["0000", "0000", "7f3a"];
    const id = sessionIdFrom(taken, () => hex.shift() ?? "ffff");

    expect(id).toBe("s-7f3a");
  });

  it("uses random hex by default", () => {
    expect(sessionIdFrom(new Map())).toMatch(/^s-[\da-f]{4}$/);
  });
});

describe("toSessionInfo and sessionList", () => {
  it("returns exactly the five R1 keys", () => {
    const info = toSessionInfo(sessionOf("s-1", 10, true));

    expect(Object.keys(info).toSorted()).toEqual(["connectedAt", "embedded", "game", "id", "page"]);
    expect(info).toEqual({
      id: "s-1",
      game: MANIFEST.game,
      page: MANIFEST.page,
      embedded: true,
      connectedAt: 10
    });
  });

  it("orders by connectedAt", () => {
    const { ctx } = createHarness();
    ctx.state.sessions.set("s-b", sessionOf("s-b", 20));
    ctx.state.sessions.set("s-a", sessionOf("s-a", 10));

    expect(sessionList(ctx.state).map(info => info.id)).toEqual(["s-a", "s-b"]);
  });
});

describe("chooseSession", () => {
  it("returns the requested open session", () => {
    const { ctx } = createHarness();
    ctx.state.sessions.set("s-a", sessionOf("s-a", 1));
    ctx.state.sessions.set("s-b", sessionOf("s-b", 2));

    expect(chooseSession(ctx, "s-b").id).toBe("s-b");
  });

  it("fails -32003 no_session naming an unknown requested id", () => {
    const { ctx } = createHarness();
    ctx.state.sessions.set("s-a", sessionOf("s-a", 1));

    expect(thrown(() => chooseSession(ctx, "s-x"))).toMatchObject({
      code: -32_003,
      message: expect.stringMatching(/^\[moku-editor] /),
      data: { reason: "no_session", retryable: false, id: "s-x" }
    });
  });

  it("fails -32003 no_session when none is open", () => {
    const { ctx } = createHarness();

    expect(thrown(() => chooseSession(ctx, undefined))).toMatchObject({
      code: -32_003,
      data: { reason: "no_session", retryable: false }
    });
  });

  it("returns the only session", () => {
    const { ctx } = createHarness();
    ctx.state.sessions.set("s-a", sessionOf("s-a", 1));

    expect(chooseSession(ctx, undefined).id).toBe("s-a");
  });

  it("returns the one embedded session among several", () => {
    const { ctx } = createHarness();
    ctx.state.sessions.set("s-a", sessionOf("s-a", 1));
    ctx.state.sessions.set("s-b", sessionOf("s-b", 2, true));

    expect(chooseSession(ctx, undefined).id).toBe("s-b");
  });

  it("fails -32003 choose_session with zero or several embedded", () => {
    const { ctx } = createHarness();
    ctx.state.sessions.set("s-a", sessionOf("s-a", 1));
    ctx.state.sessions.set("s-b", sessionOf("s-b", 2));

    expect(thrown(() => chooseSession(ctx, undefined))).toMatchObject({
      code: -32_003,
      data: { reason: "choose_session", retryable: false }
    });

    ctx.state.sessions.set("s-a", sessionOf("s-a", 1, true));
    ctx.state.sessions.set("s-b", sessionOf("s-b", 2, true));
    expect(thrown(() => chooseSession(ctx, undefined))).toMatchObject({
      data: { reason: "choose_session" }
    });
  });
});

describe("tickSilent (R6)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks a session silent after silentAfterMs, once, and broadcasts nothing", () => {
    const harness = createHarness();
    const tools = harness.connect("tools");
    const { session } = harness.hello();
    tools.clear();
    const entry = harness.ctx.state.sessions.get(session);

    tickSilent(harness.ctx, 1_000_000 + 6000);
    expect(entry?.silent).toBe(false);

    tickSilent(harness.ctx, 1_000_000 + 6001);
    tickSilent(harness.ctx, 1_000_000 + 9000);
    expect(entry?.silent).toBe(true);
    expect(harness.ctx.log.info).toHaveBeenCalledWith("hub:session-silent", {
      id: session,
      paused: false
    });
    expect(
      harness.ctx.log.info.mock.calls.filter(([event]) => event === "hub:session-silent")
    ).toHaveLength(1);
    expect(tools.sent).toEqual([]);
  });

  it("revives a silent session on heartbeat, logged and not broadcast", () => {
    const harness = createHarness();
    const { agent, session } = harness.hello();
    const tools = harness.connect("tools");
    tickSilent(harness.ctx, 1_000_000 + 7000);
    tools.clear();

    vi.setSystemTime(1_000_000 + 7000);
    harness.send(agent, notification("game", "heartbeat", { frame: 3, paused: false, at: 7 }));

    expect(harness.ctx.state.sessions.get(session)?.silent).toBe(false);
    expect(harness.ctx.log.info).toHaveBeenCalledWith("hub:session-alive", { id: session });
    expect(tools.notes("editor", "sessions")).toEqual([]);
    expect(tools.notes("editor", "session")).toEqual([]);
  });

  it("waits 65 s after a paused heartbeat", () => {
    const harness = createHarness();
    const { agent, session } = harness.hello();
    harness.send(agent, notification("game", "heartbeat", { frame: 3, paused: true, at: 1 }));
    const entry = harness.ctx.state.sessions.get(session);

    tickSilent(harness.ctx, 1_000_000 + 6001);
    tickSilent(harness.ctx, 1_000_000 + PAUSED_SILENT_AFTER_MS);
    expect(entry?.silent).toBe(false);

    tickSilent(harness.ctx, 1_000_000 + PAUSED_SILENT_AFTER_MS + 1);
    expect(entry?.silent).toBe(true);
    expect(harness.ctx.log.info).toHaveBeenCalledWith("hub:session-silent", {
      id: session,
      paused: true
    });
  });

  it("keeps PAUSED_SILENT_AFTER_MS at 65 s", () => {
    expect(PAUSED_SILENT_AFTER_MS).toBe(65_000);
  });
});

describe("session notifications", () => {
  it("sends tools the session list as SessionInfo", () => {
    const harness = createHarness();
    const tools = harness.connect("tools");
    const { session } = harness.hello();

    const lists = tools.notes("editor", "sessions");
    expect(paramsOf(lists.at(-1))).toEqual({
      list: [
        {
          id: session,
          game: MANIFEST.game,
          page: MANIFEST.page,
          embedded: false,
          connectedAt: expect.any(Number)
        }
      ]
    });
  });

  it("stores the manifest it was given", () => {
    const harness = createHarness();
    const manifest: Manifest = { ...MANIFEST, game: "other 1.0.0" };
    const { session } = harness.hello(manifest);

    expect(harness.ctx.state.sessions.get(session)?.manifest.game).toBe("other 1.0.0");
  });
});

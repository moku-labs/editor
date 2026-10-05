/* eslint-disable unicorn/no-null -- null is a JSON value on the wire */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Json, Manifest } from "../../../registry/protocol";
import { commandsHash, notification, toWireValue } from "../../../registry/protocol";
import {
  chooseSession,
  isManifest,
  PAUSED_SILENT_AFTER_MS,
  readHeartbeat,
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
    manifestHash: commandsHash(MANIFEST),
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

  it("accepts a well-formed restored entry and rejects a malformed one (R6)", () => {
    expect(isManifest(manifestWith({ restored: { bookmark: '{"path":"home"}', frame: 12 } }))).toBe(
      true
    );
    expect(isManifest(manifestWith({ restored: { bookmark: 1, frame: 12 } }))).toBe(false);
    expect(isManifest(manifestWith({ restored: { bookmark: "{}", frame: "12" } }))).toBe(false);
    expect(isManifest(manifestWith({ restored: "yes" }))).toBe(false);
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

describe("readHeartbeat", () => {
  it("reads finite frame and at with a boolean paused", () => {
    expect(readHeartbeat({ frame: 12, paused: false, at: 5 })).toEqual({
      frame: 12,
      paused: false,
      at: 5
    });
  });

  it("keeps a heap whose usedMb and limitMb are finite numbers", () => {
    const beat = readHeartbeat({
      frame: 12,
      paused: true,
      at: 5,
      heap: { usedMb: 12.8, limitMb: 4095.8 }
    });

    expect(beat).toEqual({
      frame: 12,
      paused: true,
      at: 5,
      heap: { usedMb: 12.8, limitMb: 4095.8 }
    });
  });

  it.each([
    ["a text usedMb", { usedMb: "12.8", limitMb: 4095.8 }],
    ["no limitMb", { usedMb: 12.8 }],
    ["a null limitMb", { usedMb: 12.8, limitMb: null }],
    ["an infinite usedMb", { usedMb: Number.POSITIVE_INFINITY, limitMb: 1 }],
    ["a list", [12.8, 4095.8]],
    ["a number", 12.8]
  ])("drops a heap with %s and keeps the beat", (_label, heap) => {
    const beat = readHeartbeat({ frame: 12, paused: false, at: 5, heap });

    expect(beat).toEqual({ frame: 12, paused: false, at: 5 });
    expect(beat !== undefined && "heap" in beat).toBe(false);
  });

  it("refuses a beat without a boolean paused, heap or not", () => {
    expect(readHeartbeat({ frame: 12, paused: "no", at: 5, heap: { usedMb: 1, limitMb: 2 } })).toBe(
      undefined
    );
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
  it("returns the five R1 keys and the manifest hash, no heartbeat before the first beat", () => {
    const info = toSessionInfo(sessionOf("s-1", 10, true));

    expect(Object.keys(info).toSorted()).toEqual([
      "connectedAt",
      "embedded",
      "game",
      "id",
      "manifestHash",
      "page"
    ]);
    expect(info).toEqual({
      id: "s-1",
      game: MANIFEST.game,
      page: MANIFEST.page,
      embedded: true,
      connectedAt: 10,
      manifestHash: commandsHash(MANIFEST)
    });
  });

  it("carries the hash kept on the session, not a fresh one", () => {
    const session: Session = { ...sessionOf("s-1", 10), manifestHash: "0badf00d" };

    expect(toSessionInfo(session).manifestHash).toBe("0badf00d");
  });

  it("adds the heartbeat readout: frame and paused of the last beat, and the silent flag", () => {
    const session: Session = {
      ...sessionOf("s-1", 10),
      heartbeat: { frame: 1840, paused: true, at: 5, heap: { usedMb: 12.8, limitMb: 4095.8 } },
      silent: true
    };

    const info = toSessionInfo(session);

    expect(Object.keys(info).toSorted()).toEqual([
      "connectedAt",
      "embedded",
      "game",
      "heartbeat",
      "id",
      "manifestHash",
      "page"
    ]);
    expect(info.heartbeat).toEqual({ frame: 1840, paused: true, silent: true });
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

  it("marks a session silent after silentAfterMs, once, and re-sends the sessions list once", () => {
    const harness = createHarness();
    const tools = harness.connect("tools");
    const { agent, session } = harness.hello();
    harness.send(agent, notification("game", "heartbeat", { frame: 3, paused: false, at: 1 }));
    tools.clear();
    const entry = harness.ctx.state.sessions.get(session);

    tickSilent(harness.ctx, 1_000_000 + 6000);
    expect(entry?.silent).toBe(false);
    expect(tools.sent).toEqual([]);

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
    const lists = tools.notes("editor", "sessions");
    expect(lists).toHaveLength(1);
    expect(paramsOf(lists[0])).toMatchObject({
      list: [{ id: session, heartbeat: { frame: 3, paused: false, silent: true } }]
    });
  });

  it("revives a silent session on heartbeat, logged, and re-sends the sessions list", () => {
    const harness = createHarness();
    const { agent, session } = harness.hello();
    harness.send(agent, notification("game", "heartbeat", { frame: 2, paused: false, at: 1 }));
    const tools = harness.connect("tools");
    tickSilent(harness.ctx, 1_000_000 + 7000);
    tools.clear();

    vi.setSystemTime(1_000_000 + 7000);
    harness.send(agent, notification("game", "heartbeat", { frame: 3, paused: false, at: 7 }));

    expect(harness.ctx.state.sessions.get(session)?.silent).toBe(false);
    expect(harness.ctx.log.info).toHaveBeenCalledWith("hub:session-alive", { id: session });
    const lists = tools.notes("editor", "sessions");
    expect(lists).toHaveLength(1);
    expect(paramsOf(lists[0])).toMatchObject({
      list: [{ id: session, heartbeat: { frame: 3, paused: false, silent: false } }]
    });
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

describe("recordHeartbeat: the sessions list on a paused flip (M4)", () => {
  it("does not re-send the list on the first beat of a session", () => {
    const harness = createHarness();
    const { agent } = harness.hello();
    const tools = harness.connect("tools");
    tools.clear();

    harness.send(agent, notification("game", "heartbeat", { frame: 1, paused: false, at: 1 }));

    expect(tools.notes("editor", "sessions")).toEqual([]);
  });

  it("does not re-send the list when only the frame changes", () => {
    const harness = createHarness();
    const { agent } = harness.hello();
    const tools = harness.connect("tools");
    harness.send(agent, notification("game", "heartbeat", { frame: 1, paused: false, at: 1 }));
    tools.clear();

    harness.send(agent, notification("game", "heartbeat", { frame: 2, paused: false, at: 2 }));
    harness.send(agent, notification("game", "heartbeat", { frame: 3, paused: false, at: 3 }));

    expect(tools.notes("editor", "sessions")).toEqual([]);
    expect(tools.notes("game", "heartbeat")).toHaveLength(2);
  });

  it("re-sends the list, with the new heartbeat readout, when paused flips either way", () => {
    const harness = createHarness();
    const { agent, session } = harness.hello();
    const tools = harness.connect("tools");
    harness.send(agent, notification("game", "heartbeat", { frame: 1, paused: false, at: 1 }));
    tools.clear();

    harness.send(agent, notification("game", "heartbeat", { frame: 2, paused: true, at: 2 }));
    harness.send(agent, notification("game", "heartbeat", { frame: 2, paused: true, at: 3 }));
    harness.send(agent, notification("game", "heartbeat", { frame: 2, paused: false, at: 4 }));

    const lists = tools.notes("editor", "sessions").map(note => paramsOf(note));
    expect(lists).toEqual([
      {
        list: [expect.objectContaining({ heartbeat: { frame: 2, paused: true, silent: false } })]
      },
      {
        list: [expect.objectContaining({ heartbeat: { frame: 2, paused: false, silent: false } })]
      }
    ]);
    expect(lists[0]).toMatchObject({ list: [{ id: session }] });
  });

  it("sends the list before the forwarded heartbeat of the flip", () => {
    const harness = createHarness();
    const { agent } = harness.hello();
    const tools = harness.connect("tools");
    harness.send(agent, notification("game", "heartbeat", { frame: 1, paused: false, at: 1 }));
    tools.clear();

    harness.send(agent, notification("game", "heartbeat", { frame: 2, paused: true, at: 2 }));

    expect(tools.messages().map(message => ("method" in message ? message.method : ""))).toEqual([
      "sessions",
      "heartbeat"
    ]);
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
          connectedAt: harness.ctx.state.sessions.get(session)?.connectedAt,
          manifestHash: commandsHash(MANIFEST)
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

  it("keeps the hash of the commands, computed once on hello", () => {
    const harness = createHarness();
    const { session } = harness.hello();

    expect(harness.ctx.state.sessions.get(session)?.manifestHash).toBe(commandsHash(MANIFEST));
  });

  it("gives two sessions with the same commands the same hash, whatever their order", () => {
    const harness = createHarness();
    harness.hello();
    harness.hello({ ...MANIFEST, game: "other 1.0.0", commands: MANIFEST.commands.toReversed() });

    const hashes = sessionList(harness.ctx.state).map(info => info.manifestHash);
    expect(hashes).toEqual([commandsHash(MANIFEST), commandsHash(MANIFEST)]);
  });

  it("gives a session with other commands another hash", () => {
    const harness = createHarness();
    const first = harness.hello();
    const second = harness.hello({ ...MANIFEST, commands: [] });

    const hashOf = (id: string) => harness.ctx.state.sessions.get(id)?.manifestHash;
    expect(hashOf(second.session)).not.toBe(hashOf(first.session));
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toWireValue } from "../../../registry/protocol";
import {
  applySessions,
  attach,
  closeChosen,
  pickSession,
  retrySession
} from "../../sessions/choose";
import { tagFrame } from "../../sessions/frame";
import { addManifestListener, currentManifest } from "../../sessions/manifest";
import {
  beat,
  connected,
  createCtx,
  FakeWebSocket,
  flush,
  latestSocket,
  manifestOf,
  sendSessions,
  sessionOf,
  type TestCtx
} from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Session choice (R7: embedded first, then newest by connectedAt), attach, loss
// ─────────────────────────────────────────────────────────────────────────────

describe("pickSession", () => {
  const plain = sessionOf("s-plain", { connectedAt: 5000 });
  const oldEmbedded = sessionOf("s-emb-old", { embedded: true, connectedAt: 1000 });
  const newEmbedded = sessionOf("s-emb-new", { embedded: true, connectedAt: 3000 });

  it("keeps a sticky current session", () => {
    expect(pickSession([plain, newEmbedded], "s-plain", true)).toBe("s-plain");
  });

  it("prefers embedded over non-embedded, the newest embedded first", () => {
    expect(pickSession([plain, oldEmbedded], "s-plain", false)).toBe("s-emb-old");
    expect(pickSession([oldEmbedded, newEmbedded, plain], undefined, false)).toBe("s-emb-new");
  });

  it("keeps the current session when there is no embedded one", () => {
    const newer = sessionOf("s-newer", { connectedAt: 9000 });
    expect(pickSession([plain, newer], "s-plain", false)).toBe("s-plain");
  });

  it("takes the only session, or the newest of several", () => {
    expect(pickSession([plain], undefined, false)).toBe("s-plain");
    expect(
      pickSession([plain, sessionOf("s-newer", { connectedAt: 9000 })], undefined, false)
    ).toBe("s-newer");
  });

  it("falls through when the sticky session is gone, and is undefined for none", () => {
    expect(pickSession([plain], "s-gone", true)).toBe("s-plain");
    expect(pickSession([], "s-gone", true)).toBeUndefined();
  });
});

describe("pickSession with the frame id of this tools page", () => {
  const FRAME = "f-mine";
  const own = sessionOf("s-own", {
    embedded: true,
    page: tagFrame("http://127.0.0.1:3000/", FRAME),
    connectedAt: 1000
  });
  const otherTab = sessionOf("s-other", {
    embedded: true,
    page: tagFrame("http://127.0.0.1:3000/", "f-other"),
    connectedAt: 9000
  });
  const untagged = sessionOf("s-untagged", { embedded: true, connectedAt: 5000 });
  const plain = sessionOf("s-plain", { connectedAt: 7000 });

  it("prefers its own frame over a newer embedded session of any kind", () => {
    expect(pickSession([otherTab, untagged, own, plain], undefined, false, FRAME)).toBe("s-own");
    expect(pickSession([otherTab, own], "s-other", false, FRAME)).toBe("s-own");
  });

  it("never picks another tab's frame on its own", () => {
    expect(pickSession([otherTab], undefined, false, FRAME)).toBeUndefined();
    expect(pickSession([otherTab, plain], undefined, false, FRAME)).toBe("s-plain");
    expect(pickSession([otherTab, untagged, plain], undefined, false, FRAME)).toBe("s-untagged");
  });

  it("keeps another tab's frame when it was chosen (sticky)", () => {
    expect(pickSession([otherTab, own], "s-other", true, FRAME)).toBe("s-other");
  });

  it("keeps the current session among the rest without an embedded one", () => {
    const newer = sessionOf("s-newer", { connectedAt: 9500 });
    expect(pickSession([otherTab, plain, newer], "s-plain", false, FRAME)).toBe("s-plain");
  });

  it("a page tagged with another id but not embedded is a plain page", () => {
    const copied = sessionOf("s-copied", { page: otherTab.page, connectedAt: 9900 });
    expect(pickSession([plain, copied], undefined, false, FRAME)).toBe("s-copied");
  });
});

describe("sessions flow", () => {
  let ctx: TestCtx;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    vi.stubGlobal("WebSocket", FakeWebSocket);
    FakeWebSocket.instances.length = 0;
    ctx = createCtx();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("attaches the pick: manifest requested with the session, cached, listeners called", async () => {
    const seen: unknown[] = [];
    addManifestListener(ctx, manifest => seen.push(manifest?.game));
    const socket = await connected(ctx);

    expect(socket.last("manifest").session).toBe("s-1");
    expect(currentManifest(ctx.state)).toEqual(manifestOf());
    expect(ctx.state.manifests.has("s-1")).toBe(true);
    expect(seen).toEqual(["merge-game 0.0.0"]);
    expect(ctx.emit).toHaveBeenCalledWith("link:status", {
      status: { kind: "connecting" },
      session: "s-1"
    });
  });

  it("an empty list at connecting → empty", async () => {
    await connected(ctx, []);
    expect(ctx.state.status).toEqual({ kind: "empty" });
    expect(ctx.state.chosen).toBeUndefined();
  });

  it("the same list again attaches nothing new", async () => {
    const socket = await connected(ctx);
    sendSessions(socket, [sessionOf("s-1")]);
    await flush();
    expect(socket.requests("manifest")).toHaveLength(1);
    expect(ctx.state.generation).toBe(1);
  });

  it("drops manifests of sessions that left the list", async () => {
    const socket = await connected(ctx);
    ctx.state.manifests.set("s-gone", manifestOf());
    sendSessions(socket, [sessionOf("s-1")]);
    expect(ctx.state.manifests.has("s-gone")).toBe(false);
  });

  it("an embedded session appearing takes over and the old subs are unwatched", async () => {
    const socket = await connected(ctx);
    ctx.state.wire.set(4, {
      key: 1,
      id: "game.position",
      input: undefined,
      onValue: vi.fn(),
      wireSub: 4
    });
    sendSessions(socket, [sessionOf("s-1"), sessionOf("s-2", { embedded: true })]);

    expect(ctx.state.chosen).toBe("s-2");
    expect(socket.last("unwatch")).toMatchObject({ params: { sub: 4 }, session: "s-1" });
    expect(socket.last("manifest").session).toBe("s-2");
  });

  it("a second tools tab's game appearing does not take the attached own frame over", async () => {
    const own = sessionOf("s-own", {
      embedded: true,
      page: tagFrame("http://127.0.0.1:3000/", ctx.state.frame)
    });
    const otherTab = sessionOf("s-other", {
      embedded: true,
      page: tagFrame("http://127.0.0.1:3000/", "f-other"),
      connectedAt: 9000
    });
    const socket = await connected(ctx, [own]);
    sendSessions(socket, [own, otherTab]);
    await flush();

    expect(ctx.state.chosen).toBe("s-own");
    expect(socket.requests("manifest")).toHaveLength(1);
    expect(socket.requests("unwatch")).toHaveLength(0);
  });

  it("while its own frame reloads it waits for it instead of attaching another tab's", async () => {
    const page = tagFrame("http://127.0.0.1:3000/", ctx.state.frame);
    const otherTab = sessionOf("s-other", {
      embedded: true,
      page: tagFrame("http://127.0.0.1:3000/", "f-other"),
      connectedAt: 9000
    });
    const socket = await connected(ctx, [sessionOf("s-own", { embedded: true, page })]);
    sendSessions(socket, [otherTab]);
    await flush();
    expect(ctx.state.chosen).toBeUndefined();
    expect(ctx.state.status.kind).toBe("lost");
    expect(socket.requests("manifest")).toHaveLength(1);

    const reloaded = sessionOf("s-own-2", { embedded: true, page, connectedAt: 9500 });
    sendSessions(socket, [otherTab, reloaded]);
    expect(ctx.state.chosen).toBe("s-own-2");
    expect(socket.last("manifest").session).toBe("s-own-2");
  });

  it("the chosen id missing from a new list → lost game_reloaded", async () => {
    const socket = await connected(ctx);
    beat(socket, "s-1", 30);
    sendSessions(socket, []);
    expect(ctx.state.status).toEqual({
      kind: "lost",
      reason: "game_reloaded",
      lastFrame: 30,
      retryInMs: 1000
    });
  });

  it("a stale manifest answer of an older attach is ignored", async () => {
    const socket = await connected(ctx, []);
    sendSessions(socket, [sessionOf("s-a")]);
    const first = socket.last("manifest");
    sendSessions(socket, [sessionOf("s-a"), sessionOf("s-b", { embedded: true })]);
    const second = socket.last("manifest");
    socket.answer(first, toWireValue(manifestOf(["old.source"])));
    await flush();
    expect(currentManifest(ctx.state)).toBeUndefined();

    socket.answer(second, toWireValue(manifestOf()));
    await flush();
    expect(ctx.state.chosen).toBe("s-b");
    expect(currentManifest(ctx.state)).toEqual(manifestOf());
  });

  it("a failed manifest logs and retries the session later", async () => {
    const socket = await connected(ctx, []);
    sendSessions(socket, [sessionOf("s-1")]);
    socket.reject(socket.last("manifest"), { code: -32_003, message: "[moku-editor] no session" });
    await flush();

    expect(ctx.log.error).toHaveBeenCalledWith("link:manifest-failed", {
      session: "s-1",
      code: -32_003
    });
    expect(ctx.state.retryTimer).toBeDefined();

    await vi.advanceTimersByTimeAsync(1000);
    expect(socket.requests("manifest")).toHaveLength(2);
  });

  it("a bad manifest shape rejects attach", async () => {
    const socket = await connected(ctx, []);
    ctx.state.sessions = [sessionOf("s-1")];
    const attaching = attach(ctx, "s-1").catch((error: unknown) => error);
    socket.answer(socket.last("manifest"), { game: 1 });
    expect(await attaching).toMatchObject({ code: -32_600 });
  });

  it("session loss: lost, manifest gone, listeners get undefined, then empty after 10 s", async () => {
    const seen: unknown[] = [];
    const socket = await connected(ctx);
    addManifestListener(ctx, manifest => seen.push(manifest));
    beat(socket, "s-1", 99);

    socket.notify("editor", "session", { id: "s-1", game: "g", open: false, reason: "bye" });

    expect(ctx.state.status).toEqual({
      kind: "lost",
      reason: "bye",
      lastFrame: 99,
      retryInMs: 1000
    });
    expect(ctx.state.chosen).toBeUndefined();
    expect(ctx.state.sticky).toBe(false);
    expect(ctx.state.manifests.has("s-1")).toBe(false);
    expect(seen.at(-1)).toBeUndefined();
    expect(ctx.emit).toHaveBeenLastCalledWith("link:status", { status: ctx.state.status });

    sendSessions(socket, []);
    expect(ctx.state.status.kind).toBe("lost");

    await vi.advanceTimersByTimeAsync(1000);
    expect(ctx.state.status).toMatchObject({ kind: "lost", retryInMs: 2000 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(ctx.state.status).toMatchObject({ kind: "lost", retryInMs: 4000 });
    await vi.advanceTimersByTimeAsync(4000);
    expect(ctx.state.status).toMatchObject({ kind: "lost", retryInMs: 3000 });
    await vi.advanceTimersByTimeAsync(3000);
    expect(ctx.state.status).toEqual({ kind: "empty" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a new session during lost attaches at once", async () => {
    const socket = await connected(ctx);
    socket.notify("editor", "session", {
      id: "s-1",
      game: "g",
      open: false,
      reason: "game_reloaded"
    });
    socket.notify("editor", "session", { id: "s-2", game: "g", open: true });
    sendSessions(socket, [sessionOf("s-2")]);

    expect(ctx.state.chosen).toBe("s-2");
    expect(ctx.state.status).toEqual({ kind: "connecting" });
    expect(ctx.state.retryTimer).toBeUndefined();
  });

  it("retrySession attaches a session that is in the list", async () => {
    const socket = await connected(ctx);
    closeChosen(ctx, "game_reloaded");
    ctx.state.sessions = [sessionOf("s-3")];
    retrySession(ctx);
    expect(ctx.state.chosen).toBe("s-3");
    expect(socket.last("manifest").session).toBe("s-3");
  });

  it("retrySession and closeChosen do nothing when not applicable", () => {
    closeChosen(ctx, "game_reloaded");
    expect(ctx.state.status).toEqual({ kind: "connecting" });
    retrySession(ctx);
    expect(ctx.state.status).toEqual({ kind: "connecting" });
  });

  it("applySessions after stop does nothing", () => {
    ctx.state.stopped = true;
    applySessions(ctx, [sessionOf("s-1")]);
    expect(ctx.state.chosen).toBeUndefined();
    expect(latestSocketCount()).toBe(0);
  });
});

/**
 * How many fake sockets exist.
 *
 * @returns The count.
 */
function latestSocketCount(): number {
  return FakeWebSocket.instances.length;
}

describe("latestSocket helper", () => {
  it("throws without a socket", () => {
    FakeWebSocket.instances.length = 0;
    expect(() => latestSocket()).toThrow("no socket was opened");
  });
});

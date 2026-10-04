import { Window } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createToolsCore, toolsCoreConfig } from "../../../../config";
import type {
  Json,
  LinkStatus,
  Manifest,
  SessionInfo,
  Tap,
  ToolsBoot
} from "../../../registry/protocol";
import { linkPlugin } from "../..";
import { type FakeHub, startFakeHub } from "./fake-hub";

// ─────────────────────────────────────────────────────────────────────────────
// A tools core with only link, against a real Bun.serve fake hub over a real
// websocket (Bun's client, Origin header, R8). Timers are fake; socket I/O is
// real, so `until` polls with the real setTimeout captured before faking.
// ─────────────────────────────────────────────────────────────────────────────

const realSetTimeout = globalThis.setTimeout;
const TOKEN = "tok-SECRET-1";

const framework = createToolsCore(toolsCoreConfig, { plugins: [linkPlugin] });

/** A `link:status` payload. */
type StatusEvent = { status: LinkStatus; session?: string };

let hub: FakeHub;
let window: Window;
let seen: StatusEvent[];

/**
 * Waits in real time until the check passes.
 *
 * @param check - The condition.
 * @param label - What is awaited, for the failure message.
 */
async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = performance.now() + 4000;
  while (!check()) {
    if (performance.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise(resolve => realSetTimeout(resolve, 5));
  }
}

/**
 * One session.
 *
 * @param id - Session id.
 * @param embedded - Embedded flag.
 * @param connectedAt - Epoch ms.
 * @returns The session.
 */
function sessionOf(id: string, embedded = false, connectedAt = 1000): SessionInfo {
  return { id, game: "merge-game 0.0.0", page: "http://127.0.0.1/", embedded, connectedAt };
}

const manifest: Manifest = {
  game: "merge-game 0.0.0",
  page: "http://127.0.0.1/",
  embedded: false,
  sources: [{ id: "game.position", title: "Position", input: {}, changes: "commit" }],
  commands: []
};

/**
 * Puts the boot tag into the stubbed document.
 *
 * @param token - The token of the boot JSON.
 */
function installBoot(token = TOKEN): void {
  const boot: ToolsBoot = {
    v: 1,
    ws: hub.ws,
    token,
    path: "/__editor",
    title: "moku editor",
    editorUrl: "vscode://file/{path}:{line}",
    root: "/work/game",
    gameUrl: "/"
  };
  window.document.body.innerHTML = `<script type="application/json" id="moku-editor-boot">${JSON.stringify(boot)}</script>`;
}

/**
 * The tools app with link and a plugin that records every `link:status`.
 *
 * @returns The app.
 */
function createApp() {
  const observer = framework.createPlugin("statusObserver", {
    hooks: () => ({
      "link:status": (payload: StatusEvent) => {
        seen.push(payload);
      }
    })
  });
  const app = framework.createApp({ plugins: [observer] });
  app.log.clearSinks();
  return app;
}

beforeEach(() => {
  hub = startFakeHub(TOKEN);
  window = new Window({ url: `${hub.origin}/__editor` });
  vi.stubGlobal("document", window.document);
  vi.stubGlobal("location", window.location);
  installBoot();
  seen = [];
  hub.values.set("game.position", { path: "home" });
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"]
  });
  vi.setSystemTime(1_000_000);
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await hub.stop();
  await window.happyDOM.close();
});

describe("link integration", () => {
  it("start → connecting → attach → first value → heartbeat → live", async () => {
    hub.sessions = [sessionOf("s-1")];
    hub.manifests.set("s-1", manifest);
    const app = createApp();
    await app.start();
    expect(app.link.status()).toEqual({ kind: "connecting" });

    const values: Json[] = [];
    app.link.watch("game.position", undefined, value => values.push(value));
    await until(() => values.length === 1, "the first value");

    expect(values).toEqual([{ path: "home" }]);
    expect(app.link.session()).toBe("s-1");
    expect(app.link.manifest()).toEqual(manifest);
    expect(hub.requests("watch")[0]).toMatchObject({
      params: { sub: 1, id: "game.position" },
      session: "s-1"
    });
    expect(hub.upgrades).toEqual([TOKEN]);

    hub.heartbeat("s-1", 1840, false);
    await until(() => app.link.status().kind === "live", "live");
    expect(app.link.status()).toEqual({ kind: "live", frame: 1840 });
    await until(() => seen.length === 2, "two link:status events");
    expect(seen).toEqual([
      { status: { kind: "connecting" }, session: "s-1" },
      { status: { kind: "live", frame: 1840 }, session: "s-1" }
    ]);

    const trace = JSON.stringify(app.log.trace());
    expect(trace).toContain("link:connect");
    expect(trace).not.toContain(TOKEN);
    await app.stop();
  });

  it("paused stays paused for 60 s and turns silent at 65 s; live turns silent at 6 s", async () => {
    hub.sessions = [sessionOf("s-1")];
    hub.manifests.set("s-1", manifest);
    const app = createApp();
    await app.start();
    await until(() => app.link.manifest() !== undefined, "attach");

    hub.heartbeat("s-1", 50, true);
    await until(() => app.link.status().kind === "paused", "paused");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(app.link.status()).toEqual({ kind: "paused", frame: 50 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(app.link.status()).toEqual({ kind: "silent", since: 1_000_000, lastFrame: 50 });

    hub.heartbeat("s-1", 51, false);
    await until(() => app.link.status().kind === "live", "live again");
    await vi.advanceTimersByTimeAsync(5000);
    expect(app.link.status().kind).toBe("live");
    await vi.advanceTimersByTimeAsync(1000);
    expect(app.link.status()).toEqual({ kind: "silent", since: 1_065_000, lastFrame: 51 });
    await app.stop();
  });

  it("a session reload → lost, then the new session attaches and watches resubscribe with new subs", async () => {
    hub.sessions = [sessionOf("s-1")];
    hub.manifests.set("s-1", manifest);
    const app = createApp();
    await app.start();
    const values: Json[] = [];
    app.link.watch("game.position", undefined, value => values.push(value));
    await until(() => values.length === 1, "the first value");
    hub.heartbeat("s-1", 1840, false);
    await until(() => app.link.status().kind === "live", "live");

    hub.close("s-1", "game_reloaded");
    await until(() => app.link.status().kind === "lost", "lost");
    expect(app.link.status()).toEqual({
      kind: "lost",
      reason: "game_reloaded",
      lastFrame: 1840,
      retryInMs: 1000
    });
    expect(app.link.manifest()).toBeUndefined();

    hub.values.set("game.position", { path: "board" });
    hub.open(sessionOf("s-2"), manifest);
    await until(() => values.length === 2, "the value after resubscribe");

    expect(values[1]).toEqual({ path: "board" });
    expect(app.link.session()).toBe("s-2");
    expect(hub.requests("watch").map(request => [request.params, request.session])).toEqual([
      [{ sub: 1, id: "game.position" }, "s-1"],
      [{ sub: 2, id: "game.position" }, "s-2"]
    ]);
    await app.stop();
  });

  it("passes taps of the attached game to onTap and keeps its heap until the session closes", async () => {
    hub.sessions = [sessionOf("s-1")];
    hub.manifests.set("s-1", manifest);
    const app = createApp();
    await app.start();
    await until(() => app.link.manifest() !== undefined, "attach");
    const taps: Tap[] = [];
    app.link.onTap(tap => taps.push(tap));
    const heap = { usedMb: 12.8, limitMb: 4095.8 };

    hub.notify("game", "heartbeat", { frame: 3, paused: false, at: 3, heap }, "s-1");
    hub.notify("game", "tap", { x: 206, y: 640, at: 15_234.5 }, "s-1");
    hub.notify("game", "tap", { x: 1, y: 1, at: 1 }, "s-other");
    await until(() => taps.length > 0, "the tap");

    expect(taps).toEqual([{ x: 206, y: 640, at: 15_234.5 }]);
    expect(app.link.heap()).toEqual(heap);

    hub.close("s-1", "game_reloaded");
    await until(() => app.link.status().kind === "lost", "lost");
    expect(app.link.heap()).toBeUndefined();
    await app.stop();
  });

  it("a socket refused before open → hello refresh → reconnect with the new token → resubscribe", async () => {
    installBoot("stale-token");
    hub.sessions = [sessionOf("s-1")];
    hub.manifests.set("s-1", manifest);
    const app = createApp();
    await app.start();
    await until(() => app.link.status().kind === "lost", "lost");
    expect(app.link.status()).toEqual({
      kind: "lost",
      reason: "socket_closed",
      lastFrame: 0,
      retryInMs: 1000
    });

    const values: Json[] = [];
    app.link.watch("game.position", undefined, value => values.push(value));
    await vi.advanceTimersByTimeAsync(1000);
    await until(() => values.length === 1, "the value after reconnect");

    expect(hub.helloHits).toBe(1);
    expect(hub.upgrades).toEqual([TOKEN]);
    expect(app.link.boot()?.token).toBe(TOKEN);

    for (const socket of hub.sockets) socket.close(1001, "restart");
    await until(() => app.link.status().kind === "lost", "lost after open");
    expect(app.link.status()).toMatchObject({ reason: "socket_closed", retryInMs: 1000 });
    expect(JSON.stringify(app.log.trace())).not.toContain(TOKEN);
    await app.stop();
  });

  it("two sessions: the embedded one is chosen; choose(other) is sticky and resubscribes", async () => {
    hub.sessions = [sessionOf("s-plain", false, 5000), sessionOf("s-emb", true, 1000)];
    hub.manifests.set("s-plain", manifest);
    hub.manifests.set("s-emb", manifest);
    const app = createApp();
    await app.start();
    const values: Json[] = [];
    app.link.watch("game.position", undefined, value => values.push(value));
    await until(() => values.length === 1, "the first value");
    expect(app.link.session()).toBe("s-emb");
    expect(app.link.sessions().map(session => session.id)).toEqual(["s-plain", "s-emb"]);

    await expect(app.link.choose("s-plain")).resolves.toEqual(manifest);
    await until(() => values.length === 2, "the value after the switch");
    expect(app.link.session()).toBe("s-plain");
    expect(hub.requests("unwatch")[0]).toMatchObject({ params: { sub: 1 }, session: "s-emb" });
    expect(hub.requests("watch")[1]).toMatchObject({ params: { sub: 2 }, session: "s-plain" });
    await app.stop();
  });

  it("files: write/read round trip, version_conflict, writeBinary/readBinary of a PNG", async () => {
    const app = createApp();
    await app.start();
    await until(() => app.link.status().kind === "empty", "empty");

    const written = await app.link.files.write(".moku/notes/a.md", "# hi");
    expect(written).toMatchObject({ path: ".moku/notes/a.md", bytes: 4 });
    await expect(app.link.files.read(".moku/notes/a.md")).resolves.toEqual({
      text: "# hi",
      version: written.version
    });

    const conflict: unknown = await app.link.files
      .write(".moku/notes/a.md", "x", "stale")
      .catch((error: unknown) => error);
    expect(conflict).toMatchObject({ code: -32_005, data: { reason: "version_conflict" } });

    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const saved = await app.link.files.writeBinary(".moku/captures/a.png", png);
    await expect(app.link.files.readBinary(".moku/captures/a.png")).resolves.toEqual({
      dataUrl: png,
      version: saved.version
    });
    expect(hub.requests("writeBinary")[0]?.session).toBeUndefined();
    await app.stop();
  });

  it("no boot tag → lost no_boot, start still resolves, boot() is undefined", async () => {
    window.document.body.innerHTML = "";
    const app = createApp();
    await app.start();
    expect(app.link.status()).toEqual({
      kind: "lost",
      reason: "no_boot",
      lastFrame: 0,
      retryInMs: 0
    });
    expect(app.link.boot()).toBeUndefined();
    expect(hub.upgrades).toEqual([]);
    await app.stop();
  });

  it("stop closes the socket with 1000, leaves no timer and rejects pending calls link_closed", async () => {
    hub.sessions = [sessionOf("s-1")];
    hub.manifests.set("s-1", manifest);
    hub.hang.add("game.slow");
    const app = createApp();
    await app.start();
    await until(() => app.link.manifest() !== undefined, "attach");
    const pending = app.link.read("game.slow").catch((error: unknown) => error);
    await until(() => hub.requests("read").length === 1, "the read on the hub");

    await app.stop();

    expect(await pending).toMatchObject({
      code: -32_002,
      data: { reason: "link_closed", retryable: true }
    });
    expect(vi.getTimerCount()).toBe(0);
    await until(() => hub.closes.length === 1, "the close on the hub");
    expect(hub.closes).toEqual([1000]);
  });
});

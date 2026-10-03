import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isRequest, isResponse, type LinkStatus } from "../../src/index";
import { createApp as createServerApp } from "../../src/server";
import {
  type AgentStack,
  bootTools,
  createPageDir,
  createProject,
  createTinyGame,
  installPage,
  type Logged,
  logErrors,
  type Page,
  type ServerStack,
  type Stoppable,
  settle,
  shutdown,
  startAgent,
  startServer,
  startServerOnPort,
  startStack,
  type Tap,
  TINY_NAME,
  type ToolsStack,
  trackUnhandled,
  type UnhandledTracker,
  until
} from "./helpers/stack";

// ─────────────────────────────────────────────────────────────────────────────
// Core lifecycle (plan §3, L1–L4): the agent, the server and the tools app each
// start and stop cleanly against the real hub, and the three cores come up and
// go down in any order without an error or an unhandled rejection.
// ─────────────────────────────────────────────────────────────────────────────

/** The overlay host attribute (overlay/types.ts HOST_ATTRIBUTE). */
const OVERLAY_HOST = "[data-moku-editor-overlay]";

/** How long a "nothing happens after stop" window lasts. */
const QUIET_MS = 500;

const parts: (Stoppable | undefined)[] = [];
let unhandled: UnhandledTracker | undefined;

afterEach(async () => {
  await shutdown(...parts.splice(0));
  unhandled?.stop();
  unhandled = undefined;
});

/**
 * Remembers stack parts for the bounded shutdown in afterEach.
 *
 * @param part - A started part.
 * @returns The same part.
 */
function keep<Part extends Stoppable>(part: Part): Part {
  parts.push(part);
  return part;
}

/**
 * Lets a quiet window pass: the only way to see that nothing happens after a stop.
 *
 * @param ms - The window.
 * @returns Resolves after it.
 */
async function quiet(ms: number): Promise<void> {
  const from = performance.now();
  await until(() => performance.now() - from >= ms, `${String(ms)} ms of quiet`, ms + 1000);
}

/**
 * The status kinds in order, each run of the same kind collapsed to one.
 *
 * @param statuses - Status payloads.
 * @returns The kinds.
 */
function kindsOf(statuses: readonly { readonly status: LinkStatus }[]): string[] {
  const kinds: string[] = [];
  for (const { status } of statuses) if (kinds.at(-1) !== status.kind) kinds.push(status.kind);
  return kinds;
}

/**
 * The error entries of the apps, without the watch failures a screenless tiny game always causes
 * (renderView watches game.render, game.assets and game.effects for every session).
 *
 * @param apps - The apps to read.
 * @returns The other error entries.
 */
function realErrors(...apps: readonly Logged[]) {
  return logErrors(...apps).filter(entry => {
    const data: { readonly id?: unknown } = entry.data ?? {};
    return !(
      entry.event === "link:watch-failed" &&
      (data.id === "game.render" || data.id === "game.assets" || data.id === "game.effects")
    );
  });
}

/**
 * The tools requests the hub has not answered yet, as `<conn>:<id>`.
 *
 * @param tap - The wire tap.
 * @returns The open requests.
 */
function unanswered(tap: Tap): string[] {
  const asked: string[] = [];
  const answered = new Set<string>();
  for (const { dir, kind, conn, message } of tap.entries) {
    if (kind !== "tools") continue;
    if (dir === "in" && isRequest(message)) asked.push(`${String(conn)}:${String(message.id)}`);
    if (dir === "out" && isResponse(message)) answered.add(`${String(conn)}:${String(message.id)}`);
  }
  return asked.filter(key => !answered.has(key));
}

/**
 * Starts the server over a fresh tiny project and installs the page at its origin.
 *
 * @returns The server and the page.
 */
async function serverAndPage(): Promise<{ server: ServerStack; page: Page }> {
  vi.stubGlobal("__MOKU_GAME_DEV__", true);
  const server = keep(await startServer(await createProject("tiny")));
  return { server, page: installPage(server.origin) };
}

describe("core lifecycle", () => {
  it("L1: the agent links to the real hub and leaves it cleanly", async () => {
    const { server, page } = await serverAndPage();
    const game = keep(await createTinyGame());

    const agent: AgentStack = keep(await startAgent(server, game));
    // start() resolved while the socket was still opening.
    expect(kindsOf(agent.statuses)).toEqual(["connecting"]);

    // The bridge says `live` when its socket opens, before the hub read the hello. The session id
    // comes with the hub's `session` notice, sent after the hub registered the session.
    await until(
      () => agent.app.bridge.status().kind === "live" && agent.app.bridge.session() !== undefined,
      "a live agent with its session"
    );
    expect(kindsOf(agent.statuses)).toEqual(["connecting", "live"]);
    const session = server.app.hub.sessions()[0]?.id;
    expect(session).toBeTypeOf("string");
    expect(agent.app.bridge.session()).toBe(session);
    expect(server.sessions).toEqual([{ id: session, open: true, game: TINY_NAME }]);

    // The overlay hook stores every bridge:status while closed; opening paints the stored one.
    const host = page.gamePage.querySelector<HTMLElement>(OVERLAY_HOST);
    expect(host?.hidden).toBe(true);
    agent.app.overlay.open();
    expect(host?.hidden).toBe(false);
    const dot = host?.shadowRoot?.querySelector<HTMLElement>("[data-dot]");
    expect(dot?.dataset.kind).toBe("live");
    expect(dot?.getAttribute("aria-label")).toMatch(/^Editor live · frame \d+$/);

    const agentIn = () =>
      server.tap.entries.filter(entry => entry.dir === "in" && entry.kind === "agent");
    expect(agentIn()[0]?.message).toMatchObject({ method: "hello", channel: "game" });

    const stoppedAt = performance.now();
    await agent.stop();
    await until(() => server.sessions.at(-1)?.open === false, "the session to close");
    await until(
      () => server.tap.sockets.some(socket => socket.kind === "agent" && socket.type === "close"),
      "the agent socket to close"
    );
    expect(agentIn().at(-1)?.message).toMatchObject({ method: "bye", channel: "game" });
    expect(server.sessions.at(-1)).toMatchObject({ id: session, open: false });
    expect(page.gamePage.querySelector(OVERLAY_HOST)).toBeNull();

    const closedAt = server.tap.sockets.find(socket => socket.type === "close")?.at ?? 0;
    const statusCount = agent.statuses.length;
    await quiet(QUIET_MS);
    const lateBeats = agentIn().filter(
      entry =>
        entry.at > closedAt && "method" in entry.message && entry.message.method === "heartbeat"
    );
    expect(lateBeats).toEqual([]);
    const reopened = server.tap.sockets.filter(
      socket => socket.kind === "agent" && socket.type === "open" && socket.at > stoppedAt
    );
    expect(reopened).toEqual([]);
    expect(server.app.hub.sessions()).toEqual([]);
    expect(agent.statuses).toHaveLength(statusCount);
  });

  it("L2: the server rotates its token per start and refuses everything after stop", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const root = await createProject("tiny");
    const unstarted = createServerApp({
      pluginConfigs: { files: { root }, pages: { pageDir: await createPageDir() } }
    });
    unstarted.log.clearSinks();
    expect(() => unstarted.hub.token()).toThrow(/^\[moku-editor\] /);

    const server = keep(await startServer(root));
    const token = server.app.hub.token();
    expect(token).toHaveLength(43);
    expect(server.app.hub.sessions()).toEqual([]);

    installPage(server.origin);
    const tools = keep(await bootTools(server));
    await until(() => tools.app.link.status().kind === "empty", "an empty link");

    // Stop the app only: Bun keeps listening, so the routes answer what the stopped hub says.
    await server.app.stop();
    expect(() => server.app.hub.token()).toThrow(/^\[moku-editor\] /);
    const page = await fetch(`${server.origin}/__editor/`);
    expect(page.status).toBe(503);
    const hello = await fetch(`${server.origin}/__editor/hello`, {
      headers: { origin: server.origin }
    });
    expect(hello.status).toBe(503);
    await until(() => tools.app.link.status().kind === "lost", "the tools link to be lost");

    const home = await server.app.files.read("nodes/home.ts");
    expect(home.text).toContain("export const home");
    expect(home.version).toMatch(/^[\da-f]{40}$/);

    // A second start of the same server core gets a new token.
    const again = keep(await startServer(root));
    expect(again.app.hub.token()).toHaveLength(43);
    expect(again.app.hub.token()).not.toBe(token);
  });

  it("L3: tools start does not mount; mount builds the shell; stop cleans up", async () => {
    const { server, page } = await serverAndPage();
    const tools: ToolsStack = keep(await bootTools(server, { mount: false }));
    const { link, workspace } = tools.app;

    expect(link.status()).toEqual({ kind: "connecting" });
    expect(page.root.childElementCount).toBe(0);
    await until(() => link.status().kind === "empty", "an empty link");
    expect(page.root.childElementCount).toBe(0);
    expect(link.session()).toBeUndefined();

    await tools.mount();
    expect(page.root.querySelector('[data-ui="top-bar"]')).not.toBeNull();
    expect(page.root.querySelectorAll('[data-ui="rail"] [data-workspace]')).toHaveLength(6);
    expect(workspace.active()).toBe("flow");
    expect(workspace.host("flow").childElementCount).toBeGreaterThan(0);
    expect(workspace.host("state").childElementCount).toBe(0);
    await act(() => {
      workspace.show("state");
    });
    await until(() => workspace.host("state").childElementCount > 0, "the state panels to mount");

    const game = keep(await createTinyGame());
    keep(await startAgent(server, game));
    await until(() => link.status().kind === "live", "a live link");
    expect(kindsOf(tools.eventsOf("link:status"))).toEqual(["empty", "connecting", "live"]);
    await until(() => server.tap.watchedIds().length > 0, "the tools watches to open");
    const toolsConn = server.tap.sockets.find(socket => socket.kind === "tools")?.conn;

    await tools.stop();
    expect(page.root.childElementCount).toBe(0);
    await until(
      () =>
        server.tap.watchedIds(toolsConn).length === 0 ||
        server.tap.sockets.some(socket => socket.kind === "tools" && socket.type === "close"),
      "every tools watch to end"
    );
    const statusCount = tools.eventsOf("link:status").length;
    // workspace listens for keys on globalThis; under Bun that is not the page window, so this
    // keydown reaches no listener before or after stop. It still must change nothing.
    const changedCount = tools.eventsOf("workspace:changed").length;
    globalThis.document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "6", code: "Digit6", ctrlKey: true, metaKey: true })
    );
    await quiet(QUIET_MS);
    expect(tools.eventsOf("link:status")).toHaveLength(statusCount);
    expect(tools.eventsOf("workspace:changed")).toHaveLength(changedCount);
    expect(page.root.childElementCount).toBe(0);
  });

  it("L4: tools before the hub, then server, then agent; stop in any order, all clean", async () => {
    unhandled = trackUnhandled();
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const root = await createProject("tiny");
    const throwaway = Bun.serve({ port: 0, fetch: () => new Response("x") });
    const port = throwaway.port ?? 0;
    await throwaway.stop(true);
    const origin = `http://127.0.0.1:${String(port)}`;
    installPage(origin);

    const tools = keep(
      await bootTools({
        v: 1,
        ws: `ws://127.0.0.1:${String(port)}/__editor/ws`,
        token: "not-yet",
        path: "/__editor",
        title: "moku editor",
        editorUrl: "vscode://file/{path}:{line}",
        root,
        gameUrl: "/"
      })
    );
    const { link } = tools.app;
    await until(() => link.status().kind === "lost", "a lost link while nothing listens");
    const lost = link.status();
    expect(lost.kind === "lost" && lost.retryInMs > 0).toBe(true);

    const server = keep(await startServerOnPort(root, port));
    await until(() => link.status().kind === "empty", "an empty link once the hub is up");

    const game = keep(await createTinyGame());
    const agent = keep(await startAgent(server, game));
    await until(() => link.status().kind === "live", "a live link");
    await until(() => agent.app.bridge.status().kind === "live", "a live agent");
    // `live` comes with the first heartbeat, before the manifest and the watches: wait for the
    // whole attach, so the stops below meet no call in flight (see L4b).
    await until(() => link.manifest() !== undefined, "the manifest");
    await until(() => server.tap.watchedIds().length > 0, "the tools watches");
    await until(() => unanswered(server.tap).length === 0, "every tools call answered");
    const kinds = kindsOf(tools.eventsOf("link:status"));
    expect(kinds[0]).toBe("lost");
    expect(kinds.indexOf("empty")).toBeGreaterThan(kinds.indexOf("lost"));
    expect(kinds.lastIndexOf("live")).toBeGreaterThan(kinds.indexOf("empty"));
    expect(kinds.at(-1)).toBe("live");

    await agent.stop();
    await tools.stop();
    await server.stop();

    expect(realErrors(server.app, agent.app, tools.app, game.app)).toEqual([]);
    expect(unhandled.list).toEqual([]);
  });

  it("L4b: stopping the tools app with a watch in flight logs no error", async () => {
    const stack = keep(await startStack());
    const { tools } = stack;
    await until(() => unanswered(stack.server.tap).length === 0, "every tools call answered");

    tools.app.link.watch("tiny.count", undefined, () => undefined);
    await tools.stop();
    await settle();

    expect(realErrors(tools.app)).toEqual([]);
  });
});

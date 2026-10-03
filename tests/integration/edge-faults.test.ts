import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bridgePlugin, createApp as createAgentApp } from "../../src/agent";
import { isRequest, isResponse, type Json, type LinkStatus, ProtocolError } from "../../src/index";
import { createApp as createServerApp } from "../../src/server";
import {
  bootTools,
  createPageDir,
  createProject,
  createTinyGame,
  installPage,
  type Logged,
  logErrors,
  type Page,
  PNG_1X1,
  paramsOf,
  reloadAgent,
  type ServerStack,
  type Stack,
  type Stoppable,
  shutdown,
  startAgent,
  startServer,
  startServerOnPort,
  startStack,
  type Tap,
  TINY_NAME,
  trackUnhandled,
  type UnhandledTracker,
  until
} from "./helpers/stack";

// ─────────────────────────────────────────────────────────────────────────────
// Edge faults (plan §3, E1–E5): refusals at the hub, config errors at
// createApp, a game page that reloads mid-session, a hub that goes away and
// comes back on the same port, and every core stopped while calls are busy.
// ─────────────────────────────────────────────────────────────────────────────

/** Sources a screenless tiny game cannot answer: each failed watch is one error entry. */
const SCREENLESS_IDS: ReadonlySet<string> = new Set([
  "game.render",
  "game.assets",
  "game.ui",
  "game.entities",
  "game.projections"
]);

/** The consoleView meta line after a reload with Preserve log off. */
const LOG_CLEARED = "Log cleared: the game page reloaded. Turn on Preserve log to keep it.";

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
 * Lets a window of real time pass: a step of the scenario, or the only way to see that nothing
 * happens after a stop.
 *
 * @param ms - The window.
 * @returns Resolves after it.
 */
async function quiet(ms: number): Promise<void> {
  const from = performance.now();
  await until(() => performance.now() - from >= ms, `${String(ms)} ms passing`, ms + 1000);
}

/**
 * The protocol error a call rejected with; fails when it resolved or rejected with something else.
 *
 * @param call - The call.
 * @returns The protocol error.
 */
async function failureOf(call: Promise<unknown>): Promise<ProtocolError> {
  const outcome = await call.then(
    value => ({ resolved: value }),
    (error: unknown) => ({ rejected: error })
  );
  if ("resolved" in outcome) throw new Error("the call resolved, a rejection was expected");
  if (!(outcome.rejected instanceof ProtocolError)) {
    throw new Error(`the call rejected with a non-protocol error: ${String(outcome.rejected)}`);
  }
  return outcome.rejected;
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
 * The frame of a live or paused status; fails for any other kind.
 *
 * @param status - A link status.
 * @returns Its frame.
 */
function frameOf(status: LinkStatus): number {
  if (status.kind !== "live" && status.kind !== "paused") {
    throw new Error(`the link is ${status.kind}, a frame was expected`);
  }
  return status.frame;
}

/**
 * The error entries of the apps, without the watch failures a screenless tiny game always causes.
 *
 * @param apps - The apps to read.
 * @returns The other error entries.
 */
function realErrors(apps: readonly Logged[]) {
  return logErrors(...apps).filter(entry => {
    if (entry.event !== "link:watch-failed") return true;
    const data: { readonly id?: unknown } = entry.data ?? {};
    return !(typeof data.id === "string" && SCREENLESS_IDS.has(data.id));
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

/** One tools `watch` request as the tap saw it. */
type WatchSeen = { readonly id: string; readonly sub: Json | undefined; readonly session?: string };

/**
 * The tools `watch` requests on the tap, from an index of the request list on.
 *
 * @param tap - The wire tap.
 * @param from - How many watch requests to skip.
 * @returns The source id, sub and session of each.
 */
function watchesOf(tap: Tap, from = 0): WatchSeen[] {
  return tap
    .requests("tools", "watch", "game")
    .slice(from)
    .map(message => {
      const params = paramsOf(message);
      const id = typeof params?.id === "string" ? params.id : "";
      return message.session === undefined
        ? { id, sub: params?.sub }
        : { id, sub: params?.sub, session: message.session };
    });
}

/**
 * True when the hub sent the agent a `run` of the command.
 *
 * @param tap - The wire tap.
 * @param id - The command id.
 * @returns Whether the run reached the agent.
 */
function ranAtAgent(tap: Tap, id: string): boolean {
  return tap.sent("agent", "run").some(message => paramsOf(message)?.id === id);
}

/**
 * The `hub:refused` entries of the server log, as `{ status, check }`.
 *
 * @param server - The server stack.
 * @returns The refusals in order.
 */
function refusals(server: ServerStack): { status?: unknown; check?: unknown }[] {
  return server.app.log
    .trace()
    .filter(entry => entry.event === "hub:refused")
    .map(entry => {
      const data: { readonly status?: unknown; readonly check?: unknown } = entry.data ?? {};
      return { status: data.status, check: data.check };
    });
}

/**
 * The texts of the toasts in the page.
 *
 * @param page - The page.
 * @returns One text per visible toast.
 */
function toastTexts(page: Page): string[] {
  return [...page.root.querySelectorAll("[data-toast]")].map(toast => toast.textContent ?? "");
}

/**
 * Shows a workspace inside `act` and waits for its panel to be ready.
 *
 * @param stack - The live stack.
 * @param ws - The workspace.
 * @returns Resolves once the panel is ready.
 */
async function showReady(stack: Stack, ws: "flow" | "state"): Promise<void> {
  const { workspace } = stack.tools.app;
  await act(() => {
    workspace.show(ws);
  });
  await until(
    () =>
      workspace.host(ws).querySelector(`[data-panel="${ws}"][data-panel-state="ready"]`) !== null,
    `the ${ws} panel ready`
  );
}

/**
 * Every file name under a folder, recursively; empty when the folder does not exist.
 *
 * @param folder - The folder.
 * @returns The relative paths.
 */
function filesUnder(folder: string): string[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { recursive: true, encoding: "utf8" });
}

/**
 * Opens a Bun WebSocket with an explicit Origin header and waits until it opens or closes. The
 * Origin is set by hand: the bridge's own Origin rule is open bug A, so nothing relies on it.
 *
 * @param url - The upgrade URL with its query.
 * @param origin - The Origin header.
 * @returns Whether the socket ever opened.
 */
async function trySocket(url: string, origin: string): Promise<{ opened: boolean }> {
  // The DOM typing of the WebSocket constructor does not know Bun's options object.
  const socket: WebSocket = Reflect.construct(WebSocket, [url, { headers: { origin } }]);
  let opened = false;
  let closed = false;
  socket.addEventListener("open", () => {
    opened = true;
    socket.close();
  });
  socket.addEventListener("close", () => {
    closed = true;
  });
  await until(() => closed, "the socket to close");
  return { opened };
}

describe("edge faults", () => {
  it("E1: bad token and bad origin are refused at the hub; the link heals through hello", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const root = await createProject("tiny");
    const server = keep(await startServer(root));
    const hubPath = server.app.hub.path();
    installPage(server.origin, hubPath);
    const game = keep(await createTinyGame());
    const agent = keep(await startAgent(server, game));
    await until(() => agent.app.bridge.status().kind === "live", "a live agent");

    // 1. tools booted with a token of the right length that the hub never issued
    const badToken = "x".repeat(43);
    const tools = keep(await bootTools(server, { boot: boot => ({ ...boot, token: badToken }) }));
    const { link } = tools.app;
    await until(
      () => link.status().kind === "live" && link.manifest() !== undefined,
      "a live link after the hello refresh"
    );
    expect(refusals(server)[0]).toEqual({ status: 401, check: "token" });
    // The real token can only come from /hello: the same app healed, no page reload.
    expect(link.boot()?.token).toBe(server.token);
    const kinds = kindsOf(tools.eventsOf("link:status"));
    expect(kinds[0]).toBe("lost");
    expect(kinds.at(-1)).toBe("live");
    const toolsOpens = () =>
      server.tap.sockets.filter(socket => socket.kind === "tools" && socket.type === "open");
    expect(toolsOpens()).toHaveLength(1);

    // 2. the right token from a foreign page
    const ws = `ws://127.0.0.1:${String(server.port)}${hubPath}/ws`;
    const evil = await trySocket(
      `${ws}?token=${encodeURIComponent(server.token)}&kind=tools`,
      "http://evil.test"
    );
    expect(evil.opened).toBe(false);
    await until(() => refusals(server).length >= 2, "the origin refusal");
    expect(refusals(server).at(-1)).toEqual({ status: 403, check: "origin" });
    expect(toolsOpens()).toHaveLength(1);

    // 3. hello asked cross-site, then same-origin
    const crossSite = await fetch(`${server.origin}${hubPath}/hello`, {
      headers: { "sec-fetch-site": "cross-site" }
    });
    await crossSite.body?.cancel();
    expect(crossSite.status).toBe(403);
    const sameOrigin = await fetch(`${server.origin}${hubPath}/hello`, {
      headers: { "sec-fetch-site": "same-origin" }
    });
    expect(sameOrigin.status).toBe(200);
    expect(await sameOrigin.json()).toMatchObject({ token: server.token });

    // 4. a second game page on the localhost host name
    const localGame = keep(await createTinyGame());
    const local = keep(
      await startAgent(server, localGame, {
        configs: { bridge: { hello: `http://localhost:${String(server.port)}${hubPath}/hello` } }
      })
    );
    // `live` comes when the socket opens; the session id only after the hub registered the hello.
    await until(
      () => local.app.bridge.status().kind === "live" && local.app.bridge.session() !== undefined,
      "a live localhost agent with its session"
    );
    expect(server.app.hub.sessions()).toHaveLength(2);
    expect(server.sessions.filter(session => session.open)).toHaveLength(2);

    // No log of any app carries the token, real or forged.
    for (const app of [server.app, agent.app, local.app, tools.app, game.app, localGame.app]) {
      const text = JSON.stringify(app.log.trace());
      expect(text).not.toContain(server.token);
      expect(text).not.toContain(badToken);
    }
  });

  it("E2: missing or wrong config fails early and loud", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const root = await createProject("tiny");
    const game = keep(await createTinyGame());

    // Agent config errors throw at createApp.
    expect(() => createAgentApp()).toThrow("[moku-editor] registry.game is missing.");
    expect(() =>
      createAgentApp({
        pluginConfigs: { registry: { game: game.app }, channel: { heartbeatMs: 0 } }
      })
    ).toThrow(/^\[moku-editor\] channel\.heartbeatMs must be a whole number of at least 100\./);
    expect(() =>
      createAgentApp({
        plugins: [bridgePlugin],
        pluginConfigs: { registry: { game: game.app }, bridge: { retryMs: -1 } }
      })
    ).toThrow(/^\[moku-editor\] bridge\.retryMs must be a whole number of at least 100\./);

    // A files root that does not exist throws at createApp.
    const pageDir = await createPageDir();
    const missing = path.join(root, "missing");
    expect(() =>
      createServerApp({ pluginConfigs: { files: { root: missing }, pages: { pageDir } } })
    ).toThrow(/^\[moku-editor\] files\.root ".*missing" is not a directory\./);

    const server = keep(await startServer(root));
    const page = installPage(server.origin, server.app.hub.path());

    // Tools without a boot tag: start resolves, lost no_boot, a status card after mount.
    const tools = keep(await bootTools(server, { boot: () => undefined, mount: false }));
    const { link } = tools.app;
    expect(link.status()).toEqual({ kind: "lost", reason: "no_boot", lastFrame: 0, retryInMs: 0 });
    expect(link.boot()).toBeUndefined();
    await tools.mount();
    const card = page.root.querySelector<HTMLElement>('[data-ui="status-card"]');
    expect(card?.hidden).toBe(false);
    expect(card?.hasAttribute("data-card")).toBe(true);
    // No boot tag: the link can never connect, so the F4 card is the empty one.
    expect(card?.dataset.kind).toBe("empty");

    // An agent whose hello path answers 404 starts, goes lost and keeps retrying.
    const nopes = () => server.fetched.filter(fetched => fetched === "/__nope/hello").length;
    const agent = keep(
      await startAgent(server, game, { configs: { bridge: { hello: "/__nope/hello" } } })
    );
    await until(() => agent.app.bridge.status().kind === "lost", "a lost agent");
    // The status flips between lost and connecting on each retry: read the first lost one.
    // Its retry follows bridge.retryMs 100 with 20 % jitter, not the 1000 ms default.
    const lost = agent.statuses.find(({ status }) => status.kind === "lost")?.status;
    expect(lost).toMatchObject({ kind: "lost", reason: expect.stringContaining("404") });
    const retryInMs = lost?.kind === "lost" ? lost.retryInMs : -1;
    expect(retryInMs).toBeGreaterThanOrEqual(80);
    expect(retryInMs).toBeLessThanOrEqual(120);
    await until(() => nopes() >= 2, "a second hello 404");
    expect(server.app.hub.sessions()).toEqual([]);
  });

  it("E3: the game reloads mid-session; the tools follow the new session", async () => {
    const stack = keep(await startStack());
    const { tools, server, page } = stack;
    const { link, stateView, consoleView, panels } = tools.app;
    await showReady(stack, "state");
    await showReady(stack, "flow");
    await until(
      () => watchesOf(server.tap).some(watch => watch.id === "game.position"),
      "a panel watching game.position"
    );

    // One commit and one console line on the old game.
    await panels.run("game.answer", { intent: "play" });
    await stack.game.frames(2);
    await until(() => stateView.lastCommit() !== undefined, "the first commit");
    await panels.run("tiny.warn");
    await until(
      () => consoleView.lines().some(line => line.kind === "entry" && line.event === "tiny:warned"),
      "the tiny:warned line"
    );
    expect(consoleView.preserve()).toBe(false);

    // A watch of a frame source the old game moved to 2.
    const counts: Json[] = [];
    link.watch("tiny.count", undefined, value => {
      counts.push(value);
    });
    await link.run("tiny.bump");
    await link.run("tiny.bump");
    await until(() => counts.at(-1) === 2, "tiny.count at 2");
    await until(() => unanswered(server.tap).length === 0, "every tools call answered");
    // Each heartbeat with a new frame is a new `live` status. Wait until the status shows the
    // game's frame, so no late heartbeat adds a `live` after the count below.
    const frameNow = stack.agent.app.channel.heartbeat().frame;
    await until(() => {
      const status = link.status();
      return (status.kind === "live" || status.kind === "paused") && status.frame === frameNow;
    }, "the link status at the game's frame");

    const oldSession = link.session();
    const oldIds = [...new Set(server.tap.watchedIds())];
    const oldSubs = new Set(watchesOf(server.tap).map(watch => watch.sub));
    const watchCount = watchesOf(server.tap).length;
    const statusCount = tools.eventsOf("link:status").length;

    // 1. a call the game never answers
    const pending = failureOf(link.run("tiny.hang"));
    await until(() => ranAtAgent(server.tap, "tiny.hang"), "the hang at the agent");

    // 2. the game page reloads
    await reloadAgent(stack, createTinyGame);
    const reloaded = await pending;
    expect(reloaded.code).toBe(-32_001);
    expect(reloaded.data).toMatchObject({ reason: "game_reloaded", retryable: true });

    await until(
      () =>
        link.status().kind === "live" &&
        link.session() !== oldSession &&
        link.manifest() !== undefined &&
        // The hub tells the agent and the tools on two sockets: either may hear first.
        stack.agent.app.bridge.session() !== undefined,
      "a live link on the new session"
    );
    const newSession = stack.agent.app.bridge.session();
    expect(link.session()).toBe(newSession);
    expect(server.sessions).toEqual([
      { id: oldSession, open: true, game: TINY_NAME },
      { id: oldSession, open: false, game: TINY_NAME, reason: "bye" },
      { id: newSession, open: true, game: TINY_NAME }
    ]);

    const statuses = tools.eventsOf("link:status").slice(statusCount);
    const kinds = kindsOf(statuses);
    expect(["lost", "empty"]).toContain(kinds[0]);
    expect(statuses[0]?.status).toMatchObject({ kind: "lost", reason: "bye" });
    expect(kinds.at(-1)).toBe("live");
    expect(statuses.at(-1)?.session).toBe(newSession);

    // Every watch is sent again to the new session, on subs never used before.
    await until(() => {
      const ids = new Set(watchesOf(server.tap, watchCount).map(watch => watch.id));
      return oldIds.every(id => ids.has(id));
    }, "every watch re-sent");
    for (const watch of watchesOf(server.tap, watchCount)) {
      expect(oldSubs.has(watch.sub)).toBe(false);
      expect(watch.session).toBe(newSession);
    }
    // Old values are dropped: nothing reaches the tools on an old sub after the old game left,
    // and the frame source shows the fresh game's count.
    const closedAt =
      server.tap.sockets.find(socket => socket.kind === "agent" && socket.type === "close")?.at ??
      Number.POSITIVE_INFINITY;
    const lateOld = server.tap.entries.filter(
      entry =>
        entry.dir === "out" &&
        entry.kind === "tools" &&
        entry.at > closedAt &&
        "method" in entry.message &&
        entry.message.method === "value" &&
        oldSubs.has(paramsOf(entry.message)?.sub)
    );
    expect(lateOld).toEqual([]);
    await until(() => counts.at(-1) === 0, "tiny.count of the fresh game");

    // stateView and consoleView start over for the new game.
    expect(stateView.lastCommit()).toBeUndefined();
    await until(
      () => consoleView.lines().some(line => line.kind === "meta" && line.text === LOG_CLEARED),
      "the log-cleared line"
    );
    expect(
      consoleView.lines().some(line => line.kind === "entry" && line.event === "tiny:warned")
    ).toBe(false);
    expect(consoleView.preserve()).toBe(false);

    // Nothing is stale at the end.
    await until(
      () => page.root.querySelectorAll("[data-stale]").length === 0,
      "no stale mark in the page"
    );
  });

  it("E4: the link survives a hub restart on the same port", async () => {
    const stack = keep(
      await startStack({ tools: { configs: { workspace: { reloadTimeoutMs: 8000 } } } })
    );
    const { tools, server, page, agent, root } = stack;
    const { link, workspace } = tools.app;
    await showReady(stack, "state");
    await showReady(stack, "flow");
    await until(() => unanswered(server.tap).length === 0, "every tools call answered");
    const oldIds = [...new Set(server.tap.watchedIds())];
    const liveFrame = frameOf(link.status());
    const oldToken = server.token;

    const pending = failureOf(link.run("tiny.hang"));
    await until(() => ranAtAgent(server.tap, "tiny.hang"), "the hang at the agent");

    // 1. the hub stops, then Bun (bounded)
    await server.stop();
    const closed = await pending;
    expect(closed.code).toBe(-32_002);
    expect(closed.data).toMatchObject({ reason: "link_closed", retryable: true });
    await until(() => link.status().kind === "lost", "a lost link");
    const lost = link.status();
    if (lost.kind !== "lost") throw new Error("the link is not lost");
    expect(lost.lastFrame).toBeGreaterThanOrEqual(liveFrame);
    expect(lost.retryInMs).toBeGreaterThan(0);

    const world = () => page.root.querySelector<HTMLElement>('[data-flow="world"]');
    const statePanel = () =>
      workspace.host("state").querySelector<HTMLElement>('[data-panel="state"]');
    const bar = () => page.root.querySelector<HTMLElement>('[data-ui="stale-bar"]');
    await until(() => world()?.dataset.stale !== undefined, "the flow world marked stale");
    await until(() => statePanel()?.dataset.stale !== undefined, "the state panel marked stale");
    await until(
      () =>
        bar()?.hidden === false && (bar()?.textContent ?? "").includes("Stale · data from frame"),
      "the lost bar"
    );
    expect(bar()?.textContent).toContain(`frame ${String(lost.lastFrame)}`);

    // 2. a reload without a session cannot take a bookmark; it settles once a game is back
    const reload = workspace.gameFrame().reload({ restore: true });

    // 3. the hub comes back on the same port with a new token
    const again = keep(await startServerOnPort(root, server.port));
    expect(again.token).not.toBe(oldToken);

    // 4. the agent re-fetches hello per attempt; then "Retry now" on the link
    await until(() => again.app.hub.sessions().length === 1, "the agent back on the hub", 5000);
    await until(
      () => agent.app.bridge.status().kind === "live" && agent.app.bridge.session() !== undefined,
      "a live agent again",
      5000
    );
    expect(agent.app.bridge.session()).toBe(again.app.hub.sessions()[0]?.id);
    link.retry();
    await until(
      () => link.status().kind === "live" && link.manifest() !== undefined,
      "a live link on the new hub",
      5000
    );
    expect(link.boot()?.token).toBe(again.token);
    expect(link.session()).toBe(again.app.hub.sessions()[0]?.id);

    expect(await reload).toEqual({ restored: false, reason: "no_session" });

    await until(() => {
      const ids = new Set(watchesOf(again.tap).map(watch => watch.id));
      return oldIds.every(id => ids.has(id));
    }, "every watch re-sent to the new hub");
    await until(
      () => page.root.querySelectorAll("[data-stale]").length === 0,
      "every stale mark cleared"
    );
    expect(bar()?.hidden).toBe(true);
  });

  it("E5: every core stops cleanly while calls are busy", async () => {
    unhandled = trackUnhandled();
    const stack = keep(await startStack({ agent: { png: PNG_1X1 } }));
    const { tools, server, page, root, game } = stack;
    const { link, gameView } = tools.app;
    const first = stack.agent;

    // 1. a long series
    const series = gameView.series({ durationMs: 20_000, intervalMs: 100 });
    await until(() => ranAtAgent(server.tap, "editor.series"), "the series at the agent");

    // 2. the agent stops 200 ms in
    await quiet(200);
    await first.stop();
    expect(await series).toBeUndefined();
    const ran = tools.eventsOf("workspace:ran").find(event => event.id === "editor.series");
    expect(ran).toMatchObject({ ok: false, error: { code: -32_001 } });
    await until(
      () => toastTexts(page).some(text => text.startsWith("Series failed")),
      "the toast naming the failed series"
    );
    expect(server.written.filter(written => written.path.endsWith("index.json"))).toEqual([]);
    expect(filesUnder(path.join(root, ".moku", "captures"))).toEqual([]);

    // 3. a new agent; a call it never answers; the tools stop
    const second = keep(await startAgent(server, game, { png: PNG_1X1 }));
    await until(
      () =>
        link.status().kind === "live" &&
        link.session() === second.app.bridge.session() &&
        link.manifest() !== undefined,
      "the link on the new agent"
    );
    const pending = failureOf(link.run("tiny.hang"));
    await until(() => ranAtAgent(server.tap, "tiny.hang"), "the hang at the agent");
    await tools.stop();
    const closed = await pending;
    expect(closed.code).toBe(-32_002);
    expect(closed.data).toMatchObject({ reason: "link_closed" });

    // 4. the server stops; then the last agent
    await server.stop();
    await second.stop();

    const entries = server.tap.entries.length;
    const sockets = server.tap.sockets.length;
    const statuses = second.statuses.length;
    const events = tools.events.length;
    await quiet(300);
    expect(server.tap.entries).toHaveLength(entries);
    expect(server.tap.sockets).toHaveLength(sockets);
    expect(second.statuses).toHaveLength(statuses);
    expect(tools.events).toHaveLength(events);

    expect(realErrors([server.app, first.app, second.app, tools.app, game.app])).toEqual([]);
    expect(unhandled.list).toEqual([]);
  });
});

import { h } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { definePanel, ProtocolError, type RunResult } from "../../src/index";
import { createPlugin, type Panels, panelsPlugin } from "../../src/tools";
import {
  bootTools,
  createProject,
  createTinyGame,
  installPage,
  type Logged,
  logErrors,
  paramsOf,
  reloadAgent,
  type Stack,
  type Stoppable,
  settle,
  shutdown,
  startAgent,
  startServer,
  startStack,
  type Tap,
  trackUnhandled,
  type UnhandledTracker,
  until
} from "./helpers/stack";

// ─────────────────────────────────────────────────────────────────────────────
// Cross-plugin panel scenarios P1–P4 (plan §3, cross-panels.test.ts): a
// definePanel panel, stateView, consoleView, renderView and gameView over the
// real wire. The agent on a tiny game, the real hub on Bun.serve and the link
// in the tools app; every value a view shows crossed agent → hub → link.
// ─────────────────────────────────────────────────────────────────────────────

/** Every stack and part a test started; `afterEach` shuts them down. */
let started: (Stoppable | undefined)[] = [];

/** The unhandled-rejection tracker of the running test, if any. */
let unhandled: UnhandledTracker | undefined;

afterEach(async () => {
  unhandled?.stop();
  unhandled = undefined;
  await shutdown(...started);
  started = [];
});

/**
 * Starts the whole stack and registers it for shutdown.
 *
 * @returns The live stack.
 */
async function liveStack(): Promise<Stack> {
  const stack = await startStack();
  started.push(stack);
  return stack;
}

/** Sources a screenless tiny game cannot answer: the link logs one `link:watch-failed` each. */
const SCREENLESS = new Set([
  "game.render",
  "game.assets",
  "game.ui",
  "game.entities",
  "game.projections"
]);

/**
 * The error entries of the apps, without the known screenless `link:watch-failed` entries.
 *
 * @param apps - The apps to read.
 * @returns The other error entries.
 */
function realErrors(...apps: readonly Logged[]) {
  return logErrors(...apps).filter(entry => {
    if (entry.event !== "link:watch-failed") return true;
    const { data } = entry;
    const id = typeof data === "object" && data !== null && "id" in data ? data.id : undefined;
    return typeof id !== "string" || !SCREENLESS.has(id);
  });
}

/**
 * How many tools `read` requests of one game source crossed the hub.
 *
 * @param tap - The wire tap.
 * @param id - The source id.
 * @returns The count.
 */
function gameReads(tap: Tap, id: string): number {
  return tap.requests("tools", "read", "game").filter(message => paramsOf(message)?.id === id)
    .length;
}

/**
 * The wire subs of the tools `watch` requests of one source, from tap entry `from` on.
 *
 * @param tap - The wire tap.
 * @param id - The source id, or undefined for every source.
 * @param from - The first tap entry to look at.
 * @returns The subs.
 */
function watchSubs(tap: Tap, id: string | undefined, from = 0): number[] {
  const subs: number[] = [];
  for (const entry of tap.entries.slice(from)) {
    if (entry.dir !== "in" || entry.kind !== "tools") continue;
    const { message } = entry;
    if (!("method" in message) || message.method !== "watch" || message.channel !== "game") {
      continue;
    }
    const params = paramsOf(message);
    if (id !== undefined && params?.id !== id) continue;
    if (typeof params?.sub === "number") subs.push(params.sub);
  }
  return subs;
}

/**
 * True when every tools watch of a source got at least one value from the hub.
 *
 * @param tap - The wire tap.
 * @param id - The source id.
 * @returns Whether all its watches delivered.
 */
function allDelivered(tap: Tap, id: string): boolean {
  const subs = watchSubs(tap, id);
  const valued = new Set(tap.sent("tools", "value", "game").map(note => paramsOf(note)?.sub));
  return subs.length > 0 && subs.every(sub => valued.has(sub));
}

/**
 * The subs the tools sent `unwatch` for.
 *
 * @param tap - The wire tap.
 * @returns The subs.
 */
function unwatchedSubs(tap: Tap): Set<number> {
  const subs = new Set<number>();
  for (const message of tap.requests("tools", "unwatch", "game")) {
    const sub = paramsOf(message)?.sub;
    if (typeof sub === "number") subs.add(sub);
  }
  return subs;
}

/** The sources of the P1 probe panel. */
const PROBE_SOURCES = { pos: "game.position", last: ["game.history", { last: 1 }] } as const;

/** The commands of the P1 probe panel. */
const PROBE_COMMANDS = { answer: "game.answer" } as const;

/** What the P1 probe view received. */
type ProbeValues = Panels.PanelValues<typeof PROBE_SOURCES>;

/** The kept `tools.run.answer` of the P1 probe view. */
type ProbeAnswer = Panels.PanelTools<typeof PROBE_COMMANDS>["run"]["answer"];

/** What the P1 probe records. */
type ProbeRecord = { readonly views: ProbeValues[]; answer: ProbeAnswer | undefined };

/**
 * The P1 probe: a real tools plugin that registers a definePanel panel on the state workspace in
 * `onInit`. Its view records every values object and keeps `tools.run.answer`.
 *
 * @param record - Where the view writes.
 * @returns The plugin.
 */
function createProbePanel(record: ProbeRecord) {
  const probe = definePanel({
    id: "probe",
    title: "Probe",
    workspace: "state",
    sources: PROBE_SOURCES,
    commands: PROBE_COMMANDS,
    view: (values, tools) => {
      record.views.push(values);
      record.answer = tools.run.answer;
      return h("p", { "data-probe": "" }, values.pos.path);
    }
  });
  return createPlugin("probePanel", {
    depends: [panelsPlugin],
    onInit: ctx => {
      ctx.require(panelsPlugin).register(probe);
    }
  });
}

/**
 * The text of the last history entry the probe saw.
 *
 * @param record - The probe record.
 * @returns The JSON text, or "" before any view.
 */
function lastHistory(record: ProbeRecord): string {
  return JSON.stringify(record.views.at(-1)?.last ?? "");
}

describe("cross-plugin panels", () => {
  it("P1 runs a definePanel panel over the real wire: gate, placeholder, run, unwatch", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const root = await createProject("tiny");
    const server = await startServer(root);
    started.push(server);
    const page = installPage(server.origin, server.app.hub.path());
    const record: ProbeRecord = { views: [], answer: undefined };
    const tools = await bootTools(server, { plugins: [createProbePanel(record)] });
    started.push(tools);
    const { panels, workspace, link } = tools.app;

    // Before the agent: the state host shows the generic no-game placeholder.
    workspace.show("state");
    const section = (): HTMLElement | null =>
      workspace.host("state").querySelector<HTMLElement>('[data-panel="probe"]');
    await until(() => section()?.dataset.panelState === "no-game", "the no-game placeholder");
    expect(section()?.textContent).toContain("No game connected");
    expect(record.views).toEqual([]);
    expect(page.root.contains(section())).toBe(true);
    expect(panels.list().map(panel => panel.id)).toContain("probe");

    // The agent arrives; the view renders only once both sources delivered.
    const game = await createTinyGame();
    started.push(game);
    const agent = await startAgent(server, game);
    started.push(agent);
    await until(() => link.status().kind === "live", "a live link");
    await until(() => record.views.length > 0, "the first probe view");
    expect(
      record.views.every(values => values.pos !== undefined && values.last !== undefined)
    ).toBe(true);
    expect(record.views[0]?.pos.path).toBe("home");
    expect(section()?.dataset.panelState).toBe("ready");

    // The kept tools.run.answer walks one round; the run is a panel run.
    // `home` is a checkpoint: the history since it is empty at rest.
    const before = lastHistory(record);
    expect(before).toBe("[]");
    const latest = (): ProbeValues | undefined => record.views.at(-1);
    const answer = record.answer;
    if (answer === undefined) throw new Error("the probe view kept no answer");
    const ran: RunResult = await answer({ intent: "play" });
    expect(ran.state.path).toBe("home");
    // The run stops at visit/enter until a frame is stepped; its refresh sends the position and the
    // edge taken. Both stay until the next frame, so the probe shows them. Stepping first would
    // leave only a short-lived value: the frame walks back to `home` and empties the history.
    await until(
      () => latest()?.pos.path === "visit/enter" && lastHistory(record) !== before,
      "the run's position and edge in the probe"
    );
    expect(latest()?.last).toEqual([
      expect.objectContaining({ path: "home", outcome: "play", next: "visit/enter" })
    ]);
    await game.frames(1);
    await until(
      () => latest()?.pos.path === "home" && lastHistory(record) === before,
      "the probe back at home with an empty history"
    );
    expect(tools.eventsOf("workspace:ran")).toEqual([
      expect.objectContaining({ id: "game.answer", origin: "panel", ok: true })
    ]);

    // A detached mount watches on its own subs; its unmount unwatches exactly them.
    const from = server.tap.entries.length;
    const detached = document.createElement("div");
    const unmount = panels.mountInto("state", detached);
    await until(
      () =>
        watchSubs(server.tap, "game.position", from).length > 0 &&
        watchSubs(server.tap, "game.history", from).length > 0,
      "the detached mount's watches"
    );
    expect(detached.querySelector('[data-panel="probe"]')).not.toBeNull();
    const subs = watchSubs(server.tap, undefined, from);
    unmount();
    await until(
      () => subs.every(sub => unwatchedSubs(server.tap).has(sub)),
      "an unwatch for every detached sub"
    );
    expect(detached.querySelector('[data-panel="probe"]')).toBeNull();
  });

  it("P2 stateView follows one commit and the taint over the wire", async () => {
    const stack = await liveStack();
    const { tools, game, server } = stack;
    const { stateView, panels, workspace, link } = tools.app;
    workspace.show("state");
    await until(
      () =>
        allDelivered(server.tap, "game.model") &&
        stateView.tainted() === false &&
        stateView.graph() !== undefined,
      "the tracker baseline, taint and graph"
    );
    expect(stateView.lastCommit()).toBeUndefined();
    expect(stateView.note()).toBeDefined();
    expect(stateView.graph()).toEqual(await link.read("game.graph"));

    const seqs = new Set<number>();
    const off = stateView.onCommit(() => {
      const seq = stateView.lastCommit()?.seq;
      if (seq !== undefined) seqs.add(seq);
    });
    await panels.run("game.answer", { intent: "play" });
    await game.frames(1);
    await until(() => stateView.lastCommit() !== undefined, "the first commit");

    const commit = stateView.lastCommit();
    expect(commit?.patches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ root: "player", pointer: "/player/coins", was: 0, value: 5 }),
        expect.objectContaining({ root: "player", pointer: "/player/visits", was: 0, value: 1 })
      ])
    );
    expect(typeof commit?.frame).toBe("number");
    expect(stateView.tainted()).toBe(false);

    await panels.run("tiny.warn");
    await until(() => stateView.tainted() === true, "the taint after a cheat");
    expect([...seqs]).toEqual([commit?.seq]);
    off();

    stateView.setExpanded("/player", true);
    expect(stateView.expanded("/player", 99)).toBe(true);
    stateView.expandAll("player", false);
    expect(stateView.expanded("/player", 0)).toBe(false);
    expect(stateView.note()).toBeDefined();
  });

  it("P3 consoleView sees a game warn without a poll; the rail badge follows", async () => {
    const stack = await liveStack();
    const { tools, server, page } = stack;
    const { consoleView, panels } = tools.app;
    let fired = 0;
    consoleView.subscribe(() => {
      fired += 1;
    });
    const isWarned = (line: ReturnType<typeof consoleView.lines>[number]): boolean =>
      line.kind === "entry" && line.event === "tiny:warned" && line.level === "warn";
    await until(() => allDelivered(server.tap, "game.log"), "the first game.log value");

    // The warn line arrives through the watch: no extra read of game.log.
    const reads = gameReads(server.tap, "game.log");
    await panels.run("tiny.warn");
    await until(() => consoleView.lines().some(line => isWarned(line)), "the tiny:warned line");
    expect(gameReads(server.tap, "game.log")).toBe(reads);
    expect(consoleView.counts().warn).toBeGreaterThanOrEqual(1);

    await expect(panels.run("tiny.fail")).rejects.toThrow();
    await until(() => consoleView.counts().error >= 1, "the error line of tiny.fail");

    // The console rail badge shows warn + error and is red.
    const badge = (): HTMLElement | null =>
      page.root.querySelector<HTMLElement>('button[data-workspace="console"] [data-badge]');
    const { warn, error } = consoleView.counts();
    await until(
      () => badge()?.dataset.tone === "error" && badge()?.textContent === String(warn + error),
      "the red console badge"
    );

    // Filters.
    const entries = (lines: ReturnType<typeof consoleView.lines>) =>
      lines.filter(line => line.kind === "entry");
    consoleView.setFilter({ level: "warn" });
    const warnOnly = entries(consoleView.visible());
    expect(warnOnly.length).toBeLessThan(entries(consoleView.lines()).length);
    expect(warnOnly.every(line => line.level === "warn")).toBe(true);
    consoleView.setFilter({ level: "all", query: "tiny" });
    expect(consoleView.filter()).toEqual({ level: "all", query: "tiny" });
    const matched = entries(consoleView.visible());
    expect(matched.some(line => line.event === "tiny:warned")).toBe(true);
    expect(matched.every(line => `${line.source} ${line.message}`.includes("tiny"))).toBe(true);
    consoleView.setFilter({ query: "" });

    // Selection.
    const warned = consoleView.lines().find(line => isWarned(line));
    consoleView.select(warned?.key);
    expect(consoleView.selected()).toEqual(warned);

    // refresh() sends exactly one read of game.log.
    const beforeRefresh = gameReads(server.tap, "game.log");
    consoleView.refresh();
    await until(() => gameReads(server.tap, "game.log") > beforeRefresh, "the refresh read");
    await settle();
    expect(gameReads(server.tap, "game.log")).toBe(beforeRefresh + 1);

    // Preserve on: the lines survive a game page reload.
    consoleView.setPreserve(true);
    expect(consoleView.preserve()).toBe(true);
    await reloadAgent(stack, createTinyGame);
    await until(
      () =>
        consoleView
          .lines()
          .some(line => line.kind === "meta" && line.text === "Game page reloaded · log preserved"),
      "the preserved-log line"
    );
    expect(consoleView.lines().some(line => isWarned(line))).toBe(true);

    // The new game logs once, so its trace has a first entry the next reload can tell apart.
    await panels.run("tiny.warn");
    await until(
      () => consoleView.lines().filter(line => isWarned(line)).length >= 2,
      "the warn of the reloaded game"
    );

    // Preserve off: the lines reset on the next reload.
    consoleView.setPreserve(false);
    await reloadAgent(stack, createTinyGame);
    await until(
      () =>
        consoleView
          .lines()
          .some(line => line.kind === "meta" && line.text.startsWith("Log cleared")),
      "the cleared-log line"
    );
    expect(consoleView.lines().some(line => isWarned(line))).toBe(false);

    consoleView.clear();
    expect(entries(consoleView.lines())).toEqual([]);
    expect(consoleView.lines()).toEqual([expect.objectContaining({ text: "Console cleared" })]);
    expect(fired).toBeGreaterThan(0);
  });

  // A game that logged nothing leaves no instance: the new link session marks the next reload.
  it("P3 resets the log on a reload after a game that logged nothing", async () => {
    const stack = await liveStack();
    const { consoleView, panels } = stack.tools.app;
    await panels.run("tiny.warn");
    await until(
      () => consoleView.lines().some(line => line.kind === "entry" && line.event === "tiny:warned"),
      "the tiny:warned line"
    );
    consoleView.setPreserve(true);
    await reloadAgent(stack, createTinyGame);
    await until(
      () => consoleView.lines().some(line => line.kind === "meta"),
      "the preserved-log line"
    );

    consoleView.setPreserve(false);
    await reloadAgent(stack, createTinyGame);
    await until(
      () =>
        consoleView
          .lines()
          .some(line => line.kind === "meta" && line.text.startsWith("Log cleared")),
      "the cleared-log line",
      1500
    );
    expect(consoleView.lines().some(line => line.kind === "entry")).toBe(false);
  });

  it("P4 renderView and gameView read a screenless game cleanly", async () => {
    unhandled = trackUnhandled();
    const stack = await liveStack();
    const { tools, server, agent, game } = stack;
    const { renderView, gameView, workspace } = tools.app;

    workspace.show("render");
    await renderView.refresh();
    const manifestReads = server.tap
      .requests("tools", "read", "files")
      .filter(message => paramsOf(message)?.path === "manifest.json");
    expect(manifestReads.length).toBeGreaterThan(0);

    const snapshot = renderView.snapshot();
    expect(Object.keys(snapshot.tiles).toSorted()).toEqual([
      "drawCalls",
      "fps",
      "frameMs",
      "heap",
      "scene",
      "textures"
    ]);
    expect(snapshot.tiles.drawCalls?.kind ?? "absent").toBe("absent");
    expect(snapshot.tiles.heap).toEqual({ kind: "absent" });

    // The catalogue knows the manifest textures, but no bundle is loaded on a screenless game:
    // the rows come only from loaded bundles, so there are none, sorted or filtered.
    const catalogue = await gameView.manifest();
    expect([...(catalogue?.bundles.keys() ?? [])].toSorted()).toEqual(["board", "ui"]);
    expect(catalogue?.textures.size).toBeGreaterThan(0);
    expect(snapshot.textures).toEqual([]);
    renderView.sortTextures("size");
    renderView.filterBundle("ui");
    expect(renderView.snapshot().textures).toEqual([]);
    renderView.filterBundle("all");

    // A screenless game cannot answer game.ui (the game's source reads `app.ui.tree`), so the scene
    // rejects with the link's wire error, as GameViewApi.scene documents; locate goes through it.
    await expect(gameView.scene()).rejects.toThrow(ProtocolError);
    await expect(gameView.scene()).rejects.toThrow(/game\.ui/);
    await expect(gameView.locate({ kind: "ui", path: "column#0" })).rejects.toThrow(/game\.ui/);
    renderView.highlight(undefined);
    gameView.highlight(undefined);

    await settle();
    expect(realErrors(server.app, agent.app, tools.app, game.app)).toEqual([]);
    expect(unhandled.list).toEqual([]);
  });
});

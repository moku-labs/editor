import { readFile } from "node:fs/promises";
import path from "node:path";
import { createApp as createGameApp, defineGame, exit, type } from "@moku-labs/game";
import { createHeadless, fakeClock, memory } from "@moku-labs/game/testing";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isRequest, isResponse, type LinkStatus, type Message } from "../../src/index";
import {
  type AgentStack,
  bootTools,
  createProject,
  createTinyGame,
  FIRST_NOTE,
  installPage,
  type Logged,
  logErrors,
  type Page,
  PNG_1X1,
  paramsOf,
  reloadAgent,
  type ServerStack,
  STYLES_FIXTURE,
  type Stack,
  type StackOptions,
  type StartedGame,
  type Stoppable,
  settle,
  shutdown,
  startAgent,
  startServer,
  startStack,
  type Tap,
  TINY_NAME,
  type TinyPlayer,
  type ToolsApp,
  type ToolsStack,
  trackUnhandled,
  type UnhandledTracker,
  until
} from "./helpers/stack";

// ─────────────────────────────────────────────────────────────────────────────
// User journeys on the tiny game (plan §3, journey-tiny.test.ts, J1–J5): what a
// person does in the editor, end to end over the real wire. Open the editor and
// move around the flow (J1), pause and walk the history (J2), edit a style and
// get the game back where it was (J3), take pictures (J4), and set the device,
// the overlay in the game, the theme and the palette (J5).
// ─────────────────────────────────────────────────────────────────────────────

let stack: Stack | undefined;
const extras: (Stoppable | undefined)[] = [];
let unhandled: UnhandledTracker | undefined;

afterEach(async () => {
  unhandled?.stop();
  unhandled = undefined;
  await shutdown(...extras.splice(0), stack);
  stack = undefined;
});

/** Bun's own Event, taken before the page stubs `Event` with the happy-dom class. */
const NativeEvent = globalThis.Event;

/** The overlay host attribute (overlay/types.ts HOST_ATTRIBUTE). */
const OVERLAY_HOST = "[data-moku-editor-overlay]";

/** flowView's layout file (flowView config `layoutFile`). */
const LAYOUT_FILE = ".moku/editor/layout.json";

/** Sources a screenless tiny game fails to read: one `link:watch-failed` each, at error level. */
const SCREENLESS_IDS: ReadonlySet<string> = new Set([
  "game.render",
  "game.assets",
  "game.effects",
  "game.ui",
  "game.entities",
  "game.projections"
]);

/** What the journeys read of a live stack: `startStack()`, or the walk stack of J2. */
type Live = {
  readonly server: ServerStack;
  readonly page: Page;
  readonly tools: ToolsStack;
  readonly agent: AgentStack;
  readonly game: { readonly app: Logged };
};

/**
 * Starts the whole stack and tracks unhandled rejections.
 *
 * @param options - The startStack options.
 * @returns The live stack.
 */
async function liveStack(options: StackOptions = {}): Promise<Stack> {
  unhandled = trackUnhandled();
  stack = await startStack(options);
  return stack;
}

/**
 * The error entries of the apps, without the watch failures a screenless tiny game causes.
 *
 * @param apps - The apps to read.
 * @returns The other error entries.
 */
function realErrors(...apps: readonly Logged[]) {
  return logErrors(...apps).filter(entry => {
    const data: { readonly id?: unknown } = entry.data ?? {};
    return !(
      entry.event === "link:watch-failed" &&
      typeof data.id === "string" &&
      SCREENLESS_IDS.has(data.id)
    );
  });
}

/**
 * Every app of a stack, for the clean check.
 *
 * @param live - The live stack.
 * @returns The four apps.
 */
function appsOf(live: Live): Logged[] {
  return [live.server.app, live.agent.app, live.tools.app, live.game.app];
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
 * Waits until the tools app is fully attached: watches open and every call answered. A stop then
 * meets no call in flight (link/subscriptions/watch.ts:66 logs those at error level).
 *
 * @param live - The live stack.
 * @returns Resolves when attached.
 */
async function attached(live: Live): Promise<void> {
  await until(() => live.server.tap.watchedIds().length > 0, "the tools watches");
  await until(() => unanswered(live.server.tap).length === 0, "every tools call answered");
}

/**
 * Lets a window of real time pass (a series that should run for a while).
 *
 * @param ms - The window.
 * @returns Resolves after it.
 */
async function waitFor(ms: number): Promise<void> {
  const from = performance.now();
  await until(() => performance.now() - from >= ms, `${String(ms)} ms`, ms + 1000);
}

/**
 * One element under a root, failing loudly when it is missing.
 *
 * @param root - Where to look.
 * @param selector - A CSS selector.
 * @returns The element.
 * @throws {Error} When nothing matches.
 */
function elementIn(root: ParentNode, selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (element === null) throw new Error(`no element matches ${selector}`);
  return element;
}

/**
 * Clicks an element inside `act`, so Preact renders what the click changed.
 *
 * @param element - The element.
 * @returns Resolves after the render.
 */
async function click(element: HTMLElement): Promise<void> {
  await act(() => {
    element.click();
  });
}

/**
 * Dispatches one pointer event at client coordinates inside `act`.
 *
 * @param target - The element.
 * @param kind - The pointer event type.
 * @param x - Client x.
 * @param y - Client y.
 * @returns Resolves after the render.
 */
async function pointer(
  target: Element,
  kind: "pointerdown" | "pointermove" | "pointerup",
  x: number,
  y: number
): Promise<void> {
  const event = new PointerEvent(kind, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
    pointerId: 1
  });
  await act(() => {
    target.dispatchEvent(event);
  });
}

/**
 * Presses a key the way the workspace listens: its one keydown listener sits on `globalThis`
 * (Bun's global here), whose `dispatchEvent` takes only a Bun `Event`, while the listener checks
 * `instanceof KeyboardEvent` against the stubbed happy-dom class. So the event is a Bun `Event`
 * with the happy-dom `KeyboardEvent` prototype and its key fields as own properties.
 *
 * @param key - The `key` of the press.
 * @returns Resolves after the render.
 */
async function pressKey(key: string): Promise<void> {
  const event = new NativeEvent("keydown", { cancelable: true });
  Object.setPrototypeOf(event, globalThis.KeyboardEvent.prototype);
  Object.defineProperties(event, {
    key: { value: key },
    code: { value: "" },
    metaKey: { value: false },
    ctrlKey: { value: false },
    altKey: { value: false },
    shiftKey: { value: false },
    target: { value: globalThis.document.body },
    preventDefault: { value: () => undefined }
  });
  await act(() => {
    globalThis.dispatchEvent(event);
  });
}

/**
 * The texts of the toasts in the page.
 *
 * @param live - The live stack.
 * @returns One text per visible toast.
 */
function toastTexts(live: Live): string[] {
  return [...live.page.root.querySelectorAll("[data-toast]")].map(toast => toast.textContent ?? "");
}

/**
 * The `run` requests of one command the hub sent to agents, with the agent connection.
 *
 * @param tap - The wire tap.
 * @param id - The command id.
 * @returns One entry per run: its connection and message.
 */
function agentRuns(tap: Tap, id: string): { conn: number; message: Message }[] {
  return tap.entries
    .filter(entry => entry.dir === "out" && entry.kind === "agent")
    .filter(entry => "method" in entry.message && entry.message.method === "run")
    .filter(entry => paramsOf(entry.message)?.id === id)
    .map(entry => ({ conn: entry.conn, message: entry.message }));
}

/**
 * The `sub` of every game-channel `watch` the tools app sent, from one tap index on.
 *
 * @param tap - The wire tap.
 * @param from - The first tap entry to read.
 * @returns The subs, in order.
 */
function watchSubs(tap: Tap, from = 0): unknown[] {
  return tap.entries
    .slice(from)
    .filter(entry => entry.dir === "in" && entry.kind === "tools")
    .filter(entry => "method" in entry.message && entry.message.method === "watch")
    .map(entry => paramsOf(entry.message)?.sub);
}

/**
 * The flow canvas of the tools page.
 *
 * @param live - The live stack.
 * @returns The Flow host.
 */
function flowHost(live: Live): HTMLElement {
  return live.tools.app.workspace.host("flow");
}

/**
 * The keys of the node cards on the flow canvas.
 *
 * @param live - The live stack.
 * @returns The keys, in DOM order.
 */
function cardKeys(live: Live): string[] {
  return [...flowHost(live).querySelectorAll<HTMLElement>('[data-flow="node-card"]')].map(
    card => card.dataset.key ?? ""
  );
}

/**
 * The breadcrumb segments of the flow canvas.
 *
 * @param live - The live stack.
 * @returns The segment texts.
 */
function crumbs(live: Live): string[] {
  return [...flowHost(live).querySelectorAll('[data-flow="breadcrumb"] [data-part="segment"]')].map(
    segment => segment.textContent ?? ""
  );
}

/**
 * The history rows of the flow canvas: text and whether each is selected.
 *
 * @param live - The live stack.
 * @returns One entry per row, newest first.
 */
function historyRows(live: Live): { text: string; selected: boolean }[] {
  return [...flowHost(live).querySelectorAll<HTMLElement>('[data-flow="history-row"]')].map(
    row => ({ text: row.textContent ?? "", selected: row.getAttribute("aria-selected") === "true" })
  );
}

/**
 * Waits until the flow camera stops moving (its animations run on real timers) for 100 ms.
 *
 * @param camera - flowView's camera api.
 * @param camera.get - Reads the camera.
 * @returns The camera at rest.
 */
async function cameraAtRest(camera: { get(): Camera }): Promise<Camera> {
  let last = JSON.stringify(camera.get());
  let since = performance.now();
  await until(() => {
    const now = JSON.stringify(camera.get());
    if (now !== last) {
      last = now;
      since = performance.now();
    }
    return performance.now() - since >= 100;
  }, "the camera at rest");
  return camera.get();
}

/**
 * The frame a link status carries, or -1 when it carries none.
 *
 * @param status - A link status.
 * @returns The frame.
 */
function frameOf(status: LinkStatus): number {
  return status.kind === "live" || status.kind === "paused" ? status.frame : -1;
}

/** The flow camera: pan x, y and zoom z. */
type Camera = ReturnType<ToolsApp["flowView"]["camera"]["get"]>;

/** The workspace prefs `onPrefs` hands out. */
type Prefs = Parameters<Parameters<ToolsApp["workspace"]["onPrefs"]>[0]>[0];

/** A series index.json as gameView writes it (gameView/types.ts SeriesIndex). */
type SeriesIndexJson = {
  readonly label: string;
  readonly durationMs: number;
  readonly intervalMs: number;
  readonly fromFrame: number;
  readonly shots: readonly { readonly file: string; readonly frame: number }[];
  readonly device?: { readonly name: string; readonly orientation: string };
  readonly stoppedEarly?: boolean;
};

/**
 * Reads a series index.json from the project.
 *
 * @param root - The project root.
 * @param indexPath - The index path, project-relative.
 * @returns The parsed index.
 */
async function readIndex(root: string, indexPath: string): Promise<SeriesIndexJson> {
  const index: SeriesIndexJson = JSON.parse(await readFile(path.join(root, indexPath), "utf8"));
  return index;
}

// ── The walk game of J2 ──────────────────────────────────────────────────────
// The tiny game's `home` is a checkpoint, and the engine compacts the flow
// journal when a walk comes back to a checkpoint: `game.history` is always
// empty at rest there. J2 walks the history, so it runs on the same flows with
// `home` a rest node that is not a checkpoint.

/** The authoring helpers bound to the walk game's types (the tiny game's trees). */
const walk = defineGame<{
  player: TinyPlayer;
  session: Record<string, never>;
  assets: string;
  strings: Record<string, unknown>;
}>();

/** The rest node of the walk game: no checkpoint, so the journal is kept. */
const walkHome = walk.defineNode({ outcomes: { play: type(), end: type() }, rest: true });

/** First node of `visit`: pays 5 coins and counts the visit. */
const walkEnter = walk.defineNode({
  outcomes: { done: type() },
  run: ({ player, out }) => {
    player.coins += 5;
    player.visits += 1;
    return out.done();
  }
});

/** Last node of `visit`. */
const walkLeave = walk.defineNode({ outcomes: { done: type() }, run: ({ out }) => out.done() });

/** The sub-flow `visit`. */
const walkVisit = walk.defineFlow("visit", {
  nodes: { enter: walkEnter, leave: walkLeave },
  start: "enter",
  outcomes: { done: type() },
  edges: { enter: { done: "leave" }, leave: { done: exit("done") } }
});

/** The safe node the engine asks for: a rest checkpoint, never visited by J2. */
const walkBase = walk.defineNode({ outcomes: { go: type() }, rest: true, checkpoint: true });

/** The top-level flow: `home` -play-> `visit` -done-> `home`; `home` -end-> `base` -go-> `home`. */
const walkMain = walk.defineFlow("main", {
  nodes: { home: walkHome, visit: walkVisit, base: walkBase },
  start: "home",
  edges: { home: { play: "visit", end: "base" }, visit: { done: "home" }, base: { go: "home" } }
});

/**
 * Runs `start` with the page hidden, so the game starts headless without a real frame loop
 * (the helper's `withoutPage`, which stack.ts does not export).
 *
 * @param start - Creates and starts the game.
 * @returns What `start` resolved with.
 */
async function withoutPage<Started>(start: () => Promise<Started>): Promise<Started> {
  const saved = {
    window: globalThis.window,
    document: globalThis.document,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame
  };
  for (const name of Object.keys(saved)) vi.stubGlobal(name, undefined);
  try {
    return await start();
  } finally {
    for (const [name, value] of Object.entries(saved)) vi.stubGlobal(name, value);
  }
}

/**
 * Creates and starts the walk game headless; it rests at `home`.
 *
 * @returns The started game.
 */
async function createWalkGame() {
  const app = createGameApp({
    pluginConfigs: {
      model: {
        playerProvider: memory(),
        initialPlayer: { coins: 0, visits: 0 },
        initialSession: {},
        seed: 42
      },
      clock: { source: fakeClock(1_000_000) },
      flow: { mainFlow: walkMain, safeNode: "base" }
    }
  });
  app.log.clearSinks();
  const headless = await withoutPage(() => createHeadless(app));
  const frames = async (count: number): Promise<void> => {
    for (let frame = 0; frame < count; frame += 1) {
      app.time.step(16);
      await settle();
    }
  };
  await frames(1);
  return { kind: "game", app, frames, stop: () => headless.stop() } satisfies StartedGame & {
    readonly app: Logged;
    frames(count: number): Promise<void>;
  };
}

/** The started walk game. */
type WalkGame = Awaited<ReturnType<typeof createWalkGame>>;

/**
 * Starts the stack of `startStack` on the walk game: project, server, page, agent, tools, live.
 *
 * @returns The live parts; afterEach stops them.
 */
async function walkStack(): Promise<Live & { readonly game: WalkGame }> {
  unhandled = trackUnhandled();
  vi.stubGlobal("__MOKU_GAME_DEV__", true);
  const root = await createProject("tiny");
  const server = await startServer(root);
  extras.push(server);
  const page = installPage(server.origin, server.app.hub.path());
  const game = await createWalkGame();
  extras.push(game);
  const agent = await startAgent(server, game);
  extras.push(agent);
  const tools = await bootTools(server);
  extras.push(tools);
  const { link } = tools.app;
  await until(
    () => link.status().kind === "live" && link.manifest() !== undefined,
    "a live link with a manifest"
  );
  return { server, page, tools, agent, game };
}

describe("journey-tiny: open the editor", () => {
  it("J1: top bar, Flow by default, camera calls and a drag that pins one card", async () => {
    const live = await liveStack();
    const { tools, page, server, root } = live;
    const { workspace, flowView } = tools.app;

    // 1–2. live, then the top bar
    const bar = elementIn(page.root, '[data-ui="top-bar"]');
    await until(
      () => elementIn(bar, '[data-ui="link-pill"]').dataset.kind === "live",
      "the live pill"
    );
    expect(elementIn(bar, "[data-game-name]").textContent).toBe(TINY_NAME);
    expect(elementIn(bar, '[data-ui="link-pill"] [data-text]').textContent).toMatch(
      /^Live · f\d+$/
    );

    // 3. the Flow canvas
    expect(workspace.active()).toBe("flow");
    await until(() => cardKeys(live).includes("main/home"), "the home card");
    expect(cardKeys(live)).toEqual(["main/home", "main/visit"]);
    const home = elementIn(flowHost(live), '[data-flow="node-card"][data-key="main/home"]');
    expect(home.getAttribute("aria-current")).toBe("location");
    await until(
      () => flowHost(live).querySelector('[data-flow="you-are-here"]') !== null,
      "the You are here tag"
    );
    expect(elementIn(flowHost(live), '[data-flow="you-are-here"]').textContent).toBe("main/home");
    expect(flowView.focus.current()).toBe("main/home");

    // 4. camera calls (happy-dom has no layout: the viewport is empty, fits go to the zoom floor)
    const { camera } = flowView;
    const first = await cameraAtRest(camera);
    camera.fitAll();
    const fitted = await cameraAtRest(camera);
    expect(fitted).not.toEqual(first);
    camera.zoomTo(1);
    const one = await cameraAtRest(camera);
    expect(one.z).toBeCloseTo(1, 9);
    camera.zoomBy(100);
    const top = await cameraAtRest(camera);
    expect(top.z).toBeCloseTo(3, 9);
    camera.zoomBy(0.0001);
    const zoomed = await cameraAtRest(camera);
    expect(zoomed.z).toBeCloseTo(0.08, 9);
    expect(flowView.focus.select("main/home")).toBe(true);
    camera.fitSelection();
    expect(await cameraAtRest(camera)).not.toEqual(zoomed);
    expect(camera.follow(true)).toBe(true);
    expect(camera.follow(false)).toBe(false);

    // 5. drag the enter card of the expanded visit sub-flow by 48 × 24 units
    flowView.flows.expand("main/visit");
    const enterKey = "main/visit>visit/enter";
    await until(() => cardKeys(live).includes(enterKey), "the enter card");
    const enter = elementIn(flowHost(live), `[data-flow="node-card"][data-key="${enterKey}"]`);
    const { z } = camera.get();
    await pointer(enter, "pointerdown", 100, 100);
    await pointer(enter, "pointermove", 100 + 48 * z, 100 + 24 * z);
    await pointer(enter, "pointerup", 100 + 48 * z, 100 + 24 * z);
    await until(() => toastTexts(live).some(text => text.includes("Layout saved")), "the toast");

    expect(server.written.filter(entry => entry.path === LAYOUT_FILE)).toEqual([
      { path: LAYOUT_FILE, bytes: expect.any(Number), kind: "layout" }
    ]);
    const layout: { nodes: Record<string, { x: number; y: number }> } = JSON.parse(
      await readFile(path.join(root, LAYOUT_FILE), "utf8")
    );
    expect(Object.keys(layout.nodes)).toEqual(["visit/enter"]);
    expect(flowView.layout.pinnedCount()).toBe(1);
    await attached(live);
    expect(realErrors(...appsOf(live))).toEqual([]);
    expect(unhandled?.list).toEqual([]);
  });
});

describe("journey-tiny: pause and walk", () => {
  it("J2: pause from the top bar, step one frame, walk the history, open the sub-flow", async () => {
    const live = await walkStack();
    const { tools, page, game } = live;
    const { panels, flowView, link } = tools.app;
    const pause = () => elementIn(page.root, '[data-ui="top-bar"] [data-action="pause"]');

    // 1. two rounds, one frame apart
    await panels.run("game.answer", { intent: "play" });
    const firstFrame = frameOf(link.status());
    await game.frames(1);
    await until(() => frameOf(link.status()) === firstFrame + 1, "the next frame on the link");
    await panels.run("game.answer", { intent: "play" });

    // 2. pause from the top bar, then one step
    await click(pause());
    await until(() => link.status().kind === "paused", "the link paused");
    const pausedAt = frameOf(link.status());
    const stepped = await flowView.focus.step();
    expect(stepped?.state.frame).toBe(pausedAt + 1);
    await until(() => frameOf(link.status()) === pausedAt + 1, "the stepped frame on the link");
    expect(link.status().kind).toBe("paused");
    expect(flowView.focus.current()).toBe("main/home");

    // 3. the history: both rounds, newest first; walk; focus a frame
    expect(flowView.focus.history(true)).toBe(true);
    await until(() => historyRows(live).length === 6, "six history rows");
    const round = [
      "visit/leavedone → home",
      "visit/enterdone → visit/leave",
      "homeplay → visit/enter"
    ];
    // The editor dates an edge by the heartbeat frame it saw it at: the second round, played
    // after the link showed the next frame, carries that frame.
    expect(historyRows(live).map(row => row.text)).toEqual([
      ...round.map(text => expect.stringContaining(`f${String(firstFrame + 1)}${text}`)),
      ...round.map(text => expect.stringContaining(text))
    ]);
    expect(flowView.focus.selected()).toBeUndefined();
    flowView.focus.walk("prev");
    expect(flowView.focus.selected()).toBe("main/visit");
    flowView.focus.walk("next");
    expect(flowView.focus.selected()).toBe("main/home");
    expect(flowView.focus.focusFrame(firstFrame + 1)).toBe(true);
    expect(flowView.focus.selected()).toBe("main/visit>visit/leave");
    await until(
      () => toastTexts(live).includes(`Frame ${String(firstFrame + 1)} · visit/leave · done`),
      "the focus-frame toast"
    );
    const later = firstFrame + 100;
    expect(flowView.focus.focusFrame(later)).toBe(true);
    await until(
      () =>
        toastTexts(live).some(text =>
          text.startsWith(
            `No edge at frame ${String(later)} · last edge before it f${String(firstFrame + 1)}`
          )
        ),
      "the no-edge toast"
    );
    const rows = flowHost(live).querySelectorAll<HTMLElement>('[data-flow="history-row"]');
    const third = rows[2];
    if (third === undefined) throw new Error("no third history row");
    await click(third);
    expect(historyRows(live).map(row => row.selected)).toEqual([
      false,
      false,
      true,
      false,
      false,
      false
    ]);

    // 4. the visit sub-flow: expand, collapse, enter, up
    flowView.flows.expand("main/visit");
    await until(() => cardKeys(live).includes("main/visit>visit/leave"), "the expanded sub-flow");
    expect(cardKeys(live)).toEqual(
      expect.arrayContaining(["main/visit>visit/enter", "main/visit>visit/leave"])
    );
    flowView.flows.collapse("main/visit");
    await until(() => cardKeys(live).includes("main/visit"), "the collapsed sub-flow");
    expect(cardKeys(live).some(key => key.includes("visit/enter"))).toBe(false);
    flowView.flows.enter("main/visit");
    await until(() => crumbs(live).length === 2, "the visit breadcrumb");
    expect(crumbs(live)).toEqual(["main", "visit"]);
    expect(cardKeys(live)).toEqual(["visit/enter", "visit/leave"]);
    flowView.flows.up(0);
    await until(() => crumbs(live).length === 1, "back to main");
    expect(crumbs(live)).toEqual(["main"]);

    // 5. resume from the top bar
    await click(pause());
    await until(() => link.status().kind === "live", "the link live");
    await attached(live);
    expect(realErrors(...appsOf(live))).toEqual([]);
    expect(unhandled?.list).toEqual([]);
  });
});

describe("journey-tiny: edit a style", () => {
  it("J3: a style step writes styles.ts, the game reloads and comes back restored", async () => {
    const live = await liveStack();
    const { tools, server, root } = live;
    const { panels, flowView, stateView } = tools.app;
    const flow = flowHost(live);
    await panels.run("game.answer", { intent: "play" });
    await attached(live);
    const subsBefore = watchSubs(server.tap);
    const reloadFrom = server.tap.entries.length;

    // 1. home, the Styles tab, ui.number, size one step up
    expect(flowView.focus.select("main/home")).toBe(true);
    await until(
      () => flow.querySelector('[data-flow="inspector"] [role="tab"]') !== null,
      "the inspector tabs"
    );
    const styles = [
      ...flow.querySelectorAll<HTMLElement>('[data-flow="inspector"] [role="tab"]')
    ].find(tab => tab.textContent === "Styles");
    if (styles === undefined) throw new Error("no Styles tab");
    await click(styles);
    const stylesText = () => flow.querySelector('[data-flow="styles-tab"]')?.textContent ?? "";
    await until(() => stylesText().includes('"ui.title": {'), "styles.ts read into the tab");
    const select = elementIn(flow, '[data-flow="styles-tab"] select');
    await act(() => {
      if (select instanceof HTMLSelectElement) select.value = "ui.number";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await until(() => stylesText().includes('"ui.number": {'), "ui.number chosen");
    await click(elementIn(flow, '[data-field="size"] [data-action="step-up"]'));

    // 2. the bookmark answered: workspace reassigns the iframe src next, so the page reloads.
    // The answer and a later session close travel on one socket, in order.
    await until(() => agentRuns(server.tap, "game.bookmark").length === 1, "the bookmark run");
    await until(() => unanswered(server.tap).length === 0, "the bookmark answered");
    const oldConn = agentRuns(server.tap, "game.bookmark")[0]?.conn;
    await reloadAgent(live, createTinyGame);

    // 3. the toast
    await until(
      () => toastTexts(live).includes("Game reloaded · state restored from the last checkpoint"),
      "the restore toast"
    );

    const fixture = await readFile(STYLES_FIXTURE, "utf8");
    const edited = await readFile(path.join(root, "features/ui/styles.ts"), "utf8");
    const editedLines = edited.split("\n");
    expect(fixture.split("\n").filter((line, index) => line !== editedLines[index])).toEqual([
      "    size: 60,"
    ]);
    expect(server.written).toContainEqual(
      expect.objectContaining({ path: "features/ui/styles.ts", kind: "style" })
    );
    const restores = agentRuns(server.tap, "game.restore");
    expect(restores).toHaveLength(1);
    expect(restores[0]?.conn).not.toBe(oldConn);
    await live.game.frames(1);
    expect(live.game.app.model.store.snapshot().player).toEqual({ coins: 5, visits: 1 });
    await until(() => stateView.tainted() === true, "stateView tainted after the restore");

    await attached(live);
    const subsAfter = watchSubs(server.tap, reloadFrom);
    expect(subsAfter.length).toBeGreaterThan(0);
    expect(subsAfter.filter(sub => subsBefore.includes(sub))).toEqual([]);
    expect(live.page.root.querySelectorAll("[data-stale]")).toHaveLength(0);
    expect(
      [...live.page.root.querySelectorAll<HTMLElement>("[data-panel-state]")].map(
        panel => panel.dataset.panelState
      )
    ).not.toContain("stale");
    expect(realErrors(...appsOf(live))).toEqual([]);
    expect(unhandled?.list).toEqual([]);
  });
});

describe("journey-tiny: pictures", () => {
  it("J4: capture, series, stopped series, previews, contact sheet and a note", async () => {
    const live = await liveStack({ agent: { png: PNG_1X1 } });
    const { tools, server, root } = live;
    const { gameView, filesView, workspace } = tools.app;

    // 1. one capture: named after the flow (gameView/capture/naming.ts nodeOf)
    const capture = await gameView.capture();
    if (capture === undefined) throw new Error("the capture was refused");
    expect(capture.path).toMatch(/^\.moku\/captures\/\d{4}-\d{2}-\d{2}-\d{4}-main\.png$/);
    expect(server.written).toContainEqual({
      path: capture.path,
      bytes: expect.any(Number),
      kind: "capture"
    });
    expect(toastTexts(live)).toContain(`✓ Screenshot saved · ${capture.path}`);
    workspace.show("game");
    await until(
      () => workspace.host("game").querySelector('[data-game="card"]') !== null,
      "the capture card"
    );

    // 2. a series in one call
    const series = await gameView.series({ durationMs: 400, intervalMs: 100 });
    if (series === undefined) throw new Error("the series was refused");
    expect(agentRuns(server.tap, "editor.series")).toHaveLength(1);
    expect(series.folder).toMatch(/^\.moku\/captures\/series-\d{4}-\d{2}-\d{2}-\d{4}\/$/);
    expect(series.shots).toBeGreaterThan(0);
    const index = await readIndex(root, series.indexPath);
    expect(index).toMatchObject({
      label: "home",
      durationMs: 400,
      intervalMs: 100,
      fromFrame: expect.any(Number),
      device: { name: expect.any(String), orientation: expect.any(String) }
    });
    expect(index.stoppedEarly).toBeUndefined();
    expect(index.shots.map(shot => shot.file)).toEqual(
      Array.from({ length: series.shots }, (_, at) => `${String(at + 1).padStart(3, "0")}.png`)
    );
    for (const shot of index.shots) {
      expect(await readFile(path.join(root, series.folder, shot.file))).toHaveProperty(
        "length",
        70
      );
    }

    // 3. a long series, stopped early
    const running = gameView.series({ durationMs: 20_000, intervalMs: 100 });
    await waitFor(300);
    gameView.stopSeries();
    const stopped = await running;
    if (stopped === undefined) throw new Error("the stopped series was refused");
    expect(stopped.shots).toBeGreaterThan(0);
    expect(agentRuns(server.tap, "editor.series")).toHaveLength(2);
    expect(agentRuns(server.tap, "editor.seriesStop")).toHaveLength(1);
    const partial = await readIndex(root, stopped.indexPath);
    expect(partial.stoppedEarly).toBe(true);
    expect(partial.shots).toHaveLength(stopped.shots);

    // 4. the png preview, read with readBinary
    await filesView.open(capture.path);
    expect(workspace.active()).toBe("files");
    const files = workspace.host("files");
    await until(
      () =>
        files.querySelector<HTMLImageElement>('[data-preview="image"] img')?.getAttribute("src") ===
        PNG_1X1,
      "the png preview"
    );

    // 5. the series card opens the contact sheet with every shot
    await filesView.open(series.indexPath);
    await until(
      () => files.querySelector('[data-preview="series"] button') !== null,
      "the series card"
    );
    await click(elementIn(files, '[data-preview="series"] button'));
    expect(tools.eventsOf("workspace:open-sheet")).toEqual([{ index: series.indexPath }]);
    await until(() => workspace.active() === "game", "Game shown");
    await until(
      () =>
        workspace.host("game").querySelectorAll('[data-game="sheet"] [data-part="tile"]').length ===
        series.shots,
      "a tile per shot"
    );

    // 6. attach the capture to the first note
    await gameView.attach(capture.path, FIRST_NOTE);
    const note = await readFile(path.join(root, FIRST_NOTE), "utf8");
    expect(note).toContain(`captures:\n  - ${capture.path}\n`);

    expect(agentRuns(server.tap, "editor.capture")).toHaveLength(1);
    await attached(live);
    expect(realErrors(...appsOf(live))).toEqual([]);
    expect(unhandled?.list).toEqual([]);
  });
});

describe("journey-tiny: device, overlay, theme, palette", () => {
  it("J5: prefs persist, the overlay opens in the game, cheats run, the palette closes on Esc", async () => {
    const live = await liveStack();
    const { tools, server, page } = live;
    const { workspace, consoleView, stateView, link } = tools.app;
    const prefs: Prefs[] = [];
    const offPrefs = workspace.onPrefs(next => prefs.push(next));

    // 1. device and preview
    const preset = { id: "iphone-15" } as const;
    expect(workspace.devices()[1]?.id).toBe(preset.id);
    workspace.setDevice({ preset: preset.id, orientation: "landscape" });
    workspace.setPreview("flow", { size: "L", corner: "bottom-left" });
    expect(workspace.device()).toMatchObject({
      preset: { id: preset.id },
      orientation: "landscape"
    });
    expect(workspace.preview("flow")).toMatchObject({ size: "L", corner: "bottom-left" });

    // 2. theme
    workspace.setTheme("dark");
    expect(workspace.theme()).toBe("dark");
    offPrefs();
    expect(prefs.at(-1)).toMatchObject({
      theme: "dark",
      device: { preset: { id: preset.id }, orientation: "landscape" },
      previews: { flow: { size: "L", corner: "bottom-left" } }
    });

    // 3. the overlay in the game
    await workspace.setOverlayInGame(true);
    expect(agentRuns(server.tap, "editor.overlay").map(run => paramsOf(run.message))).toEqual([
      { id: "editor.overlay", input: { on: true } }
    ]);
    expect(live.agent.app.overlay.isOpen()).toBe(true);
    const host = elementIn(page.gamePage, OVERLAY_HOST);
    expect(host.hidden).toBe(false);
    const shadow = host.shadowRoot;
    if (shadow === null) throw new Error("the overlay host has no shadow root");
    expect(shadow.querySelector('[data-cheat="tiny.hang"]')).toBeNull();

    // 4. the tiny.warn cheat button
    await click(elementIn(shadow, '[data-cheat="tiny.warn"]'));
    await until(() => stateView.tainted() === true, "a tainted game in stateView");
    expect(await link.read("game.tainted")).toBe(true);
    await until(
      () => consoleView.lines().some(line => line.kind === "entry" && line.event === "tiny:warned"),
      "the warn line in Console"
    );

    // 5. the game page reloads: the overlay is opened again on the new session
    const oldConn = agentRuns(server.tap, "editor.overlay")[0]?.conn;
    await reloadAgent(live, createTinyGame);
    const agent = live.agent;
    await until(() => agent.app.overlay.isOpen(), "the overlay open on the new agent");
    const reopened = agentRuns(server.tap, "editor.overlay").at(-1);
    if (reopened === undefined) throw new Error("no editor.overlay run");
    expect(reopened.conn).not.toBe(oldConn);
    expect(paramsOf(reopened.message)).toEqual({
      id: "editor.overlay",
      input: { on: true }
    });

    // 6. the overlay off
    await workspace.setOverlayInGame(false);
    expect(agent.app.overlay.isOpen()).toBe(false);
    expect(workspace.overlayInGame()).toBe(false);
    expect(toastTexts(live)).toContain("Overlay in game off");

    // 7. the palette, then Escape: one layer per press
    let editorOpen = true;
    const offLayer = workspace.keys.escape("noteEditor", () => {
      if (!editorOpen) return false;
      editorOpen = false;
      return true;
    });
    const paletteOpen = () =>
      page.root.querySelector('[data-ui="palette"] [role="combobox"]') !== null;
    workspace.palette.open("visit");
    await until(paletteOpen, "the palette open");
    const options = [...page.root.querySelectorAll('[data-ui="palette"] [role="option"]')].map(
      option => option.textContent ?? ""
    );
    expect(options).toContain("main/visit");
    await pressKey("Escape");
    expect(paletteOpen()).toBe(false);
    expect(editorOpen).toBe(true);
    await pressKey("Escape");
    expect(editorOpen).toBe(false);
    offLayer();

    // a fresh tools app on the same localStorage keeps the device, preview and theme
    const fresh = await bootTools(server, { mount: false });
    extras.push(fresh);
    expect(fresh.app.workspace.device()).toMatchObject({
      preset: { id: preset.id },
      orientation: "landscape"
    });
    expect(fresh.app.workspace.preview("flow")).toMatchObject({ size: "L", corner: "bottom-left" });
    expect(fresh.app.workspace.theme()).toBe("dark");

    await attached(live);
    expect(realErrors(...appsOf(live))).toEqual([]);
    expect(unhandled?.list).toEqual([]);
  });
});

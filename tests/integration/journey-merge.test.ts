import { readFile } from "node:fs/promises";
import path from "node:path";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Json, Manifest } from "../../src/index";
import type { ConsoleView } from "../../src/tools";
import { MERGE_NAME, type MergeGame, type MergeOptions, startMergeGame } from "./helpers/merge";
import {
  type AgentStack,
  bootTools,
  createProject,
  installPage,
  type Page,
  PNG_1X1,
  paramsOf,
  reloadAgent,
  type ServerStack,
  type Stoppable,
  shutdown,
  startAgent,
  startServer,
  type Tap,
  type ToolsConfigs,
  type ToolsStack,
  trackUnhandled,
  type UnhandledTracker,
  until
} from "./helpers/stack";

// ─────────────────────────────────────────────────────────────────────────────
// User journeys on the real merge game (plan §3, journey-merge.test.ts, M1–M5).
// Local only: helpers/merge.ts calls loadMergeGame, which needs the pinned game
// checkout (tests/fixtures/game-dir.ts), so vitest.config.ts skips this file on CI (its text names
// loadMergeGame). The tiny CI game has no screen; this file is where the scene
// content, the texture table and the D-07 reload and restore after a style edit
// are checked for real: open the editor and walk onto the board (M1), pick an
// element between Game and Render (M2), edit a style and get the board back
// (M3), follow a commit and a failed tap (M4), and record a series (M5).
// ─────────────────────────────────────────────────────────────────────────────

/** Every journey gets 30 s: three cores and a real game start for each one. */
const TIMEOUT_MS = 30_000;

/** The 15 game sources of the merge game's manifest, sorted. */
const GAME_SOURCES = [
  "game.assets",
  "game.cheats",
  "game.effects",
  "game.entities",
  "game.graph",
  "game.history",
  "game.log",
  "game.model",
  "game.position",
  "game.projections",
  "game.rect",
  "game.render",
  "game.sounds",
  "game.tainted",
  "game.ui"
];

/** The 14 game commands of the merge game's manifest, sorted. */
const GAME_COMMANDS = [
  "game.answer",
  "game.bookmark",
  "game.capture",
  "game.debug",
  "game.drag",
  "game.fill",
  "game.key",
  "game.pause",
  "game.reducedMotion",
  "game.restore",
  "game.resume",
  "game.step",
  "game.tap",
  "game.walk"
];

/** The editor commands the agent adds (capture and overlay), sorted. */
const EDITOR_COMMANDS = ["editor.capture", "editor.overlay", "editor.series", "editor.seriesStop"];

/** The eight outcomes board/awaitIntent waits for: one hub lane each, sorted. */
const BOARD_OUTCOMES = [
  "deliver",
  "elapsed",
  "give",
  "leave",
  "merge",
  "openSettings",
  "select",
  "tap"
];

/** The scene id of the board slot, the parent of every board entity. */
const BOARD_SLOT = "ui:boardScreen/boardSlot";

/** The text styles file flowView edits (its `stylesFile` default). */
const STYLES_FILE = "features/ui/styles.ts";

/** The toast of a reload that restored the bookmark. */
const RESTORED = "Game reloaded · state restored from the last checkpoint";

/** The merge stack: project, server, page, agent on a merge game, tools. */
type MergeStack = {
  readonly root: string;
  readonly server: ServerStack;
  readonly page: Page;
  readonly tools: ToolsStack;
  /** Changes on `reloadMerge`. */
  game: MergeGame;
  /** Changes on `reloadMerge`. */
  agent: AgentStack;
};

/** Which merge game the stack serves and whether the capture door gets a renderer. */
type StackChoice = {
  /** Default: headless at splash. */
  readonly game?: MergeOptions;
  /** A data URL the game's renderer answers (`withRenderer`; headless games only). */
  readonly png?: string;
  /** Extra tools pluginConfigs (e.g. another default workspace than Game). */
  readonly tools?: ToolsConfigs;
};

/** One file of an asset manifest, as far as the texture checks read it. */
type ManifestFile = { readonly key: string; readonly width?: number; readonly height?: number };

/** An asset manifest, as far as the texture checks read it. */
type AssetManifest = {
  readonly bundles: Readonly<Record<string, { readonly files: readonly ManifestFile[] }>>;
};

const running: (Stoppable | undefined)[] = [];
let unhandled: UnhandledTracker | undefined;

afterEach(async () => {
  unhandled?.stop();
  unhandled = undefined;
  await shutdown(...running.splice(0));
});

/**
 * Remembers a started part for the bounded shutdown in afterEach.
 *
 * @param part - A started part.
 * @returns The same part.
 */
function keep<Part extends Stoppable>(part: Part): Part {
  running.push(part);
  return part;
}

/**
 * Starts the stack on the merge project (`createProject("merge")`) and a merge game, then waits
 * until the link is live with the merge manifest. Tracks unhandled rejections.
 *
 * @param choice - Which game, and a renderer answer for the capture door.
 * @returns The live stack.
 */
async function mergeStack(choice: StackChoice = {}): Promise<MergeStack> {
  unhandled = trackUnhandled();
  vi.stubGlobal("__MOKU_GAME_DEV__", true);
  const root = await createProject("merge");
  const server = keep(await startServer(root));
  const page = installPage(server.origin, server.app.hub.path());
  const game = keep(await startMergeGame(choice.game));
  const agent = keep(
    await startAgent(server, game, {
      modules: [],
      name: MERGE_NAME,
      ...(choice.png === undefined ? {} : { png: choice.png })
    })
  );
  const tools = keep(
    await bootTools(server, choice.tools === undefined ? {} : { configs: choice.tools })
  );
  const { link } = tools.app;
  await until(
    () => link.status().kind === "live" && link.manifest()?.game === MERGE_NAME,
    "a live link with the merge manifest"
  );
  return { root, server, page, tools, game, agent };
}

/**
 * Plays "the game page reloaded" on the merge stack and keeps the new agent and game for shutdown.
 *
 * @param live - The stack; its `agent` and `game` change.
 * @param makeGame - Starts the fresh game.
 * @returns Resolves when the new agent started (not yet linked).
 */
async function reloadMerge(live: MergeStack, makeGame: () => Promise<MergeGame>): Promise<void> {
  await reloadAgent(live, makeGame);
  keep(live.game);
  keep(live.agent);
}

/**
 * Steps one 16 ms frame unless the game is there, then reads the game path: the check of an
 * `until` that walks the game.
 *
 * @param game - The merge game.
 * @param path - The path to reach.
 * @returns Whether the game is there.
 */
async function steppedTo(game: MergeGame, path: string): Promise<boolean> {
  if (game.app.flow.state().path === path) return true;
  await game.frames(1);
  return game.app.flow.state().path === path;
}

/**
 * Walks the headless merge game from splash onto the board through the agent: `loaded` at the
 * splash, then `play` at home (the answer the Play plank gives).
 *
 * @param live - The stack, its game resting at splash.
 * @returns Resolves on `board/awaitIntent`.
 */
async function walkToBoard(live: MergeStack): Promise<void> {
  const { link } = live.tools.app;
  await link.run("game.answer", { intent: "loaded" });
  await until(() => steppedTo(live.game, "home"), "home");
  await link.run("game.answer", { intent: "play" });
  await until(() => steppedTo(live.game, "board/awaitIntent"), "board/awaitIntent");
}

/**
 * Waits for a run while stepping 16 ms frames: a route command may settle on a later frame.
 *
 * @param game - The merge game.
 * @param pending - The run.
 * @returns What the run resolved with.
 */
async function settleStepping<Value>(game: MergeGame, pending: Promise<Value>): Promise<Value> {
  let settled = false;
  pending.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    }
  );
  await until(async () => {
    if (!settled) await game.frames(1);
    return settled;
  }, "the run to settle");
  return pending;
}

/**
 * The ids of a manifest list with a prefix, sorted.
 *
 * @param entries - Sources or commands.
 * @param prefix - `game.` or `editor.`.
 * @returns The ids.
 */
function idsOf(entries: readonly { readonly id: string }[] | undefined, prefix: string): string[] {
  return (entries ?? [])
    .map(entry => entry.id)
    .filter(id => id.startsWith(prefix))
    .toSorted();
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
 * The first button under a root with exactly this text.
 *
 * @param root - Where to look.
 * @param text - The button text.
 * @returns The button, or undefined.
 */
function buttonWith(root: ParentNode, text: string): HTMLElement | undefined {
  return [...root.querySelectorAll<HTMLElement>("button")].find(
    button => button.textContent === text
  );
}

/**
 * Clicks an element inside `act`, so Preact renders what the click changed.
 *
 * @param element - The element.
 * @returns Resolves after the render.
 * @throws {Error} When there is no element.
 */
async function click(element: HTMLElement | undefined): Promise<void> {
  if (element === undefined) throw new Error("nothing to click");
  await act(() => {
    element.click();
  });
}

/**
 * One tab of flowView's Inspector by its label.
 *
 * @param flow - The Flow host.
 * @param label - "Info", "Code" or "Styles".
 * @returns The tab.
 * @throws {Error} When the Inspector has no such tab.
 */
function inspectorTab(flow: HTMLElement, label: string): HTMLElement {
  const tab = [...flow.querySelectorAll<HTMLElement>('[data-flow="inspector"] [role="tab"]')].find(
    candidate => candidate.textContent.startsWith(label)
  );
  if (tab === undefined) throw new Error(`no ${label} tab in the Inspector`);
  return tab;
}

/**
 * The texts of the toasts in the page.
 *
 * @param page - The installed page.
 * @returns One text per visible toast.
 */
function toastTexts(page: Page): string[] {
  return [...page.root.querySelectorAll("[data-toast]")].map(toast => toast.textContent);
}

/**
 * The lines of a project file.
 *
 * @param root - The project root.
 * @param file - The file path under the root.
 * @returns Its lines.
 */
async function linesOf(root: string, file: string): Promise<string[]> {
  const text = await readFile(path.join(root, file), "utf8");
  return text.split("\n");
}

/**
 * gameView's pink box (`--pick-tree`) over the game frame.
 *
 * @returns The box, or null when none is drawn.
 */
function pinkBox(): Element | null {
  return document.querySelector('[data-box="tree"]');
}

/**
 * renderView's box over the game frame.
 *
 * @returns The box, or null when none is drawn.
 */
function renderBox(): Element | null {
  return document.querySelector('[data-render="box"] [data-box]');
}

/**
 * The name the Element tab shows for the selected element.
 *
 * @param host - The Game host.
 * @returns The name, or undefined while the tab shows no element.
 */
function elementName(host: HTMLElement): string | undefined {
  return host.querySelector('[data-part="element"] [data-part="name"]')?.textContent;
}

/**
 * True when every tools watch of a source got at least one value from the hub.
 *
 * @param tap - The wire tap.
 * @param id - The source id.
 * @returns Whether all its watches delivered.
 */
function delivered(tap: Tap, id: string): boolean {
  const subs = tap
    .requests("tools", "watch", "game")
    .filter(message => paramsOf(message)?.id === id)
    .map(message => paramsOf(message)?.sub);
  const valued = new Set(tap.sent("tools", "value", "game").map(note => paramsOf(note)?.sub));
  return subs.length > 0 && subs.every(sub => valued.has(sub));
}

/**
 * The `run` requests the hub sent to agents for one command, with the agent connection.
 *
 * @param tap - The wire tap.
 * @param id - The command id.
 * @returns One entry per run: its connection and when the hub sent it.
 */
function agentRuns(tap: Tap, id: string): { conn: number; at: number }[] {
  return tap.entries
    .filter(entry => entry.dir === "out" && entry.kind === "agent")
    .filter(entry => "method" in entry.message && entry.message.method === "run")
    .filter(entry => paramsOf(entry.message)?.id === id)
    .map(entry => ({ conn: entry.conn, at: entry.at }));
}

/**
 * A value inside a JSON tree by its keys.
 *
 * @param value - The tree.
 * @param keys - The object keys from the top.
 * @returns The value, or undefined when a key is missing.
 */
function jsonAt(value: Json | undefined, keys: readonly string[]): Json | undefined {
  let at = value;
  for (const key of keys) {
    at = typeof at === "object" && at !== null && !Array.isArray(at) ? at[key] : undefined;
  }
  return at;
}

/**
 * How many items stand on the board of a game.model value.
 *
 * @param model - The game.model value.
 * @returns The item count, -1 when the model has no board.
 */
function boardItems(model: Json): number {
  const items = jsonAt(model, ["player", "merge", "board", "items"]);
  return Array.isArray(items) ? items.length : -1;
}

/**
 * True for the game's own log line of the sawmill tap: `moku:dev` for `game.tap` with a target,
 * not a key.
 *
 * @param line - A console line.
 * @returns Whether it is that line.
 */
function isSawmillTap(line: ConsoleView.LogLine): line is ConsoleView.EntryLine {
  return (
    line.kind === "entry" &&
    line.event === "moku:dev" &&
    jsonAt(line.data, ["command"]) === "game.tap" &&
    jsonAt(line.data, ["key"]) === undefined
  );
}

/**
 * The texture files of an asset manifest (the files with a size), by key.
 *
 * @param manifest - The parsed manifest.
 * @returns Key to bundle and size.
 */
function texturesOf(
  manifest: AssetManifest
): Map<string, { bundle: string; width: number; height: number }> {
  const textures = new Map<string, { bundle: string; width: number; height: number }>();
  for (const [bundle, { files }] of Object.entries(manifest.bundles)) {
    for (const file of files) {
      if (file.width === undefined || file.height === undefined) continue;
      textures.set(file.key, { bundle, width: file.width, height: file.height });
    }
  }
  return textures;
}

/**
 * Counts the assignments to an iframe's `src`: the workspace reloads the game frame by setting
 * `src` (to the same URL), which happy-dom does not load. Wraps the accessor of this one element.
 *
 * @param iframe - The game frame.
 * @returns Reads the number of `src` assignments so far.
 * @throws {Error} When the element has no `src` accessor.
 */
function countSrcSets(iframe: HTMLIFrameElement): () => number {
  let proto: object | null = Object.getPrototypeOf(iframe);
  let accessor: PropertyDescriptor | undefined;
  while (proto !== null && accessor === undefined) {
    accessor = Object.getOwnPropertyDescriptor(proto, "src");
    proto = Object.getPrototypeOf(proto);
  }
  const { get, set } = accessor ?? {};
  if (get === undefined || set === undefined) throw new Error("the iframe has no src accessor");
  let sets = 0;
  Object.defineProperty(iframe, "src", {
    configurable: true,
    get: () => get.call(iframe),
    set: (value: string) => {
      sets += 1;
      set.call(iframe, value);
    }
  });
  return () => sets;
}

describe("journey-merge: open the editor on merge-game", () => {
  it(
    "M1: real manifest, splash to board, the board hub in Flow, the Inspector walk and Open in Files",
    async () => {
      const live = await mergeStack();
      const { tools, game, root } = live;
      const { link, workspace, flowView, filesView } = tools.app;

      // The real manifest: 15 game sources, 14 game commands plus the editor commands.
      const manifest: Manifest | undefined = link.manifest();
      expect(idsOf(manifest?.sources, "game.")).toEqual(GAME_SOURCES);
      expect(idsOf(manifest?.commands, "game.")).toEqual(GAME_COMMANDS);
      expect(idsOf(manifest?.commands, "editor.")).toEqual(EDITOR_COMMANDS);

      // Game is the default workspace; flowView watches the flow from start, its canvas
      // renders when Flow is shown.
      expect(workspace.active()).toBe("game");
      workspace.show("flow");

      // 1. splash → home
      expect(game.app.flow.state().path).toBe("splash");
      const loaded = await link.run("game.answer", { intent: "loaded" });
      expect(loaded.value).toBe(true);
      await until(() => steppedTo(game, "home"), "home");

      // 2. home → board. The headless game has no input plugin, so `game.tap { key: "play" }`
      // cannot reach the Play plank here (M4 taps on the screen game); the test gives the answer
      // the plank gives.
      const play = await link.run("game.answer", { intent: "play" });
      expect(play.value).toBe(true);
      await until(() => steppedTo(game, "board/awaitIntent"), "board/awaitIntent");
      await until(() => flowView.focus.current() === "board/awaitIntent", "Flow on the board");

      // 3. Focus board/merge: the board sub-flow opens as a hub with one lane per outcome.
      const flow = workspace.host("flow");
      expect(flowView.focus.select("board/merge")).toBe(true);
      expect(flowView.focus.selected()).toBe("main/board>board/merge");
      await until(
        () => flow.querySelectorAll('[data-flow="lane"]').length === BOARD_OUTCOMES.length,
        "the eight lanes of the board hub"
      );
      const hub = elementIn(flow, '[data-flow="hub"]');
      expect(hub.dataset.key).toBe("main/board>board/awaitIntent");
      expect(elementIn(hub, '[data-tag="current"]').textContent).toBe("You are here");
      const lanes = [...flow.querySelectorAll<HTMLElement>('[data-flow="lane"]')];
      expect(lanes.map(lane => lane.dataset.outcome).toSorted()).toEqual(BOARD_OUTCOMES);

      // The Inspector walk: board/merge comes from board/awaitIntent and goes back to it.
      const info = (): HTMLElement => elementIn(flow, '[data-flow="info-tab"]');
      await until(() => flow.querySelector('[data-flow="info-tab"]') !== null, "the Info tab");
      const comes = [...info().querySelectorAll('[data-part="comes-from"] li button')];
      expect(comes.map(row => row.textContent)).toEqual(["board/awaitIntent · merge"]);
      const goes = [...info().querySelectorAll<HTMLElement>('[data-part="outcomes"] li')];
      expect(
        goes.map(
          row =>
            `${row.dataset.outcome ?? ""} → ${elementIn(row, '[data-part="target"]').textContent}`
        )
      ).toEqual(["done → awaitIntent", "rejected → awaitIntent"]);
      // ← walks to the first Comes from row, the hub.
      flowView.focus.walk("prev");
      expect(flowView.focus.selected()).toBe("main/board>board/awaitIntent");
      expect(flowView.focus.select("board/merge")).toBe(true);

      // 4. Code → Open in Files: workspace:open-file reaches filesView.
      await click(inspectorTab(flow, "Code"));
      const openFiles = '[data-flow="code-tab"] [data-action="open-files"]';
      await until(() => flow.querySelector(openFiles) !== null, "the Code tab's Open in Files");
      await click(elementIn(flow, openFiles));
      await until(() => tools.eventsOf("workspace:open-file").length === 1, "workspace:open-file");
      const source = await linesOf(root, "nodes/merge.ts");
      const defined = source.findIndex(line => line.startsWith("export const merge ")) + 1;
      expect(tools.eventsOf("workspace:open-file")).toEqual([
        { path: "nodes/merge.ts", line: defined }
      ]);
      await until(() => workspace.active() === "files", "Files shown");
      await until(() => filesView.active() === "nodes/merge.ts", "nodes/merge.ts the active tab");
      // fileOf answers from the files index, which filesView loads on its own.
      await until(
        () => filesView.fileOf({ flow: "board", node: "merge" }) === "nodes/merge.ts",
        "fileOf board/merge from the files index"
      );
      expect(unhandled?.list).toEqual([]);
    },
    TIMEOUT_MS
  );
});

describe("journey-merge: Game and Render", () => {
  it(
    "M2: picks the sawmill in Game, reveals it in Render, inspects it back and opens a style source",
    async () => {
      const live = await mergeStack({ game: { screen: true, board: true } });
      const { tools, root } = live;
      const { workspace, gameView, renderView, filesView } = tools.app;

      // 1. The scene of the board, laid out by the game (one reference unit is one page px).
      // Game is the default workspace: its scene watch is calibrated a moment after the values.
      expect(workspace.active()).toBe("game");
      let scene = await gameView.scene();
      await until(async () => {
        scene = await gameView.scene();
        return scene.calibrated;
      }, "a calibrated scene");
      expect(scene.nodes.get(BOARD_SLOT)?.rect).toEqual({ x: 55, y: 801, w: 970, h: 970 });
      const sawmill = [...scene.nodes.values()].find(
        node => node.entity?.owner === "board.generators"
      );
      if (sawmill?.rect === undefined) throw new Error("no placed sawmill on the board");
      expect(sawmill).toMatchObject({
        name: "sawmill",
        parent: BOARD_SLOT,
        texture: "board.generator"
      });
      expect(await gameView.locate(sawmill.ref)).toEqual(sawmill.rect);

      // 2. Select the sawmill: the Element tab shows it.
      const game = workspace.host("game");
      await until(
        () => game.querySelector('[data-panel="game"][data-panel-state="ready"]') !== null,
        "the Game panel ready"
      );
      gameView.select(sawmill.ref);
      await until(() => elementName(game) === "sawmill", "the Element tab showing sawmill");
      expect(gameView.selected()).toEqual(sawmill.ref);

      // The pink box over the game frame follows highlight.
      gameView.highlight(sawmill.ref);
      await until(() => pinkBox() !== null, "the pink box over the sawmill");
      gameView.highlight(undefined);
      await until(() => pinkBox() === null, "the pink box gone");

      // 3. "Show in render tree" emits workspace:reveal; renderView selects the row.
      await click(buttonWith(game, "Show in render tree"));
      await until(() => tools.eventsOf("workspace:reveal").length === 1, "workspace:reveal");
      expect(tools.eventsOf("workspace:reveal")).toEqual([{ ref: sawmill.ref }]);
      expect(workspace.active()).toBe("render");
      const render = workspace.host("render");
      const selectedRow = (): HTMLElement | null =>
        render.querySelector<HTMLElement>('[role="treeitem"][data-selected]');
      await until(() => selectedRow()?.dataset.id === sawmill.id, "the sawmill row selected");
      // renderView rings the row's element over the game once its scene is calibrated.
      await until(() => {
        renderView.highlight(sawmill.ref);
        return renderBox() !== null;
      }, "renderView's box over the sawmill");
      renderView.highlight(undefined);
      expect(renderBox()).toBeNull();

      // The texture rows: every texture of the loaded bundles of manifest.json, no other.
      await until(() => renderView.snapshot().textures.length > 0, "the texture rows");
      const assets: AssetManifest = JSON.parse(
        await readFile(path.join(root, "manifest.json"), "utf8")
      );
      const textures = texturesOf(assets);
      const loaded = new Set(renderView.snapshot().bundles.map(bundle => bundle.name));
      expect(loaded.size).toBeGreaterThan(0);
      const expected = [...textures]
        .filter(([, texture]) => loaded.has(texture.bundle))
        .map(([key]) => key)
        .toSorted();
      const keys = (): string[] =>
        renderView
          .snapshot()
          .textures.map(row => row.key)
          .toSorted();
      expect(keys()).toEqual(expected);
      expect(renderView.snapshot().textures.find(row => row.key === "board.cell")).toMatchObject({
        bundle: "board",
        width: 224,
        height: 219
      });

      // Sort by size: largest first, the same key again flips it.
      const areas = (): number[] =>
        renderView.snapshot().textures.map(row => row.width * row.height);
      renderView.sortTextures("size");
      expect(areas()).toEqual(areas().toSorted((a, b) => b - a));
      expect(areas()[0]).toBeGreaterThan(areas().at(-1) ?? 0);
      renderView.sortTextures("size");
      expect(areas()).toEqual(areas().toSorted((a, b) => a - b));

      // The bundle filter keeps one bundle's rows; "all" brings the others back.
      renderView.filterBundle("board");
      expect(keys()).toEqual(expected.filter(key => textures.get(key)?.bundle === "board"));
      expect(keys().length).toBeLessThan(expected.length);
      renderView.filterBundle("all");
      expect(keys()).toEqual(expected);

      // 4. "Inspect in Game" emits workspace:inspect; gameView shows the sawmill again.
      await click(elementIn(selectedRow() ?? render, '[data-action="inspect"]'));
      await until(() => tools.eventsOf("workspace:inspect").length === 1, "workspace:inspect");
      expect(tools.eventsOf("workspace:inspect")).toEqual([{ ref: sawmill.ref }]);
      expect(workspace.active()).toBe("game");
      expect(gameView.selected()).toEqual(sawmill.ref);
      await until(() => elementName(game) === "sawmill", "the sawmill in the Element tab");

      // 5. The board slot's style card: its source link emits workspace:open-file.
      gameView.select({ kind: "ui", path: "boardScreen/boardSlot" });
      const where = '[data-part="style-card"] [data-part="where"]';
      await until(() => game.querySelector(where) !== null, "the style card of the board slot");
      const [file = "", line = "0"] = elementIn(game, where).textContent.split(":");
      expect(file).toBe("features/board/tray.tsx");
      const lines = await linesOf(root, file);
      expect(lines[Number(line) - 1]).toContain("defineStyle(");
      await click(buttonWith(elementIn(game, '[data-part="style-card"]'), "Open in Files"));
      await until(() => tools.eventsOf("workspace:open-file").length === 1, "workspace:open-file");
      expect(tools.eventsOf("workspace:open-file")).toEqual([{ path: file, line: Number(line) }]);
      await until(() => workspace.active() === "files", "Files shown");
      await until(() => filesView.active() === file, "the style source the active tab");
      expect(unhandled?.list).toEqual([]);
    },
    TIMEOUT_MS
  );

  // gameView's views subscribe to its state when a render commits (useGameView, a layout effect),
  // so a `notify` before the next paint is not lost.
  it(
    "M2b: a select right after the Game panel first renders reaches the Element tab",
    async () => {
      // Flow first, so the Game panel renders for the first time on show.
      const live = await mergeStack({
        game: { screen: true, board: true },
        tools: { workspace: { defaultWorkspace: "flow" } }
      });
      const { workspace, gameView } = live.tools.app;
      const scene = await gameView.scene();
      const sawmill = [...scene.nodes.values()].find(
        node => node.entity?.owner === "board.generators"
      );
      if (sawmill === undefined) throw new Error("no sawmill on the board");

      // Select in the first moments of the Element tab: when it first appears in the Game host.
      const game = workspace.host("game");
      let selected = false;
      const observer = new MutationObserver(() => {
        if (selected || game.querySelector('[data-part="element"]') === null) return;
        selected = true;
        gameView.select(sawmill.ref);
      });
      observer.observe(game, { childList: true, subtree: true });
      workspace.show("game");
      await until(() => selected, "the first render of the Element tab");
      observer.disconnect();
      await until(() => elementName(game) === "sawmill", "the Element tab showing sawmill");
      expect(gameView.selected()).toEqual(sawmill.ref);
      expect(unhandled?.list).toEqual([]);
    },
    TIMEOUT_MS
  );
});

describe("journey-merge: edit a style", () => {
  it(
    "M3: a style edit writes one line, reloads a fresh game and restores it on the board (D-07)",
    async () => {
      const live = await mergeStack();
      await walkToBoard(live);
      const { tools, server, root, page } = live;
      const { workspace, flowView, link } = tools.app;
      // flowView watches the flow from start; its canvas renders when first shown (Game is the
      // default).
      workspace.show("flow");
      await until(() => flowView.focus.current() === "board/awaitIntent", "Flow on the board");
      const before = await readFile(path.join(root, STYLES_FILE), "utf8");
      const iframe = document.querySelector("iframe[data-game-frame]");
      if (!(iframe instanceof HTMLIFrameElement)) throw new Error("no game frame");
      const srcSets = countSrcSets(iframe);

      // 1. Styles tab of a board node, the text style ui.number, size one step up.
      const flow = workspace.host("flow");
      expect(flowView.focus.select("board/awaitIntent")).toBe(true);
      await until(
        () => flow.querySelector('[data-flow="inspector"] [role="tab"]') !== null,
        "the Inspector tabs"
      );
      await click(inspectorTab(flow, "Styles"));
      const keySelect = '[data-flow="styles-tab"] [data-part="key"] select';
      await until(() => flow.querySelector(keySelect) !== null, "the text style select");
      const select = elementIn(flow, keySelect);
      if (!(select instanceof HTMLSelectElement)) throw new Error("the text style is no select");
      await act(() => {
        select.value = "ui.number";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      const stepUp = '[data-flow="styles-tab"] [data-field="size"] [data-action="step-up"]';
      const excerpt = '[data-flow="styles-tab"] [data-part="excerpt"]';
      await until(
        () => flow.querySelector(excerpt)?.textContent.includes('"ui.number"') === true,
        "the ui.number block in the Styles tab"
      );
      const setsBefore = srcSets();
      await click(elementIn(flow, stepUp));

      // 2. The workspace reassigns the frame src: the game page reloads into a fresh headless
      // merge game, resting at splash.
      await until(() => srcSets() > setsBefore, "the game frame reload", 5000);
      await reloadMerge(live, () => startMergeGame());
      expect(live.game.app.flow.state().path).toBe("splash");

      // 3. The toast; the fresh game stands on the board again.
      await until(() => toastTexts(page).includes(RESTORED), "the restored toast", 6000);
      await until(() => steppedTo(live.game, "board/awaitIntent"), "the fresh game on the board");
      expect(await link.read("game.position")).toMatchObject({ path: "board/awaitIntent" });

      // Exactly one line changed: the size of ui.number, one step up.
      const lines = before.split("\n");
      const block = lines.findIndex(text => text.includes('"ui.number": {'));
      const at = lines.findIndex((text, index) => index > block && /^\s+size: \d+,$/u.test(text));
      const size = Number(/\d+/u.exec(lines[at] ?? "")?.[0]);
      const after = await readFile(path.join(root, STYLES_FILE), "utf8");
      expect(after).toBe(lines.with(at, `    size: ${String(size + 1)},`).join("\n"));
      expect(server.written).toContainEqual({
        path: STYLES_FILE,
        bytes: expect.any(Number),
        kind: "style"
      });

      // The bookmark went to the old game, the restore to the new one.
      const bookmarks = agentRuns(server.tap, "game.bookmark");
      const restores = agentRuns(server.tap, "game.restore");
      expect(bookmarks).toHaveLength(1);
      expect(restores).toHaveLength(1);
      expect(restores[0]?.conn).not.toBe(bookmarks[0]?.conn);
      expect(restores[0]?.at ?? 0).toBeGreaterThan(bookmarks[0]?.at ?? 0);
      const applied = '[data-flow="styles-tab"] [data-part="applied"]';
      await until(
        () =>
          flow.querySelector(applied)?.textContent ===
          `✓ Written to ${STYLES_FILE}:${String(at + 1)} · game reloaded · state restored`,
        "the Styles tab result line"
      );
      expect(unhandled?.list).toEqual([]);
    },
    TIMEOUT_MS
  );
});

describe("journey-merge: state and console", () => {
  it(
    "M4: a sawmill tap commits; a failed tap is one console error; a frame link focuses Flow",
    async () => {
      const live = await mergeStack({ game: { board: true } });
      const { tools, game, server, page } = live;
      const { workspace, panels, stateView, consoleView, link, flowView } = tools.app;
      // Flow first: flowView dates each edge by the frame its game.history value arrives at, from
      // its first value (it watches from start; Game is the default workspace).
      workspace.show("flow");
      await until(() => delivered(server.tap, "game.history"), "flowView's first history value");

      // 1. State
      workspace.show("state");
      await until(() => delivered(server.tap, "game.model"), "the first game.model value");
      expect(stateView.lastCommit()).toBeUndefined();
      const itemsBefore = boardItems(await link.read("game.model"));
      expect(itemsBefore).toBeGreaterThan(0);

      // 2. A board tap: the sawmill drops a new item, a commit under the player root.
      const tapped = await settleStepping(
        game,
        panels.run("game.tap", { target: { projection: "board.generators", key: "sawmill" } })
      );
      expect(tapped.value).toBe(true);
      await until(async () => {
        if (stateView.lastCommit() !== undefined) return true;
        await game.frames(1);
        return false;
      }, "the commit of the tap");
      const patches = stateView.lastCommit()?.patches ?? [];
      expect(patches.length).toBeGreaterThan(0);
      for (const patch of patches) expect(patch.pointer.startsWith(`/${patch.root}/`)).toBe(true);
      expect(patches).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            op: "add",
            root: "player",
            pointer: `/player/merge/board/items/${String(itemsBefore)}`
          }),
          expect.objectContaining({ root: "player", pointer: "/player/merge/energy/value" })
        ])
      );
      expect(boardItems(await link.read("game.model"))).toBe(itemsBefore + 1);

      // 3. A tap on a key that is not on screen: one console error line, no prefix; red badge.
      const errorLines = () =>
        consoleView.lines().filter(line => line.kind === "entry" && line.level === "error");
      const errorsBefore = errorLines().length;
      await expect(panels.run("game.tap", { key: "nope" })).rejects.toThrow(
        'No element with the key "nope" is on screen.'
      );
      await until(() => errorLines().length > errorsBefore, "the error line of the failed tap");
      const added = errorLines().slice(errorsBefore);
      expect(added).toEqual([
        expect.objectContaining({
          source: "editor",
          event: "game.tap",
          message: '-32000 game.tap: [game] No element with the key "nope" is on screen.'
        })
      ]);
      const badge = (): HTMLElement | null =>
        page.root.querySelector<HTMLElement>('button[data-workspace="console"] [data-badge]');
      await until(() => {
        const { warn, error } = consoleView.counts();
        return badge()?.dataset.tone === "error" && badge()?.textContent === String(warn + error);
      }, "the red console badge");

      // 4. Console: the log lines carry frames; the tap's frame link focuses that frame in Flow.
      workspace.show("console");
      const tapLine = (): ConsoleView.EntryLine | undefined =>
        consoleView.lines().find(line => isSawmillTap(line));
      await until(() => tapLine()?.frame !== undefined, "the framed log line of the sawmill tap");
      const { key, frame: mark } = tapLine() ?? {};
      const frame = mark?.value ?? -1;
      const host = workspace.host("console");
      const frameLink = `tr[data-key="${String(key)}"] [data-frame-link]`;
      await until(() => host.querySelector(frameLink) !== null, "the frame link of the tap");
      await click(elementIn(host, frameLink));
      await until(() => tools.eventsOf("workspace:focus-frame").length === 1, "focus-frame");
      expect(tools.eventsOf("workspace:focus-frame")).toEqual([{ frame }]);
      expect(workspace.active()).toBe("flow");
      // The line's frame is the frame its game.log value arrived at; flowView keys each edge by
      // the frame its game.history value arrived at. They match unless a heartbeat fell between
      // the two values: then flowView names the last edge before the frame and selects nothing.
      const named = (): string | undefined =>
        toastTexts(page).find(
          text =>
            text.startsWith(`Frame ${String(frame)} · `) ||
            text.startsWith(`No edge at frame ${String(frame)} · `)
        );
      await until(() => named() !== undefined, "the toast naming that frame");
      const toast = named() ?? "";
      const exact = toast.startsWith("Frame ");
      const edge = toast.split(" · ")[exact ? 1 : 2] ?? "";
      expect(edge).toMatch(/^board\//u);
      expect(flowView.focus.selected()).toBe(exact ? `main/board>${edge}` : undefined);
      expect(unhandled?.list).toEqual([]);
    },
    TIMEOUT_MS
  );
});

describe("journey-merge: capture", () => {
  it(
    "M5: a series on merge-game: shots on real frames, index and the contact sheet",
    async () => {
      const live = await mergeStack({ png: PNG_1X1 });
      await walkToBoard(live);
      const { tools, game, server } = live;
      const { gameView, workspace, link } = tools.app;

      // One series while the game steps 16 ms frames.
      let stepping = true;
      const stepper = (async () => {
        while (stepping) {
          await game.frames(1);
          await Bun.sleep(16);
        }
      })();
      const series = await gameView.series({ durationMs: 1000, intervalMs: 100 }).finally(() => {
        stepping = false;
      });
      await stepper;
      if (series === undefined) throw new Error("the series was refused or failed");

      // About ten shots; real frames, strictly increasing; index.json lists them with atMs.
      expect(series.shots).toBeGreaterThanOrEqual(8);
      expect(series.shots).toBeLessThanOrEqual(12);
      const runs = server.tap
        .requests("tools", "run")
        .filter(message => paramsOf(message)?.id === "editor.series");
      expect(runs).toHaveLength(1);
      const indexFile = await link.files.read(series.indexPath);
      const index: {
        readonly label: string;
        readonly shots: readonly { file: string; frame: number; atMs: number }[];
      } = JSON.parse(indexFile.text);
      expect(index.label).toBe("board/awaitIntent");
      expect(index.shots).toHaveLength(series.shots);
      const frames = index.shots.map(shot => shot.frame);
      expect(frames.every((frame, at) => at === 0 || frame > (frames[at - 1] ?? 0))).toBe(true);
      const times = index.shots.map(shot => shot.atMs);
      expect(times.every((atMs, at) => at === 0 || atMs > (times[at - 1] ?? 0))).toBe(true);
      expect(index.shots.map(shot => shot.file)).toEqual(
        index.shots.map((_, at) => `${String(at + 1).padStart(3, "0")}.png`)
      );

      // The contact sheet opens with every shot.
      expect(workspace.active()).toBe("game");
      const sheet = workspace.host("game");
      await until(
        () =>
          sheet.querySelectorAll('[data-game="sheet"] [data-part="tile"]').length === series.shots,
        "a tile per shot on the contact sheet"
      );

      expect(unhandled?.list).toEqual([]);
    },
    TIMEOUT_MS
  );
});

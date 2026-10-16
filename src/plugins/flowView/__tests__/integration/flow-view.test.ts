// @vitest-environment happy-dom
// @vitest-environment-options {"url":"http://127.0.0.1:3000/__editor","settings":{"navigation":{"disableChildFrameNavigation":true}}}
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { ToolsEvents } from "../../../../config";
import { createToolsCore, toolsCoreConfig } from "../../../../config";
import { activeSourcePlugin } from "../../../activeSource";
import { linkPlugin } from "../../../link";
import { panelsPlugin } from "../../../panels";
import type {
  Json,
  Manifest,
  Response as RpcResponse,
  RunResult,
  SessionInfo,
  ToolsBoot
} from "../../../registry/protocol";
import { workspacePlugin } from "../../../workspace";
import { flowViewPlugin } from "../..";
import { parsePins } from "../../layout/pins";
import { cloneGraph } from "../helpers";
import { pointer } from "../render";
import { createFlowHub, type FlowHub } from "./fake-hub";

// ─────────────────────────────────────────────────────────────────────────────
// The real tools core (link, workspace, panels, flowView) over a scripted hub:
// start → mount, show Flow → board hub with 8 lanes and You are here → default
// camera → select → follow an Info tab row → drag → layout.json → intents of
// other views → stale → stop.
// ─────────────────────────────────────────────────────────────────────────────

const framework = createToolsCore(toolsCoreConfig, {
  plugins: [linkPlugin, activeSourcePlugin, workspacePlugin, panelsPlugin, flowViewPlugin]
});

const BOOT: ToolsBoot = {
  v: 1,
  ws: "ws://127.0.0.1:3000/__editor/ws",
  token: "tok-1",
  path: "/__editor",
  title: "moku editor",
  editorUrl: "vscode://file/{path}:{line}",
  root: "/work/game",
  gameUrl: "/game.html"
};

const SESSION: SessionInfo = {
  id: "s-1",
  game: "merge-game 0.0.0",
  page: BOOT.gameUrl,
  embedded: true,
  connectedAt: 1000
};

const MANIFEST: Manifest = {
  game: "merge-game 0.0.0",
  page: "http://127.0.0.1:3000/game.html",
  embedded: true,
  sources: [
    { id: "game.graph", title: "Graph", input: {}, changes: "edge" },
    { id: "game.position", title: "Position", input: {}, changes: "edge" },
    { id: "game.history", title: "History", input: { last: "number?" }, changes: "edge" },
    { id: "game.ui", title: "UI", input: {}, changes: "frame" }
  ],
  commands: [
    { id: "game.step", title: "Step", input: { frames: "number" }, effect: "raw" },
    { id: "game.pause", title: "Pause", input: {}, effect: "raw" },
    { id: "game.resume", title: "Resume", input: {}, effect: "raw" }
  ]
};

let hub: FlowHub;
let root: HTMLElement;
let emits: { emit: <K extends keyof ToolsEvents>(name: K, payload: ToolsEvents[K]) => void }[];
let opened: ToolsEvents["workspace:open-file"][];

/** How long `until` waits for a check (real time; generous for a loaded CI runner). */
const UNTIL_DEADLINE_MS = 10_000;

/**
 * The timeout of every test here: a test waits on the fake hub's real socket several times, each
 * `until` up to UNTIL_DEADLINE_MS, which vitest's 5 s default does not fit under load (the
 * whole-suite pre-commit run took the start-to-stop journey to 6.4 s).
 */
const FLOW_TEST_TIMEOUT_MS = 20_000;

/** The longest `until` sleeps between two checks while the page does not change. */
const UNTIL_TICK_MS = 5;

/** Resolves on the next change of the page (a DOM mutation), else after one tick. */
async function nextChange(): Promise<void> {
  await new Promise<void>(resolve => {
    const observer = new MutationObserver(() => {
      done();
    });
    const timer = setTimeout(() => {
      done();
    }, UNTIL_TICK_MS);
    /** Stops watching and resolves. */
    function done(): void {
      observer.disconnect();
      clearTimeout(timer);
      resolve();
    }
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true
    });
  });
}

/** Waits until a check passes: checks again on each page change, or each tick for app state. */
async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = performance.now() + UNTIL_DEADLINE_MS;
  while (!check()) {
    if (performance.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await act(async () => {
      await nextChange();
    });
  }
}

/** An element of the Flow workspace. */
function find(selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (element === null) throw new Error(`no ${selector}`);
  return element;
}

/** The tools app with a probe plugin that emits global events and records open-file intents. */
function createApp() {
  const probe = framework.createPlugin("probe", {
    onInit: ctx => {
      emits.push({ emit: (name, payload) => ctx.emit(name, payload) });
    },
    hooks: () => ({
      "workspace:open-file": (payload: ToolsEvents["workspace:open-file"]) => {
        opened.push(payload);
      }
    })
  });
  const app = framework.createApp({
    plugins: [probe],
    pluginConfigs: {
      flowView: { layout: { file: ".moku/editor/layout.json", worker: false, saveDelayMs: 0 } }
    }
  });
  app.log.clearSinks();
  return app;
}

beforeEach(() => {
  hub = createFlowHub();
  emits = [];
  opened = [];
  vi.stubGlobal("WebSocket", hub.Socket);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("reduce"),
    addEventListener: () => {},
    removeEventListener: () => {}
  }));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement
  ) {
    return this.dataset.flow === "canvas" ? new DOMRect(0, 0, 1200, 800) : new DOMRect(0, 0, 0, 0);
  });
  localStorage.clear();
  // The shown workspace lives in the URL hash: every app starts on the default (Game).
  history.replaceState(undefined, "", location.pathname);
  document.body.innerHTML = `<script type="application/json" id="moku-editor-boot">${JSON.stringify(BOOT)}</script>`;
  root = document.createElement("div");
  root.dataset.editorRoot = "";
  document.body.append(root);
  hub.files.set("nodes/merge.ts", { text: "export const merge = node({});\n", version: "v1" });
  hub.index.set("node:board/merge", [{ path: "nodes/merge.ts", line: 1 }]);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

/** The first values of the merge game: graph, position and a history with one framed edge. */
function sendFlowValues(): void {
  hub.value(SESSION.id, "game.graph", structuredClone(cloneGraph()));
  hub.value(SESSION.id, "game.position", {
    path: "board/awaitIntent",
    flow: "board",
    node: "awaitIntent",
    waiting: ["tap", "leave"]
  });
  hub.value(SESSION.id, "game.history", [
    {
      index: 3,
      path: "board/merge",
      outcome: "rejected",
      // eslint-disable-next-line unicorn/no-null -- JSON null is a wire value
      payload: null,
      next: "board/awaitIntent",
      now: 1_790_000_000_003,
      hash: "h3",
      frame: 1778
    }
  ]);
  hub.heartbeat(SESSION.id, 1840, false);
}

/** Waits until the session watches of the three flow sources went out. */
async function untilWatched(): Promise<void> {
  await until(
    () => ["game.graph", "game.position", "game.history"].every(id => hub.watches(id).length > 0),
    "the session watches"
  );
}

/** Starts the app on its default workspace (Game) with the flow values in; Flow is never shown. */
async function startOnGame(): Promise<ReturnType<typeof createApp>> {
  const app = createApp();
  await app.start();
  act(() => app.workspace.mount(root));
  hub.open(SESSION, MANIFEST);
  await untilWatched();
  sendFlowValues();
  await until(() => app.flowView.focus.current() === "board/awaitIntent", "the flow values");
  expect(app.workspace.active()).toBe("game");
  return app;
}

/** Relays an editor-channel request to the page as the hub does; a select re-renders, so in act. */
async function ask(method: string, params: Json): Promise<RpcResponse> {
  const asked = hub.ask(method, params);
  await act(async () => {
    await asked;
  });
  return asked;
}

/** The palette option with a label, if it shows. */
function paletteOption(label: string): HTMLElement | undefined {
  return [...root.querySelectorAll<HTMLElement>('[data-ui="palette"] [role="option"]')].find(
    element => element.querySelector("[data-label]")?.textContent === label
  );
}

/** The revision of the project state the page holds; undefined while the index is off. */
function revisionOf(app: ReturnType<typeof createApp>): string | undefined {
  const project = app.link.project();
  return project?.state === "on" ? project.revision : undefined;
}

/** The warnings of an app with one event name. */
function warned(app: ReturnType<typeof createApp>, event: string): unknown[] {
  return app.log.trace().filter(entry => entry.event === event);
}

describe("flowView before Flow is shown (Game is the default workspace)", {
  timeout: FLOW_TEST_TIMEOUT_MS
}, () => {
  it("a Nodes palette item shows Flow and selects its node", async () => {
    const app = await startOnGame();
    act(() => app.workspace.palette.open("board/merge"));
    await until(() => paletteOption("board/merge") !== undefined, "the Nodes item of board/merge");
    act(() => paletteOption("board/merge")?.click());
    expect(app.workspace.active()).toBe("flow");
    expect(app.flowView.focus.selected()).toBe("main/board>board/merge");
    await app.stop();
  });

  it("workspace:select-node shows Flow and selects, with no unknown-node warning", async () => {
    const app = await startOnGame();
    act(() => emits[0]?.emit("workspace:select-node", { id: "board/merge" }));
    expect(app.workspace.active()).toBe("flow");
    expect(app.flowView.focus.selected()).toBe("main/board>board/merge");
    expect(warned(app, "flowView:unknown-node")).toEqual([]);
    await app.stop();
  });

  it("workspace:focus-frame shows Flow and focuses the edge taken at that frame", async () => {
    const app = await startOnGame();
    act(() => emits[0]?.emit("workspace:focus-frame", { frame: 1778 }));
    expect(app.workspace.active()).toBe("flow");
    expect(app.flowView.focus.selected()).toBe("main/board>board/merge");
    await until(
      () => document.body.textContent?.includes("Frame 1778 · board/merge · rejected") === true,
      "the focus-frame toast"
    );
    expect(document.body.textContent).not.toContain("Frames are not recorded in this history");
    await app.stop();
  });

  it("an intent that comes before the first values is applied once they are in", async () => {
    const app = createApp();
    await app.start();
    act(() => app.workspace.mount(root));
    act(() => emits[0]?.emit("workspace:focus-frame", { frame: 1778 }));
    expect(app.workspace.active()).toBe("flow");
    hub.open(SESSION, MANIFEST);
    await untilWatched();
    sendFlowValues();
    await until(() => app.flowView.focus.selected() === "main/board>board/merge", "the selection");
    await until(
      () => document.body.textContent?.includes("Frame 1778 · board/merge · rejected") === true,
      "the focus-frame toast"
    );
    expect(document.body.textContent).not.toContain("Frames are not recorded in this history");
    await app.stop();
  });

  it("the hub's editor.node selects the node and answers its item key; Flow is not shown (D-60)", async () => {
    const app = createApp();
    await app.start();
    act(() => app.workspace.mount(root));
    await until(() => app.link.status().kind === "empty", "the open socket");

    // Before the first graph: a retryable refusal, and nothing waits for the graph.
    expect(await ask("node", { id: "board/merge" })).toMatchObject({
      error: {
        code: -32_003,
        message: "[moku-editor] the Flow view has no graph yet",
        data: { reason: "no_graph", retryable: true }
      }
    });
    hub.open(SESSION, MANIFEST);
    await untilWatched();
    sendFlowValues();
    await until(() => app.flowView.focus.current() === "board/awaitIntent", "the flow values");
    expect(app.flowView.focus.selected()).toBeUndefined();

    expect(await ask("node", { id: "board/merge" })).toMatchObject({
      result: { id: "board/merge", selected: "main/board>board/merge" }
    });
    expect(app.flowView.focus.selected()).toBe("main/board>board/merge");

    expect(await ask("node", { id: "board/nope" })).toMatchObject({
      error: {
        code: -32_602,
        message: "[moku-editor] unknown node board/nope",
        data: { reason: "invalid_input", field: "id" }
      }
    });
    expect(app.flowView.focus.selected()).toBe("main/board>board/merge");
    expect(app.workspace.active()).toBe("game");
    await app.stop();
  });
});

describe("flowView integration", { timeout: FLOW_TEST_TIMEOUT_MS }, () => {
  it("types the app surface: namespaced api, no events of its own", () => {
    const app = createApp();
    expectTypeOf(app.flowView.camera.fitAll).toEqualTypeOf<() => void>();
    expectTypeOf(app.flowView.focus.select).parameter(0).toEqualTypeOf<string | undefined>();
    expectTypeOf(app.flowView.focus.select).returns.toEqualTypeOf<boolean>();
    expectTypeOf(app.flowView.focus.step).returns.toEqualTypeOf<Promise<RunResult | undefined>>();
    expect(app.panels.list().map(panel => panel.id)).toEqual(["flow"]);
    expect(Object.keys(app.flowView).toSorted()).toEqual(["camera", "flows", "focus", "layout"]);
    expect(Object.keys(app.flowView.camera).toSorted()).toEqual([
      "fitAll",
      "fitSelection",
      "follow",
      "get",
      "zoomBy",
      "zoomTo"
    ]);
  });

  it("start → board hub → select → follow → drag → intents → stale → stop", async () => {
    const app = createApp();
    await app.start();
    act(() => app.workspace.mount(root));
    act(() => app.workspace.show("flow"));
    hub.open(SESSION, MANIFEST);
    await until(
      () => hub.watches("game.graph").length > 0 && hub.watches("game.history").length > 0,
      "watches"
    );
    const graph: Json = structuredClone(cloneGraph());
    hub.value(SESSION.id, "game.graph", graph);
    hub.value(SESSION.id, "game.position", {
      path: "board/awaitIntent",
      flow: "board",
      node: "awaitIntent",
      waiting: ["tap", "leave"]
    });
    hub.value(SESSION.id, "game.history", []);
    hub.heartbeat(SESSION.id, 1840, false);

    // The graph renders the hub; the position marks it current: wait for both, and the lanes.
    await until(() => {
      const hubCard = root.querySelector<HTMLElement>('[data-flow="hub"]');
      return (
        hubCard !== null &&
        root.querySelectorAll('[data-flow="lane"]').length === 8 &&
        hubCard.dataset.current === "" &&
        hubCard.textContent?.includes("You are here") === true
      );
    }, "the board hub at the position");
    expect(root.querySelectorAll('[data-flow="lane"]')).toHaveLength(8);
    expect(find('[data-flow="hub"]').dataset.current).toBe("");
    expect(find('[data-flow="hub"]').textContent).toContain("You are here");
    await until(() => app.flowView.camera.get().z >= 0.8, "the default camera");
    expect(app.flowView.focus.current()).toBe("board/awaitIntent");

    expect(app.flowView.focus.select("board/merge")).toBe(true);
    await until(
      () => root.querySelector('[data-flow="info-tab"] [data-part="comes-from"]') !== null,
      "the Info tab"
    );
    const comes = find('[data-flow="info-tab"] [data-part="comes-from"]');
    expect(comes.textContent).toContain("board/awaitIntent");
    act(() => find('[data-flow="info-tab"] [data-part="comes-from"] button').click());
    expect(app.flowView.focus.selected()).toBe("main/board>board/awaitIntent");
    expect(find('[data-key="main/board>board/awaitIntent"]').dataset.pulse).toBe("");
    act(() => find('[data-flow="inspector"] [data-action="back"]').click());
    expect(app.flowView.focus.selected()).toBe("main/board>board/merge");
    expect(root.querySelector('[data-flow="neighbours-strip"]')).toBeNull();

    const merge = find('[data-flow="node-card"][data-key="main/board>board/merge"]');
    const z = app.flowView.camera.get().z;
    pointer(merge, "pointerdown", 100, 100);
    pointer(merge, "pointermove", 100 + 48 * z, 100 + 24 * z);
    pointer(merge, "pointerup", 100 + 48 * z, 100 + 24 * z);
    await until(() => hub.writes(".moku/editor/layout.json").length === 1, "layout.json written");
    const pins = parsePins(hub.files.get(".moku/editor/layout.json")?.text ?? "");
    expect(Object.keys(pins?.nodes ?? {})).toEqual(["board/merge"]);
    await until(
      () => document.body.textContent?.includes("Layout saved") === true,
      "the layout toast"
    );
    expect(app.flowView.layout.pinnedCount()).toBe(1);

    act(() => emits[0]?.emit("workspace:select-node", { id: "board/toast" }));
    expect(app.workspace.active()).toBe("flow");
    expect(app.flowView.focus.selected()).toBe("main/board>board/toast");

    const codeTab = [
      ...root.querySelectorAll<HTMLElement>('[data-flow="inspector"] [role="tab"]')
    ].find(tab => tab.textContent === "Code");
    app.flowView.focus.select("board/merge");
    act(() => codeTab?.click());
    await until(() => root.querySelector('[data-action="open-files"]') !== null, "the code tab");
    act(() => find('[data-flow="code-tab"] [data-action="open-files"]').click());
    expect(opened).toEqual([{ path: "nodes/merge.ts", line: 1 }]);

    hub.close(SESSION.id, "game_reloaded");
    await until(
      () => root.querySelector('[data-flow="world"]')?.hasAttribute("data-stale") === true,
      "stale"
    );

    await app.stop();
    expect(root.querySelector('[data-flow="world"]')).toBeNull();
  });

  it("the Inspector has two tabs: Info and Code (D-66)", async () => {
    const app = await startOnGame();
    act(() => app.workspace.show("flow"));
    await until(() => app.flowView.focus.select("board/merge"), "the merge node");
    await until(
      () => root.querySelector('[data-flow="inspector"] [role="tab"]') !== null,
      "the Inspector tabs"
    );
    const tabs = [...root.querySelectorAll<HTMLElement>('[data-flow="inspector"] [role="tab"]')];
    expect(tabs.map(tab => tab.textContent)).toEqual(["Info", "Code"]);
    expect(root.querySelector('[data-flow="styles-tab"]')).toBeNull();
    await app.stop();
  });

  it("a text-styles file in the index is never read and the palette offers no Styles item (D-66)", async () => {
    const styles = "features/ui/styles.ts";
    hub.files.set(styles, {
      text: 'export const textStyles = defineTextStyles({\n  "ui.number": { size: 60 }\n});\n',
      version: "v1"
    });
    hub.index.set("textStyle:ui.number", [{ path: styles, line: 2 }]);
    const app = await startOnGame();
    await until(() => hub.fileReads(".moku/editor/layout.json").length > 0, "the session load");

    // An agent edits the text-styles file: the index publishes a new revision.
    const before = revisionOf(app);
    hub.project({ files: [styles], moved: [], removed: [] });
    await until(() => revisionOf(app) !== before, "the project change");

    act(() => app.workspace.palette.open("ui.number"));
    await until(() => root.querySelector('[data-ui="palette"]') !== null, "the palette");
    expect(hub.fileReads(styles)).toEqual([]);
    expect(paletteOption("ui.number")).toBeUndefined();
    await app.stop();
  });

  it("an agent's edit above the node: the Code tab follows the index after link:project", async () => {
    const app = createApp();
    await app.start();
    act(() => app.workspace.mount(root));
    act(() => app.workspace.show("flow"));
    hub.open(SESSION, MANIFEST);
    await untilWatched();
    sendFlowValues();
    await until(() => app.flowView.focus.select("board/merge"), "the merge node");
    const codeTab = [
      ...root.querySelectorAll<HTMLElement>('[data-flow="inspector"] [role="tab"]')
    ].find(tab => tab.textContent === "Code");
    act(() => codeTab?.click());
    await until(
      () => root.querySelector('[data-flow="code-tab"] [data-line="1"][data-highlight]') !== null,
      "the node line"
    );

    hub.files.set("nodes/merge.ts", {
      text: "// a\n// b\n// c\nexport const merge = node({});\n",
      version: "v9"
    });
    hub.index.set("node:board/merge", [{ path: "nodes/merge.ts", line: 4 }]);
    hub.project({ files: ["nodes/merge.ts"], moved: [], removed: [] });
    await until(
      () => root.querySelector('[data-flow="code-tab"] [data-line="4"][data-highlight]') !== null,
      "the moved line"
    );
    expect(hub.received.filter(request => request.method === "find").length).toBeGreaterThan(1);
    await app.stop();
  });

  it("default hub thresholds: settingsPopup/open (5 outcomes) is a card, not a hub", async () => {
    const app = createApp();
    await app.start();
    act(() => app.workspace.mount(root));
    act(() => app.workspace.show("flow"));
    hub.open(SESSION, MANIFEST);
    await until(
      () => hub.watches("game.graph").length > 0 && hub.watches("game.history").length > 0,
      "watches"
    );
    const graph: Json = structuredClone(cloneGraph());
    hub.value(SESSION.id, "game.graph", graph);
    hub.value(SESSION.id, "game.position", {
      path: "board/awaitIntent",
      flow: "board",
      node: "awaitIntent",
      waiting: ["tap", "leave"]
    });
    hub.value(SESSION.id, "game.history", []);
    hub.heartbeat(SESSION.id, 1840, false);
    await until(() => root.querySelector('[data-flow="hub"]') !== null, "the board hub");

    act(() => app.flowView.flows.enter("main/settings"));
    await until(
      () => root.querySelector('[data-key$="settingsPopup/open"]') !== null,
      "the settingsPopup flow"
    );
    expect(find('[data-key$="settingsPopup/open"]').dataset.flow).toBe("node-card");
    expect(root.querySelector('[data-flow="hub"]')).toBeNull();

    await app.stop();
  });
});

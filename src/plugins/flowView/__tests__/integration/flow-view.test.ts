// @vitest-environment happy-dom
// @vitest-environment-options {"url":"http://127.0.0.1:3000/__editor","settings":{"disableIframePageLoading":true}}
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { ToolsEvents } from "../../../../config";
import { createToolsCore, toolsCoreConfig } from "../../../../config";
import { linkPlugin } from "../../../link";
import { panelsPlugin } from "../../../panels";
import type { Json, Manifest, RunResult, SessionInfo, ToolsBoot } from "../../../registry/protocol";
import { workspacePlugin } from "../../../workspace";
import { flowViewPlugin } from "../..";
import { parsePins } from "../../layout/pins";
import { cloneGraph, fixtureText } from "../helpers";
import { pointer } from "../render";
import { createFlowHub, type FlowHub } from "./fake-hub";

// ─────────────────────────────────────────────────────────────────────────────
// The real tools core (link, workspace, panels, flowView) over a scripted hub:
// start → mount Flow → board hub with 8 lanes and You are here → default camera
// → select → drag → layout.json → note → style edit → intents of other views →
// stale → stop.
// ─────────────────────────────────────────────────────────────────────────────

const framework = createToolsCore(toolsCoreConfig, {
  plugins: [linkPlugin, workspacePlugin, panelsPlugin, flowViewPlugin]
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

/** Waits until a check passes (real time; the hub answers on microtasks). */
async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = performance.now() + 4000;
  while (!check()) {
    if (performance.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
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
      flowView: { layoutWorker: false, layoutSaveDelayMs: 0, styleSaveDelayMs: 0 },
      workspace: { reloadTimeoutMs: 50 }
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
  document.body.innerHTML = `<script type="application/json" id="moku-editor-boot">${JSON.stringify(BOOT)}</script>`;
  root = document.createElement("div");
  root.dataset.editorRoot = "";
  document.body.append(root);
  hub.files.set("features/ui/styles.ts", { text: fixtureText("ui-styles.txt"), version: "v1" });
  hub.files.set("nodes/merge.ts", { text: "export const merge = node({});\n", version: "v1" });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("flowView integration", () => {
  it("types the app surface: namespaced api, no events of its own", () => {
    const app = createApp();
    expectTypeOf(app.flowView.camera.fitAll).toEqualTypeOf<() => void>();
    expectTypeOf(app.flowView.focus.select).parameter(0).toEqualTypeOf<string | undefined>();
    expectTypeOf(app.flowView.focus.select).returns.toEqualTypeOf<boolean>();
    expectTypeOf(app.flowView.focus.step).returns.toEqualTypeOf<Promise<RunResult | undefined>>();
    expect(app.panels.list().map(panel => panel.id)).toEqual(["flow"]);
    expect(Object.keys(app.flowView).toSorted()).toEqual([
      "camera",
      "flows",
      "focus",
      "layout",
      "notes"
    ]);
    expect(Object.keys(app.flowView.camera).toSorted()).toEqual([
      "fitAll",
      "fitSelection",
      "follow",
      "get",
      "zoomBy",
      "zoomTo"
    ]);
  });

  it("start → board hub → select → drag → note → style edit → intents → stale → stop", async () => {
    const app = createApp();
    await app.start();
    act(() => app.workspace.mount(root));
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
    expect(root.querySelectorAll('[data-flow="lane"]')).toHaveLength(8);
    expect(find('[data-flow="hub"]').dataset.current).toBe("");
    expect(find('[data-flow="hub"]').textContent).toContain("You are here");
    await until(() => app.flowView.camera.get().z >= 0.8, "the default camera");
    expect(app.flowView.focus.current()).toBe("board/awaitIntent");

    expect(app.flowView.focus.select("board/merge")).toBe(true);
    await until(() => root.querySelector('[data-flow="neighbours-strip"]') !== null, "the strip");
    const comes = find('[data-flow="neighbours-strip"] [data-column="from"]');
    expect(comes.textContent).toContain("board/awaitIntent");

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

    const note = await app.flowView.notes.create({
      title: "First wood 4",
      body: "Show a popup.",
      from: { node: "board/merge", outcome: "done" }
    });
    const written = hub.files.get(note.path)?.text ?? "";
    expect(note.path).toMatch(/^\.moku\/notes\/\d{4}-\d{2}-\d{2}-first-wood-4\.md$/);
    expect(written).toContain("title: First wood 4");
    expect(written).toContain("from:\n  node: board/merge\n  outcome: done");
    expect(written).toContain("to: board/awaitIntent");
    expect(written).toContain("status: idea");

    const styles = [
      ...root.querySelectorAll<HTMLElement>('[data-flow="inspector"] [role="tab"]')
    ].find(tab => tab.textContent === "Styles");
    act(() => styles?.click());
    await until(
      () => root.querySelector('[data-flow="styles-tab"] select') !== null,
      "the styles tab"
    );
    const select = find('[data-flow="styles-tab"] select') as HTMLSelectElement;
    act(() => {
      select.value = "ui.number";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await until(
      () => root.querySelector('[data-field="size"] [data-action="step-up"]') !== null,
      "the size stepper"
    );
    act(() => find('[data-field="size"] [data-action="step-up"]').click());
    await until(() => hub.writes("features/ui/styles.ts").length === 1, "the style write");
    const before = fixtureText("ui-styles.txt").split("\n");
    const after = (hub.files.get("features/ui/styles.ts")?.text ?? "").split("\n");
    expect(before.filter((line, index) => line !== after[index])).toEqual(["    size: 60,"]);
    await until(
      () =>
        root.querySelector('[data-flow="styles-tab"]')?.textContent?.includes("game reloaded") ===
        true,
      "the reload"
    );

    act(() => emits[0]?.emit("workspace:select-node", { id: "board/toast" }));
    expect(app.workspace.active()).toBe("flow");
    expect(app.flowView.focus.selected()).toBe("main/board>board/toast");

    act(() =>
      emits[0]?.emit("workspace:new-note", {
        captures: [".moku/captures/2026-09-24-1012-board.png"]
      })
    );
    await until(() => root.querySelector('[data-flow="note-editor"]') !== null, "the note editor");
    expect(find('[data-flow="note-editor"]').textContent).toContain(
      "The screenshot attaches to this note"
    );

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

  it("default hub thresholds: settingsPopup/open (5 outcomes) is a card, not a hub", async () => {
    const app = createApp();
    await app.start();
    act(() => app.workspace.mount(root));
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

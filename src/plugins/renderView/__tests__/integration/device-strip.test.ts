// @vitest-environment happy-dom
// @vitest-environment-options {"url":"http://127.0.0.1:3000/__editor","settings":{"navigation":{"disableChildFrameNavigation":true}}}
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createToolsCore, toolsCoreConfig } from "../../../../config";
import { linkPlugin } from "../../../link";
import { panelsPlugin } from "../../../panels";
import type { Json, Manifest, SessionInfo, ToolsBoot } from "../../../registry/protocol";
import { encode, notification, toWireValue } from "../../../registry/protocol";
import { workspacePlugin } from "../../../workspace";
import { renderViewPlugin } from "../..";
import {
  COMPUTER_ENGINE,
  DEVICE,
  recorderOf,
  recordOf,
  secondOf,
  spikesOf,
  windowWire,
  wireJson
} from "../device-fixtures";
import { ASSETS, boardCapture, RENDER } from "../helpers";
import { type AgentHub, createAgentHub, createScriptedChannel } from "./agent-hub";

// ─────────────────────────────────────────────────────────────────────────────
// The real tools app (link, workspace, panels, renderView) over the agent hub:
// a phone's device session whose agent serves editor.perf.* and editor.recorder
// in the 11-monitor shapes, the hub's editor.engine, then a browser session
// with perf, then a session without perf, then stop.
// ─────────────────────────────────────────────────────────────────────────────

const framework = createToolsCore(toolsCoreConfig, {
  plugins: [linkPlugin, workspacePlugin, panelsPlugin, renderViewPlugin]
});

const BOOT: ToolsBoot = {
  v: 1,
  ws: "ws://127.0.0.1:47600/__editor/ws",
  token: "tok-1",
  path: "/__editor",
  title: "moku editor",
  editorUrl: "vscode://file/{path}:{line}",
  root: "/work/garden",
  gameUrl: "/game.html"
};

/** The scene and tracker sources every game page lists. */
const GAME_SOURCES = [
  "game.render",
  "game.assets",
  "game.ui",
  "game.entities",
  "game.projections",
  "game.rect"
];

/** The sources of an agent with perf and the recorder. */
const PERF_SOURCES = [
  "editor.perf.second",
  "editor.perf.window",
  "editor.perf.spikes",
  "editor.perf.spike",
  "editor.recorder"
];

/** The watched device sources. */
const DEVICE_WATCHES = [
  "editor.perf.second",
  "editor.perf.spikes",
  "editor.perf.window",
  "editor.recorder"
];

/** The scene sources. */
const SCENE = ["game.entities", "game.projections", "game.ui"];

/**
 * A manifest listing sources.
 *
 * @param sources - The source ids.
 * @returns The manifest.
 */
function manifestOf(sources: readonly string[]): Manifest {
  return {
    game: "garden 0.3.0",
    page: "http://127.0.0.1:3000/game.html",
    embedded: false,
    sources: sources.map(id => ({ id, title: id, input: {}, changes: "frame" as const })),
    commands: []
  };
}

/**
 * A session of the hub.
 *
 * @param id - The id.
 * @param connectedAt - Epoch ms: the newest session is chosen.
 * @param device - The phone; none for a browser session.
 * @returns The session.
 */
function sessionOf(id: string, connectedAt: number, device?: typeof DEVICE): SessionInfo {
  const session = {
    id,
    game: "garden 0.3.0",
    page: "http://127.0.0.1:3000/game.html",
    embedded: false,
    connectedAt
  };
  return device === undefined ? session : { ...session, device };
}

let hub: AgentHub;
let root: HTMLElement;
let intervals: Set<unknown>;
let canvasContext: PropertyDescriptor | undefined;

/**
 * Waits until the check passes (real time; the hub answers on microtasks).
 *
 * @param check - The condition.
 * @param label - What is awaited.
 */
async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = performance.now() + 10_000;
  while (!check()) {
    if (performance.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
    });
  }
}

/**
 * The source ids the agent watches now, sorted.
 *
 * @returns The ids.
 */
function watched(): string[] {
  return [...hub.agentWatches.values()].map(entry => entry.id).toSorted();
}

/**
 * The first element of a selector in the page.
 *
 * @param selector - The selector.
 * @returns The element, or null.
 */
function q(selector: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(selector);
}

/**
 * A 2D context that accepts every call: happy-dom has no canvas.
 *
 * @returns The context.
 */
function nullContext(): object {
  return new Proxy(
    { measureText: () => ({ width: 10 }) },
    {
      get: (target, key) => (key in target ? Reflect.get(target, key) : () => {}),
      set: () => true
    }
  );
}

beforeEach(() => {
  const capture = boardCapture();
  const values: Record<string, Json> = {
    "game.render": RENDER,
    "game.assets": ASSETS,
    "game.ui": capture.ui,
    "game.entities": capture.entities,
    "game.projections": capture.projections,
    "editor.perf.second": toWireValue(secondOf()),
    "editor.perf.window": wireJson(windowWire()),
    "editor.perf.spikes": toWireValue(spikesOf()),
    "editor.perf.spike": toWireValue(recordOf({ frame: 4572, cause: "js", causes: ["js"] })),
    "editor.recorder": toWireValue(recorderOf())
  };
  const agent = createScriptedChannel(values, capture.rects);
  hub = createAgentHub({ channel: agent.channel, files: new Map() });
  vi.stubGlobal("WebSocket", hub.Socket);
  canvasContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "getContext");
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => nullContext()
  });
  intervals = new Set();
  const realSet = globalThis.setInterval;
  const realClear = globalThis.clearInterval;
  vi.stubGlobal("setInterval", (handler: () => void, ms?: number) => {
    const id = realSet(handler, ms);
    intervals.add(id);
    return id;
  });
  vi.stubGlobal("clearInterval", (id: ReturnType<typeof setInterval> | undefined) => {
    intervals.delete(id);
    realClear(id);
  });
  localStorage.clear();
  document.body.innerHTML = `<script type="application/json" id="moku-editor-boot">${JSON.stringify(BOOT)}</script>`;
  root = document.createElement("div");
  root.dataset.editorRoot = "";
  document.body.append(root);
});

afterEach(() => {
  if (canvasContext === undefined)
    Reflect.deleteProperty(HTMLCanvasElement.prototype, "getContext");
  else Object.defineProperty(HTMLCanvasElement.prototype, "getContext", canvasContext);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("renderView integration · the D1 device strip", () => {
  it("phone → strip with STALE and a record → browser session → no perf → stop", {
    timeout: 20_000
  }, async () => {
    const app = framework.createApp({});
    app.log.clearSinks();
    await app.start();
    act(() => app.workspace.mount(root));
    for (const socket of hub.sockets) {
      socket.deliver(
        encode(
          notification("editor", "engine", {
            id: COMPUTER_ENGINE,
            version: "0.14.13",
            dist: "1ab7f2c0"
          })
        )
      );
    }
    hub.open(sessionOf("s-1", 1000, DEVICE), manifestOf([...GAME_SOURCES, ...PERF_SOURCES]));
    hub.heartbeat("s-1", 4845, false);
    await until(
      () => app.link.manifest() !== undefined && app.link.engine() !== undefined,
      "attach"
    );

    // Render shown on the phone: the strip, no scene source watched (R4).
    act(() => app.workspace.show("render"));
    await until(() => app.renderView.device()?.perf === "live", "the first perf value");
    await until(() => watched().includes("editor.recorder"), "the device watches");
    expect(watched()).toEqual(["game.assets", "game.render", ...DEVICE_WATCHES].toSorted());
    expect(app.renderView.device()?.engine).toEqual({
      device: "0.14.12+9c41e0",
      computer: COMPUTER_ENGINE,
      stale: true
    });
    await until(
      () => q("[data-part='model-name']")?.textContent === "SM-A266B",
      "the strip renders"
    );
    expect(q("[data-cell='engine']")?.textContent).toContain("STALE");
    expect(q("[data-part='headline']")?.textContent).toContain("drawn / loop 54 / 60 @60 fps");

    // Next opens the oldest spike's record through editor.perf.spike.
    expect(app.renderView.stepSpike(1)).toBe(4572);
    await until(() => app.renderView.device()?.record === "shown", "the record");
    expect(
      hub.received.some(
        request =>
          request.method === "read" && JSON.stringify(request.params).includes("editor.perf.spike")
      )
    ).toBe(true);
    await until(
      () => q("[data-part='record-id'] b")?.textContent === "Frame 4572",
      "the record panel"
    );
    app.renderView.closeSpike();
    await until(() => q("[data-part='empty']") !== null, "the empty state");

    // The session chip switches to the game page in the editor's frame, whose agent has perf too.
    hub.open(sessionOf("s-2", 2000), manifestOf([...GAME_SOURCES, ...PERF_SOURCES]));
    await until(() => app.link.sessions().length === 2, "the second session");
    await app.link.choose("s-2");
    hub.heartbeat("s-2", 10, false);
    await until(() => app.renderView.device()?.session === "s-2", "the browser session's strip");
    expect(app.renderView.device()?.link).toEqual({ kind: "browser" });
    await until(() => SCENE.every(id => watched().includes(id)), "the scene watches");
    expect(watched().filter(id => id.startsWith("editor."))).toEqual(DEVICE_WATCHES);
    await until(
      () => q("[data-cell='link']")?.textContent?.includes("BROWSER") ?? false,
      "BROWSER"
    );

    // A session whose manifest lists no editor.perf.second: no strip, every perf watch dropped.
    hub.open(sessionOf("s-3", 3000), manifestOf(GAME_SOURCES));
    await until(() => app.link.sessions().length === 3, "the third session");
    await app.link.choose("s-3");
    hub.heartbeat("s-3", 10, false);
    await until(() => app.renderView.device() === undefined, "no strip");
    await until(() => !watched().some(id => id.startsWith("editor.")), "the perf watches dropped");
    expect(q("[data-render='device-strip']")).toBeNull();
    expect(hub.unwatched).toEqual(
      expect.arrayContaining(["editor.perf.second", "editor.perf.window"])
    );

    await app.stop();
    expect(intervals.size).toBe(0);
  });
});

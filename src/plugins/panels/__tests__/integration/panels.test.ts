// @vitest-environment happy-dom
// @vitest-environment-options {"url":"http://127.0.0.1:3000/__editor","settings":{"disableIframePageLoading":true}}
/* eslint-disable unicorn/no-null -- null is a JSON value and Preact's "no props" */
import { h } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { createToolsCore, toolsCoreConfig } from "../../../../config";
import { linkPlugin } from "../../../link";
import type { Json, Manifest, SessionInfo, ToolsBoot } from "../../../registry/protocol";
import { encode, notification } from "../../../registry/protocol";
import { workspacePlugin } from "../../../workspace";
import {
  createScriptedHub,
  type ScriptedHub
} from "../../../workspace/__tests__/integration/fake-hub";
import type { RanEvent, WorkspaceId } from "../../../workspace/types";
import { panelsPlugin } from "../..";
import { definePanel } from "../../define";

// ─────────────────────────────────────────────────────────────────────────────
// A tools core with the real link, workspace and panels over the scripted hub
// of the workspace tests, plus a test plugin that registers two panels in its
// onInit and hooks workspace:ran: start → mount → values → tools.run → stale →
// lazy mount → stop.
// ─────────────────────────────────────────────────────────────────────────────

const framework = createToolsCore(toolsCoreConfig, {
  plugins: [linkPlugin, workspacePlugin, panelsPlugin]
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
    { id: "game.position", title: "Position", input: {}, changes: "edge" },
    { id: "game.model", title: "Model", input: {}, changes: "commit" }
  ],
  commands: [{ id: "game.step", title: "Step", input: { frames: "number" }, effect: "raw" }]
};

const flowPanel = definePanel({
  id: "flow",
  title: "Flow",
  workspace: "flow",
  sources: { position: "game.position" },
  commands: { step: "game.step" },
  view: ({ position }, { run }) =>
    h(
      "div",
      null,
      h("p", { "data-test": "path" }, position.path),
      h(
        "button",
        {
          type: "button",
          onClick: () => {
            run.step({ frames: 1 }).catch(() => undefined);
          }
        },
        "Step"
      )
    )
});

const statePanel = definePanel({
  id: "state",
  title: "State",
  workspace: "state",
  sources: { model: "game.model" },
  view: ({ model }) => h("p", { "data-test": "model" }, JSON.stringify(model.player))
});

let hub: ScriptedHub;
let ran: RanEvent[];
let root: HTMLElement;

/**
 * Waits until the check passes (real time; the scripted hub answers on microtasks).
 *
 * @param check - The condition.
 * @param label - What is awaited.
 */
async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = performance.now() + 3000;
  while (!check()) {
    if (performance.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
    });
  }
}

/**
 * The params object of a request.
 *
 * @param params - Request params.
 * @returns The params as an object.
 */
function objectOf(params: Json | undefined): { readonly [key: string]: Json } {
  return typeof params === "object" && params !== null && !Array.isArray(params) ? params : {};
}

/**
 * The wire subs of every watch request, optionally of one source id.
 *
 * @param id - Source id.
 * @returns The subs.
 */
function watchSubs(id?: string): number[] {
  return hub.received
    .filter(request => request.method === "watch")
    .map(request => objectOf(request.params))
    .filter(params => id === undefined || params.id === id)
    .map(params => Number(params.sub));
}

/**
 * The wire subs of every unwatch request.
 *
 * @returns The subs.
 */
function unwatchSubs(): number[] {
  return hub.received
    .filter(request => request.method === "unwatch")
    .map(request => Number(objectOf(request.params).sub));
}

/**
 * Sends a `value` of the session to the last watch of a source id.
 *
 * @param id - Source id.
 * @param value - The value.
 */
function sendValue(id: string, value: Json): void {
  const sub = watchSubs(id).at(-1) ?? -1;
  for (const socket of hub.sockets) {
    socket.deliver(encode(notification("game", "value", { sub, value }, SESSION.id)));
  }
}

/**
 * The tools app with a test plugin that registers both panels and records workspace:ran.
 *
 * @returns The app.
 */
function createApp() {
  const views = framework.createPlugin("testViews", {
    depends: [panelsPlugin],
    onInit: ctx => {
      const panels = ctx.require(panelsPlugin);
      expectTypeOf(panels.register).parameter(0).toHaveProperty("view");
      panels.register(flowPanel);
      panels.register(statePanel);
    },
    hooks: () => ({
      "workspace:ran": (payload: RanEvent) => {
        ran.push(payload);
      }
    })
  });
  // Flow opens first, so its panel mounts at start (the editor's default is Game).
  const app = framework.createApp({
    plugins: [views],
    pluginConfigs: { workspace: { defaultWorkspace: "flow" } }
  });
  app.log.clearSinks();
  return app;
}

/**
 * The section of a panel.
 *
 * @param id - Panel id.
 * @returns The section, or null.
 */
function sectionOf(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`section[data-panel='${id}']`);
}

beforeEach(() => {
  hub = createScriptedHub();
  vi.stubGlobal("WebSocket", hub.Socket);
  localStorage.clear();
  document.body.innerHTML = `<script type="application/json" id="moku-editor-boot">${JSON.stringify(BOOT)}</script>`;
  root = document.createElement("div");
  root.dataset.editorRoot = "";
  document.body.append(root);
  ran = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("panels integration", () => {
  it("types the app surface and lists the registered panels", () => {
    const app = createApp();
    expectTypeOf(app.panels.mountInto).toEqualTypeOf<
      (ws: WorkspaceId, element: HTMLElement) => () => void
    >();
    expect(app.panels.list().map(panel => panel.id)).toEqual(["flow", "state"]);
  });

  it("no-game before a session; values render the view; tools.run reaches the hub; lost marks stale", async () => {
    const app = createApp();
    await app.start();
    act(() => app.workspace.mount(root));
    expect(root.contains(sectionOf("flow"))).toBe(true);
    expect(sectionOf("flow")?.dataset.panelState).toBe("no-game");
    expect(sectionOf("state")).toBeNull();

    hub.open(SESSION, MANIFEST);
    await until(() => watchSubs("game.position").length === 1, "watch sent");
    sendValue("game.position", { path: "home", flow: "main", node: "home", waiting: ["play"] });
    await until(() => sectionOf("flow")?.dataset.panelState === "ready", "ready");
    expect(sectionOf("flow")?.querySelector("[data-test='path']")?.textContent).toBe("home");

    act(() => sectionOf("flow")?.querySelector("button")?.click());
    await until(() => ran.length === 1, "workspace:ran");
    expect(hub.runs("game.step")).toHaveLength(1);
    expect(ran[0]).toMatchObject({
      id: "game.step",
      input: { frames: 1 },
      origin: "panel",
      ok: true
    });

    hub.heartbeat(SESSION.id, 1840, false);
    await until(() => app.link.status().kind === "live", "live");
    hub.close(SESSION.id, "game_reloaded");
    await until(() => sectionOf("flow")?.dataset.stale === "lost", "stale lost");
    await app.stop();
  });

  it("show(state) mounts the second workspace lazily; stop() unwatches every watch", async () => {
    const app = createApp();
    await app.start();
    act(() => app.workspace.mount(root));
    hub.open(SESSION, MANIFEST);
    await until(() => watchSubs("game.position").length === 1, "flow watch");

    act(() => app.workspace.show("state"));
    expect(sectionOf("state")).not.toBeNull();
    await until(() => watchSubs("game.model").length === 1, "state watch");
    sendValue("game.model", { player: { coins: 4 }, session: {}, rng: { seed: 1, streams: {} } });
    await until(() => sectionOf("state")?.dataset.panelState === "ready", "state ready");
    expect(sectionOf("state")?.textContent).toBe('{"coins":4}');

    await app.stop();
    expect(sectionOf("flow")).toBeNull();
    expect(unwatchSubs().toSorted()).toEqual(watchSubs().toSorted());
  });
});

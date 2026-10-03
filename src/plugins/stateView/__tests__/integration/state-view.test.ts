// @vitest-environment happy-dom
// @vitest-environment-options {"url":"http://127.0.0.1:3000/__editor","settings":{"disableIframePageLoading":true}}
import { readFileSync } from "node:fs";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createToolsCore, toolsCoreConfig } from "../../../../config";
import { linkPlugin } from "../../../link";
import { panelsPlugin } from "../../../panels";
import type { SessionInfo, ToolsBoot } from "../../../registry/protocol";
import { workspacePlugin } from "../../../workspace";
import { stateViewPlugin } from "../..";
import { GRAPH, HISTORY, MANIFEST, MODEL_AFTER, MODEL_BEFORE, POSITION } from "../fixtures";
import { createTestHub, type TestHub } from "./hub";

// ─────────────────────────────────────────────────────────────────────────────
// A tools core with the real link, workspace, panels and stateView over an
// in-process hub: the game side answers game.model, game.tainted, game.graph,
// game.position and game.history from a value map.
// ─────────────────────────────────────────────────────────────────────────────

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

const framework = createToolsCore(toolsCoreConfig, {
  plugins: [linkPlugin, workspacePlugin, panelsPlugin, stateViewPlugin]
});

let hub: TestHub;

/**
 * Starts the app and opens the merge-game session; resolves once both tracker watches reached the hub.
 *
 * @returns The started app.
 */
async function startConnected() {
  const app = framework.createApp();
  await app.start();
  hub.open(SESSION, MANIFEST);
  await vi.waitFor(() => {
    expect(hub.watchedIds("watch")).toEqual(expect.arrayContaining(["game.model", "game.tainted"]));
  });
  return app;
}

beforeEach(() => {
  hub = createTestHub();
  hub.values.set("game.model", MODEL_BEFORE);
  hub.values.set("game.tainted", false);
  hub.values.set("game.graph", GRAPH);
  hub.values.set("game.position", POSITION);
  hub.values.set("game.history", HISTORY);
  vi.stubGlobal("WebSocket", hub.Socket);
  localStorage.clear();
  document.body.innerHTML = `<script type="application/json" id="moku-editor-boot">${JSON.stringify(BOOT)}</script>`;
  const root = document.createElement("div");
  root.dataset.editorRoot = "";
  document.body.append(root);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("stateView integration", () => {
  it("wires createToolsPlugin without generics, depends on link and panels, registers the State panel", () => {
    const source = readFileSync(`${process.cwd()}/src/plugins/stateView/index.ts`, "utf8");
    expect(source).toMatch(/createToolsPlugin\("stateView", \{/);
    expect(source).not.toMatch(/createToolsPlugin</);
    expect(source).toMatch(/depends: \[linkPlugin, panelsPlugin]/);
    const app = framework.createApp();
    expect(app.panels.list().map(panel => panel.id)).toContain("state");
    expect(app.stateView.note()).toBe("none");
  });

  it("derives the commit at f1503, takes the taint from its watch and resets on a reload", async () => {
    const app = await startConnected();
    await vi.waitFor(() => expect(app.stateView.note()).toBe("waiting"));
    await vi.waitFor(() => expect(app.stateView.graph()).toEqual(GRAPH));
    expect(app.stateView.tainted()).toBe(false);
    expect(app.stateView.lastCommit()).toBeUndefined();

    hub.heartbeat(1503);
    await vi.waitFor(() => expect(app.link.status()).toEqual({ kind: "live", frame: 1503 }));
    hub.push("game.model", MODEL_AFTER);
    await vi.waitFor(() => expect(app.stateView.lastCommit()?.patches).toHaveLength(4));
    expect(app.stateView.lastCommit()?.frame).toBe(1503);

    hub.push("game.tainted", true);
    await vi.waitFor(() => expect(app.stateView.tainted()).toBe(true));

    expect(hub.requests("read").map(request => JSON.stringify(request.params))).toEqual([
      JSON.stringify({ id: "game.graph" })
    ]);

    hub.close("s-1", "game_reloaded");
    await vi.waitFor(() => expect(app.stateView.note()).toBe("reloaded"));
    expect(app.stateView.lastCommit()).toBeUndefined();
    await app.stop();
  });

  it("renders the State workspace from its panel sources", async () => {
    const app = await startConnected();
    hub.heartbeat(1503);
    await vi.waitFor(() => expect(app.stateView.note()).toBe("waiting"));
    hub.push("game.model", MODEL_AFTER);
    await vi.waitFor(() => expect(app.stateView.lastCommit()?.seq).toBe(1));
    const root = document.querySelector<HTMLElement>("[data-editor-root]");
    if (root === null) throw new Error("no editor root");
    act(() => app.workspace.mount(root));
    act(() => app.workspace.show("state"));
    await vi.waitFor(() => {
      expect(
        document.querySelector("[data-panel='state'] [data-part='title']")?.textContent
      ).toContain("last commit ~f1503");
    });
    expect(
      document.querySelectorAll("[data-panel='state'] [data-part='patches'] > li")
    ).toHaveLength(4);
    expect(
      document.querySelector("[data-panel='state'] [data-part='runner-card']")?.textContent
    ).toContain("main/board › board/awaitIntent");
    await app.stop();
  });

  it("stop sends an unwatch for each tracker watch", async () => {
    const app = await startConnected();
    await vi.waitFor(() => expect(app.stateView.note()).toBe("waiting"));
    await app.stop();
    const unwatched = hub.watchedIds("unwatch");
    expect(unwatched.filter(id => id === "game.model")).toHaveLength(
      hub.watchedIds("watch").filter(id => id === "game.model").length
    );
    expect(unwatched).toContain("game.tainted");
  });
});

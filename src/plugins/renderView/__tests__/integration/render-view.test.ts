// @vitest-environment happy-dom
// @vitest-environment-options {"url":"http://127.0.0.1:3000/__editor","settings":{"disableIframePageLoading":true}}
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { createToolsCore, type ToolsEvents, toolsCoreConfig } from "../../../../config";
import { linkPlugin } from "../../../link";
import { panelsPlugin } from "../../../panels";
import type { ElementRef } from "../../../panels/shared/scene";
import type { Manifest, SessionInfo, ToolsBoot } from "../../../registry/protocol";
import { workspacePlugin } from "../../../workspace";
import { renderViewPlugin } from "../..";
import type { RenderSnapshot, TextureSortKey } from "../../types";
import { ASSETS, boardCapture, EFFECTS, MANIFEST_TEXT, RENDER } from "../helpers";
import {
  type AgentHub,
  createAgentHub,
  createScriptedChannel,
  type ScriptedChannel
} from "./agent-hub";

// ─────────────────────────────────────────────────────────────────────────────
// The tools core with the real link, workspace, panels and renderView over an
// in-process hub to a scripted agent channel serving the merge-game board
// capture, plus a probe plugin (no depends) that emits workspace:reveal and
// hooks workspace:inspect. No gameView plugin.
// ─────────────────────────────────────────────────────────────────────────────

const framework = createToolsCore(toolsCoreConfig, {
  plugins: [linkPlugin, workspacePlugin, panelsPlugin, renderViewPlugin]
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

const SOURCES = [
  "game.render",
  "game.assets",
  "game.effects",
  "game.ui",
  "game.entities",
  "game.projections",
  "game.rect"
];

const MANIFEST: Manifest = {
  game: "merge-game 0.0.0",
  page: "http://127.0.0.1:3000/game.html",
  embedded: true,
  sources: SOURCES.map(id => ({ id, title: id, input: {}, changes: "frame" as const })),
  commands: []
};

const CELL: ElementRef = { kind: "entity", id: 3_145_728 };

let hub: AgentHub;
let agent: ScriptedChannel;
let root: HTMLElement;
let inspected: ElementRef[];

async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = performance.now() + 3000;
  while (!check()) {
    if (performance.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
    });
  }
}

function watched(): string[] {
  return [...hub.agentWatches.values()].map(entry => entry.id).toSorted();
}

function createApp() {
  const probe = framework.createPlugin("probe", {
    api: ctx => ({
      reveal: (ref: ElementRef) => {
        ctx.emit("workspace:reveal", { ref });
        // R9: workspace:inspect is a global event: no depends needed; a wrong payload is refused.
        expectTypeOf(ctx.emit).toBeCallableWith("workspace:inspect", { ref });
        // @ts-expect-error — the ref must be an ElementRef
        expectTypeOf(ctx.emit).toBeCallableWith("workspace:inspect", { ref: "board.cell" });
      }
    }),
    hooks: () => ({
      "workspace:inspect": (payload: ToolsEvents["workspace:inspect"]) => {
        inspected.push(payload.ref);
      }
    })
  });
  const app = framework.createApp({ plugins: [probe] });
  app.log.clearSinks();
  return app;
}

beforeEach(() => {
  const capture = boardCapture();
  agent = createScriptedChannel(
    {
      "game.render": RENDER,
      "game.assets": ASSETS,
      "game.effects": EFFECTS,
      "game.ui": capture.ui,
      "game.entities": capture.entities,
      "game.projections": capture.projections
    },
    capture.rects
  );
  hub = createAgentHub({
    channel: agent.channel,
    files: new Map([["manifest.json", MANIFEST_TEXT]])
  });
  vi.stubGlobal("WebSocket", hub.Socket);
  localStorage.clear();
  document.body.innerHTML = `<script type="application/json" id="moku-editor-boot">${JSON.stringify(BOOT)}</script>`;
  root = document.createElement("div");
  root.dataset.editorRoot = "";
  document.body.append(root);
  inspected = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("renderView integration", () => {
  it("types the app surface", () => {
    const app = createApp();

    expectTypeOf(app.renderView.snapshot).returns.toEqualTypeOf<RenderSnapshot>();
    expectTypeOf(app.renderView.sortTextures).parameter(0).toEqualTypeOf<TextureSortKey>();
    expectTypeOf<ToolsEvents["workspace:reveal"]>().toEqualTypeOf<{ ref: ElementRef }>();
    // @ts-expect-error — not a sort key
    expect(() => app.renderView.sortTextures("nope")).not.toThrow();
    expect(app.panels.list().map(panel => panel.id)).toEqual(["render"]);
  });

  it("createApp → start → show Render → snapshot, reveal, inspect → leave → stop", async () => {
    const app = createApp();
    await app.start();
    act(() => app.workspace.mount(root));
    hub.open(SESSION, MANIFEST);
    hub.heartbeat(SESSION.id, 1841, false);

    // The tracker watches for the session; the scene only while Render is shown.
    await until(() => watched().length === 3, "tracker watches");
    expect(watched()).toEqual(["game.assets", "game.effects", "game.render"]);
    await until(() => app.renderView.snapshot().tiles.fps !== undefined, "game.render value");

    act(() => app.workspace.show("render"));
    await until(() => app.renderView.snapshot().tree.length > 0, "scene");
    await until(() => app.renderView.snapshot().textures.length === 3, "texture rows");
    expect(watched()).toEqual([
      "game.assets",
      "game.effects",
      "game.entities",
      "game.projections",
      "game.render",
      "game.ui"
    ]);

    const snapshot = app.renderView.snapshot();
    expect(snapshot.frame).toBe(1841);
    expect(snapshot.tiles.drawCalls).toEqual({ kind: "absent" });
    expect(snapshot.tiles.scene).toEqual({
      entities: 104,
      views: 180,
      pooled: 24,
      effects: { particles: 18, emitters: 1, filters: 24, renderPasses: 49 }
    });
    expect(root.querySelector("[data-tile='scene'] [data-note]")?.textContent).toBe(
      "18 particles · 1 emitters · 24 filters"
    );

    // One pushed game.effects value reaches the Scene tile.
    agent.set("game.effects", { particles: 30, emitters: 2, filters: 24, renderPasses: 51 });
    await until(
      () => app.renderView.snapshot().tiles.scene?.effects?.particles === 30,
      "pushed effects"
    );
    expect(snapshot.textures.map(row => [row.key, row.use.kind])).toEqual([
      ["ui.hud-pill", "in-use"],
      ["board.board-tray", "in-use"],
      ["board.cell", "in-use"]
    ]);
    expect(snapshot.tree.map(row => row.id)).toContain("ui:boardScreen/boardSlot");

    // gameView's "Show in render tree" (emitted here by the probe) selects the row.
    act(() => app.probe.reveal(CELL));
    await until(
      () => root.querySelector("[role='treeitem'][data-id='entity:3145728']") !== null,
      "row"
    );
    expect(
      root
        .querySelector("[role='treeitem'][data-id='entity:3145728']")
        ?.getAttribute("aria-selected")
    ).toBe("true");
    expect(app.renderView.snapshot().tree.find(row => row.id === "entity:3145728")?.depth).toBe(2);

    // C9 "Inspect in Game" emits workspace:inspect with the same ref (R9).
    act(() => root.querySelector<HTMLButtonElement>("[data-action='inspect']")?.click());
    expect(inspected).toEqual([CELL]);

    // Hover rings the board slot in the game frame's overlay.
    app.renderView.highlight({ kind: "ui", path: "boardScreen/boardSlot" });
    const box = app.workspace
      .gameFrame()
      .overlay()
      .querySelector<HTMLElement>("[data-render='box'] [data-box]");
    expect(box?.style.width).toBe("970px");

    // Sort and filter, as the API examples say.
    app.renderView.sortTextures("key");
    expect(app.renderView.snapshot().textures.map(row => row.key)).toEqual([
      "board.board-tray",
      "board.cell",
      "ui.hud-pill"
    ]);
    app.renderView.filterBundle("ui");
    expect(app.renderView.snapshot().textures.every(row => row.bundle === "ui")).toBe(true);
    await app.renderView.refresh();
    app.renderView.filterBundle("all");
    expect(app.renderView.snapshot().textures).toHaveLength(3);

    // Leaving Render drops the three scene watches; the tracker stays.
    act(() => app.workspace.show("flow"));
    await until(() => hub.unwatched.length === 3, "three unwatch");
    expect(hub.unwatched.toSorted()).toEqual(["game.entities", "game.projections", "game.ui"]);
    expect(watched()).toEqual(["game.assets", "game.effects", "game.render"]);

    // A bundle that leaves game.assets enters the release log.
    agent.set("game.assets", {
      textureMb: 4,
      budgetMb: 192,
      bundles: [{ name: "board", tier: "scene", mb: 4, lastUsed: 12 }]
    });
    await until(() => app.renderView.snapshot().releases.length === 1, "release");
    expect(app.renderView.snapshot().releases).toEqual([
      { frame: 1841, bundle: "ui", tier: "core", mb: 2 }
    ]);

    await app.stop();
    expect(watched()).toEqual([]);
  });

  it("a game older than 0.0.3 (no game.effects in the manifest) gets no effects watch", async () => {
    const app = createApp();
    await app.start();
    act(() => app.workspace.mount(root));
    const older: Manifest = {
      ...MANIFEST,
      sources: MANIFEST.sources.filter(source => source.id !== "game.effects")
    };
    hub.open(SESSION, older);
    hub.heartbeat(SESSION.id, 1841, false);

    await until(() => app.renderView.snapshot().tiles.fps !== undefined, "game.render value");
    act(() => app.workspace.show("render"));
    await until(() => app.renderView.snapshot().tiles.scene !== undefined, "scene tile");

    expect(agent.watch.mock.calls.map(call => call[0])).not.toContain("game.effects");
    expect(app.renderView.snapshot().tiles.scene).not.toHaveProperty("effects");
    expect(root.querySelector("[data-tile='scene'] [data-note]")?.textContent).toBe(
      "Particles and filters are not reported (follow-up F-R1)"
    );

    await app.stop();
    expect(watched()).toEqual([]);
  });
});

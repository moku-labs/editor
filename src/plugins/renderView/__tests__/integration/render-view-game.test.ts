import { Window } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  startTinyScreenGame,
  TINY_SCREEN_MANIFEST,
  TINY_SCREEN_NAME,
  type TinyScreenGame
} from "../../../../../tests/fixtures/tiny-screen-game";
import {
  agentCoreConfig,
  createAgentCore,
  createToolsCore,
  toolsCoreConfig
} from "../../../../config";
import { channelPlugin } from "../../../channel";
import { linkPlugin } from "../../../link";
import { panelsPlugin } from "../../../panels";
import { registryPlugin } from "../../../registry";
import type { Manifest, SessionInfo, ToolsBoot } from "../../../registry/protocol";
import { workspacePlugin } from "../../../workspace";
import { renderViewPlugin } from "../..";
import { type AgentHub, createAgentHub } from "./agent-hub";

// ─────────────────────────────────────────────────────────────────────────────
// The real chain: tools link → in-process hub → agent registry + channel on the
// tiny screen game (inert renderer, bundles loaded through the stand-in io),
// walked onto the board. The asset manifest is the game's own, served by the
// in-memory files store.
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
  game: TINY_SCREEN_NAME,
  page: BOOT.gameUrl,
  embedded: true,
  connectedAt: 1000
};

const tools = createToolsCore(toolsCoreConfig, {
  plugins: [linkPlugin, workspacePlugin, panelsPlugin, renderViewPlugin]
});
const agentCore = createAgentCore(agentCoreConfig, { plugins: [registryPlugin, channelPlugin] });

let game: TinyScreenGame;
let hub: AgentHub;
let agentManifest: Manifest;

async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = performance.now() + 10_000;
  while (!check()) {
    if (performance.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

function watched(): string[] {
  return [...hub.agentWatches.values()].map(entry => entry.id).toSorted();
}

beforeEach(async () => {
  vi.stubGlobal("__MOKU_GAME_DEV__", true);
  game = await startTinyScreenGame({ io: true });

  const agent = agentCore.createApp({
    pluginConfigs: { registry: { game: game.app }, channel: { heartbeatMs: 100 } }
  });
  await agent.start();
  agentManifest = agent.registry.manifest();
  // The tap settles on a later frame of the fake clock: step frames while it runs.
  const tapped = agent.channel.run("game.tap", { key: "play" });
  await game.until("board/awaitIntent");
  await game.frames(6);
  await tapped;

  hub = createAgentHub({
    channel: agent.channel,
    files: new Map([["manifest.json", JSON.stringify(TINY_SCREEN_MANIFEST)]]),
    project: {
      state: "on",
      revision: "r1",
      manifest: "manifest.json",
      defs: {},
      uses: {},
      broken: {}
    }
  });
  vi.stubGlobal("WebSocket", hub.Socket);
  // Node environment: a happy-dom document holds the boot.
  const window = new Window({ url: "http://127.0.0.1:3000/__editor" });
  window.document.body.innerHTML = `<script type="application/json" id="moku-editor-boot">${JSON.stringify(BOOT)}</script>`;
  vi.stubGlobal("document", window.document);
});

afterEach(async () => {
  await game?.stop();
  vi.unstubAllGlobals();
});

describe("renderView on the tiny screen game", () => {
  it("show Render → tiles, texture rows of the loaded bundles, tree rows with the tray → leave → stop", {
    timeout: 15_000
  }, async () => {
    expect(game.app.flow.state().path).toBe("board/awaitIntent");
    const manifest: Manifest = agentManifest;
    const app = tools.createApp();
    app.log.clearSinks();
    await app.start();
    hub.open(SESSION, manifest);
    hub.heartbeat(SESSION.id, 1841, false);

    await until(() => app.renderView.snapshot().tiles.fps !== undefined, "game.render");
    app.workspace.show("render");
    await until(() => app.renderView.snapshot().tree.length > 0, "scene");
    await until(() => app.renderView.snapshot().textures.length > 0, "texture rows");
    await until(() => app.renderView.snapshot().tiles.scene?.effects !== undefined, "game.effects");

    const snapshot = app.renderView.snapshot();
    const loaded = new Set(snapshot.bundles.map(row => row.name));
    expect(snapshot.tiles.fps?.now).toBe(0);
    // game 0.0.3 in a dev build: a draw counter with the render passes, and the live effects.
    expect(snapshot.tiles.drawCalls).toMatchObject({ kind: "value", value: 0 });
    expect(snapshot.tiles.drawCalls?.renderPasses).toBeTypeOf("number");
    const effects = snapshot.tiles.scene?.effects;
    expect(effects).toBeDefined();
    expect(Object.keys(effects ?? {}).toSorted()).toEqual([
      "emitters",
      "filters",
      "particles",
      "renderPasses"
    ]);
    expect(snapshot.textures.every(row => loaded.has(row.bundle))).toBe(true);
    expect(snapshot.textures.find(row => row.key === "board.cell")).toMatchObject({
      bundle: "board",
      width: 224,
      height: 219,
      gpuMb: 0.19,
      use: { kind: "in-use" }
    });
    expect(snapshot.tree.map(row => row.id)).toContain("ui:boardScreen/tray");

    app.workspace.show("flow");
    await until(() => hub.unwatched.length === 3, "three unwatch");
    expect(watched()).toEqual(["game.assets", "game.effects", "game.render"]);

    await app.stop();
    expect(watched()).toEqual([]);
  });
});

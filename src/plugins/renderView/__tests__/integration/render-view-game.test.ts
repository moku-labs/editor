import { readFileSync } from "node:fs";
import path from "node:path";
import { Window } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadMergeGame } from "../../../../../tests/fixtures/merge-game";
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
import type { Json, Manifest, SessionInfo, ToolsBoot } from "../../../registry/protocol";
import type { GameLike } from "../../../registry/types";
import { workspacePlugin } from "../../../workspace";
import { renderViewPlugin } from "../..";
import { type AgentHub, createAgentHub } from "./agent-hub";

// ─────────────────────────────────────────────────────────────────────────────
// The real chain: tools link → in-process hub → agent registry + channel on the
// merge game with its (inert) screen, walked onto the board. The asset manifest
// is the game's committed manifest.json, served by the in-memory files store.
// ─────────────────────────────────────────────────────────────────────────────

/** The screen game as this test drives it. */
type ScreenApp = GameLike & {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly flow: { run(): Promise<unknown>; state(): { readonly path: string } };
  readonly time: { step(ms: number): void };
};

const GAME_DIR = path.resolve("../game/tests/integration/merge-game");

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

/** The game's asset io over the files of the fixture: bundles load for real, textures are stand-ins. */
const DISK_IO = {
  fetch: async (url: string) =>
    new Response(readFileSync(path.join(GAME_DIR, url.replace(/^\//u, "")))),
  decode: async () => ({ width: 1, height: 1 }),
  createTexture: () => ({ label: "stand-in" }),
  destroyTexture: () => undefined
};

const tools = createToolsCore(toolsCoreConfig, {
  plugins: [linkPlugin, workspacePlugin, panelsPlugin, renderViewPlugin]
});
const agentCore = createAgentCore(agentCoreConfig, { plugins: [registryPlugin, channelPlugin] });

let game: ScreenApp;
let hub: AgentHub;
let agentManifest: Manifest;

async function frames(count: number): Promise<void> {
  for (let frame = 0; frame < count; frame += 1) {
    game.time.step(16);
    for (let tick = 0; tick < 40; tick += 1) await Promise.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = performance.now() + 3000;
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
  const manifestText = readFileSync(path.join(GAME_DIR, "manifest.json"), "utf8");
  const fixture = await loadMergeGame();
  const create = fixture.createScreenGame as unknown as (options: {
    manifest: Json;
    io: typeof DISK_IO;
  }) => { app: ScreenApp };
  game = create({ manifest: JSON.parse(manifestText), io: DISK_IO }).app;
  await game.start();
  game.flow.run().catch(() => undefined);
  await frames(6);

  const agent = agentCore.createApp({
    pluginConfigs: { registry: { game }, channel: { heartbeatMs: 100 } }
  });
  await agent.start();
  agentManifest = agent.registry.manifest();
  // The tap settles on a later frame of the fake clock: step frames while it runs.
  const tapped = agent.channel.run("game.tap", { key: "play" });
  for (let step = 0; step < 200 && game.flow.state().path !== "board/awaitIntent"; step += 1) {
    await frames(1);
  }
  await frames(6);
  await tapped;

  hub = createAgentHub({
    channel: agent.channel,
    files: new Map([["manifest.json", manifestText]])
  });
  vi.stubGlobal("WebSocket", hub.Socket);
  // Node environment (the fixture loads by a file URL): a happy-dom document holds the boot.
  const window = new Window({ url: "http://127.0.0.1:3000/__editor" });
  window.document.body.innerHTML = `<script type="application/json" id="moku-editor-boot">${JSON.stringify(BOOT)}</script>`;
  vi.stubGlobal("document", window.document);
});

afterEach(async () => {
  await game?.stop();
  vi.unstubAllGlobals();
});

describe("renderView on the merge game", () => {
  it("show Render → tiles, texture rows of the loaded bundles, tree rows with boardSlot → leave → stop", async () => {
    expect(game.flow.state().path).toBe("board/awaitIntent");
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

    const snapshot = app.renderView.snapshot();
    const loaded = new Set(snapshot.bundles.map(row => row.name));
    expect(snapshot.tiles.fps?.now).toBe(0);
    expect(snapshot.tiles.drawCalls).toEqual({ kind: "absent" });
    expect(snapshot.textures.every(row => loaded.has(row.bundle))).toBe(true);
    expect(snapshot.textures.find(row => row.key === "board.cell")).toMatchObject({
      bundle: "board",
      width: 224,
      height: 219,
      gpuMb: 0.19,
      use: { kind: "in-use" }
    });
    expect(snapshot.tree.map(row => row.id)).toContain("ui:boardScreen/boardSlot");

    app.workspace.show("flow");
    await until(() => hub.unwatched.length === 3, "three unwatch");
    expect(watched()).toEqual(["game.assets", "game.render"]);

    await app.stop();
    expect(watched()).toEqual([]);
  });
});

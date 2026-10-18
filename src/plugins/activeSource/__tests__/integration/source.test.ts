import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path/posix";
import { Window } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createServerCore,
  createToolsCore,
  serverCoreConfig,
  toolsCoreConfig
} from "../../../../config";
import { filesPlugin } from "../../../files";
import { hubPlugin } from "../../../hub";
import type { Client } from "../../../hub/__tests__/integration/clients";
import {
  AGENT_MANIFEST,
  connectClient,
  connectDevice,
  isNote,
  isRequestOf,
  paramsOf
} from "../../../hub/__tests__/integration/clients";
import type { DeviceListen } from "../../../hub/types";
import { linkPlugin } from "../../../link";
import type { Manifest, ToolsBoot } from "../../../registry/protocol";
import { notification, success, toWireValue } from "../../../registry/protocol";
import { activeSourcePlugin } from "../..";

// ─────────────────────────────────────────────────────────────────────────────
// The tools core (link, activeSource) against the real hub (files, hub) in
// device mode on random ports: a fake game page tagged with this page's frame
// id is the local preview, a Bun client with Origin tauri://localhost pairs over
// the adb listener as the phone. Real sockets, real timers.
// ─────────────────────────────────────────────────────────────────────────────

const server = createServerCore(serverCoreConfig, { plugins: [filesPlugin, hubPlugin] });
const tools = createToolsCore(toolsCoreConfig, { plugins: [linkPlugin, activeSourcePlugin] });

/** The running editor server. */
type Editor = {
  readonly app: ReturnType<typeof server.createApp>;
  readonly bun: ReturnType<typeof Bun.serve>;
  readonly port: number;
  readonly listen: DeviceListen;
};

/** The commands of the local preview's game: activeSource pauses and resumes it. */
const PAUSE_COMMANDS: Manifest["commands"] = [
  { id: "game.pause", title: "Pause", input: {}, effect: "raw" },
  { id: "game.resume", title: "Resume", input: {}, effect: "raw" }
];

let base: string;
let editor: Editor | undefined;
let page: ReturnType<typeof tools.createApp> | undefined;
let window: Window;
const clients: Client[] = [];

/**
 * Remembers a client for cleanup.
 *
 * @param client - The client.
 * @returns The same client.
 */
function keep(client: Client): Client {
  clients.push(client);
  return client;
}

/**
 * Starts the editor server in device mode (adb listener on a random port).
 *
 * @returns The editor.
 */
async function startEditor(): Promise<Editor> {
  const app = server.createApp({
    pluginConfigs: { files: { root: base, project: false }, hub: { devicePort: 0 } }
  });
  app.log.clearSinks();
  await app.start();
  const bun = Bun.serve(
    app.hub.serve({
      port: 0,
      routes: { "/": new Response("game page") },
      fetch: () => new Response("asset")
    })
  );
  const listen = await app.hub.listenDevices({ confirm: async () => false });
  editor = { app, bun, port: bun.port ?? 0, listen };
  return editor;
}

/**
 * Boots the tools page against the editor: the boot tag in a happy-dom document, then the tools
 * core started.
 *
 * @param running - The editor.
 * @returns The started tools app.
 */
async function startTools(running: Editor): Promise<ReturnType<typeof tools.createApp>> {
  const path = running.app.hub.path();
  const origin = `http://127.0.0.1:${String(running.port)}`;
  window = new Window({ url: `${origin}${path}/` });
  vi.stubGlobal("document", window.document);
  vi.stubGlobal("location", window.location);
  const boot: ToolsBoot = {
    v: 1,
    ws: `ws://127.0.0.1:${String(running.port)}${path}/ws`,
    token: running.app.hub.token(),
    path,
    title: "moku editor",
    editorUrl: "vscode://file/{path}:{line}",
    root: base,
    gameUrl: "/"
  };
  window.document.body.innerHTML = `<script type="application/json" id="moku-editor-boot">${JSON.stringify(boot)}</script>`;
  const app = tools.createApp({ pluginConfigs: { link: { retryMs: 100 } } });
  app.log.clearSinks();
  await app.start();
  page = app;
  return app;
}

/**
 * Answers every `run` a fake agent receives: game.pause true, anything else false; records the ids.
 *
 * @param client - The agent.
 * @returns The command ids received, in order.
 */
function answerRuns(client: Client): string[] {
  const runs: string[] = [];
  let seen = 0;
  client.socket.addEventListener("message", () => {
    const requests = client.messages.filter(isRequestOf("run"));
    for (const request of requests.slice(seen)) {
      const id = String(paramsOf(request)?.id);
      runs.push(id);
      const value = id === "game.pause";
      client.send(
        success(request.id, { value, state: { path: "board", frame: 1840, tainted: false } })
      );
    }
    seen = requests.length;
  });
  return runs;
}

/**
 * Connects the local preview: a game page tagged with the tools page's frame id.
 *
 * @param running - The editor.
 * @param app - The tools app.
 * @returns The agent and the run ids it received.
 */
async function startLocal(
  running: Editor,
  app: ReturnType<typeof tools.createApp>
): Promise<{ agent: Client; runs: string[] }> {
  const agent = keep(
    await connectClient(running.port, { token: running.app.hub.token(), kind: "agent" })
  );
  const runs = answerRuns(agent);
  const manifest: Manifest = {
    ...AGENT_MANIFEST,
    page: app.link.frameUrl(`http://127.0.0.1:${String(running.port)}/`),
    embedded: true,
    commands: PAUSE_COMMANDS
  };
  agent.send(notification("game", "hello", { manifest: toWireValue(manifest) }));
  await agent.next(isNote("editor", "session"));
  return { agent, runs };
}

/**
 * A phone that pairs over the adb listener (or comes back with its token) and says hello.
 *
 * @param running - The editor.
 * @param credentials - The device id and token of a reconnect; none to pair.
 * @param credentials.device - The device id the hub issued.
 * @param credentials.token - The device token.
 * @returns The phone and its credentials.
 */
async function startPhone(
  running: Editor,
  credentials?: { readonly device: string; readonly token: string }
): Promise<{ phone: Client; credentials: { device: string; token: string } }> {
  const phone = keep(await connectDevice(running.listen.adb, credentials));
  let known = credentials;
  if (known === undefined) {
    phone.send(notification("editor", "pair", { code: "4821", device: { model: "sm a266b" } }));
    const paired = paramsOf(await phone.next(isNote("editor", "paired")));
    known = { device: String(paired?.device), token: String(paired?.token) };
  }
  const manifest: Manifest = {
    ...AGENT_MANIFEST,
    page: "http://localhost/index.html",
    embedded: false
  };
  phone.send(notification("game", "hello", { manifest: toWireValue(manifest) }));
  await phone.next(isNote("editor", "session"));
  answerRuns(phone);
  return { phone, credentials: { ...known } };
}

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "moku-active-source-"));
});

afterEach(async () => {
  await page?.stop();
  page = undefined;
  for (const client of clients.splice(0)) client.close();
  if (editor !== undefined) {
    await editor.app.stop().catch(() => undefined);
    await Promise.race([editor.bun.stop(true), Bun.sleep(300)]);
    editor = undefined;
  }
  vi.unstubAllGlobals();
  await window.happyDOM.close();
  await rm(base, { recursive: true, force: true });
});

describe("activeSource over the real hub in device mode", () => {
  it("a linking phone becomes the source and pauses the local preview; leaving resumes it with a notice; it rejoins", async () => {
    const running = await startEditor();
    const app = await startTools(running);
    const local = await startLocal(running, app);
    await vi.waitFor(() => expect(app.activeSource.current()).toMatchObject({ kind: "local" }));
    const own = app.link.ownSession();
    expect(own).toBeDefined();

    const first = await startPhone(running);
    await vi.waitFor(() => expect(app.activeSource.current().kind).toBe("device"), {
      timeout: 4000
    });
    expect(local.runs).toEqual(["game.pause"]);
    expect(app.link.session()).toBe(app.activeSource.current().session);
    expect(app.activeSource.preview()).toEqual({ state: "paused-by-source" });
    expect(app.activeSource.label()).toMatchObject({ name: "SM-A266B", kind: "device" });

    first.phone.close();
    await vi.waitFor(
      () => expect(app.activeSource.current()).toEqual({ kind: "local", session: own }),
      {
        timeout: 4000
      }
    );
    await vi.waitFor(() => expect(local.runs).toEqual(["game.pause", "game.resume"]));
    expect(app.activeSource.notice()?.text).toBe(
      "SM-A266B disconnected. Showing the local preview."
    );
    expect(app.activeSource.markers().at(-1)?.label).toBe(
      "SM-A266B disconnected here · Local preview resumed"
    );

    await startPhone(running, first.credentials);
    await vi.waitFor(() => expect(app.activeSource.current().kind).toBe("device"), {
      timeout: 4000
    });
    const kinds = app.activeSource.markers().map(marker => marker.kind);
    expect(kinds).toEqual(["connected", "lost", "rejoined"]);
    await vi.waitFor(() => expect(local.runs).toEqual(["game.pause", "game.resume", "game.pause"]));
    expect(app.activeSource.notice()).toBeUndefined();
  });

  it("estimates the phone's clock offset from the heartbeats the hub forwards", async () => {
    // Bug: clockOffsetMs null forever for a phone: GC marks and telemetry off the phone's axis.
    const running = await startEditor();
    const app = await startTools(running);
    await startLocal(running, app);
    const { phone } = await startPhone(running);
    await vi.waitFor(() => expect(app.activeSource.current().kind).toBe("device"), {
      timeout: 4000
    });
    expect(app.activeSource.clockOffsetMs()).toBeNull();

    for (const frame of [1, 2, 3]) {
      phone.send(
        notification("game", "heartbeat", { frame, paused: false, at: Date.now() - 60_000 })
      );
    }

    await vi.waitFor(() => expect(app.activeSource.clockOffsetMs()).toBeLessThan(-59_000));
    expect(app.activeSource.clockOffsetMs()).toBeGreaterThan(-61_000);
  });
});

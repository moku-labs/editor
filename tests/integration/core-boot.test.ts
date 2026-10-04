import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createApp as createAgentApp,
  createPlugin as createAgentPlugin,
  registryPlugin
} from "../../src/agent";
import {
  bareMessage,
  checkInput,
  definePanel,
  flowFile,
  nodeFile,
  toWireValue,
  wireError
} from "../../src/index";
import { createApp as createServerApp } from "../../src/server";
import {
  type AgentStack,
  type BareAgentStack,
  bootTools,
  createPageDir,
  createProject,
  createTinyGame,
  installPage,
  logErrors,
  type ServerApp,
  type ServerStack,
  type Stoppable,
  shutdown,
  startAgent,
  startServer,
  TINY_NAME,
  type TinyGame,
  type ToolsStack,
  tinyModule,
  trackUnhandled,
  type UnhandledTracker,
  until
} from "./helpers/stack";

// ─────────────────────────────────────────────────────────────────────────────
// Core boot (plan §3, B1–B4): each entry composes its default plugins, opt-in
// plugins and dev modules extend the agent catalogue, pluginConfigs reach every
// plugin of every core, and hub.serve() merges the game's routes with the
// editor's.
// ─────────────────────────────────────────────────────────────────────────────

/** The R3 tools page policy, verbatim. pages appends three private directives after it. */
const R3_POLICY =
  "default-src 'self'; script-src 'self'; worker-src 'self' blob:; img-src 'self' data: blob:; " +
  "style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:* ws://localhost:*; " +
  "frame-src 'self'";

/** The six workspaces, one panel each. */
const WORKSPACES = ["console", "files", "flow", "game", "render", "state"];

const parts: (Stoppable | undefined)[] = [];
const extraApps: { stop(): Promise<void> }[] = [];
let unhandled: UnhandledTracker | undefined;

afterEach(async () => {
  for (const app of extraApps.splice(0)) await app.stop().catch(() => undefined);
  await shutdown(...parts.splice(0));
  unhandled?.stop();
  unhandled = undefined;
});

/**
 * Remembers stack parts for the bounded shutdown in afterEach.
 *
 * @param part - A started part.
 * @returns The same part.
 */
function keep<Part extends Stoppable>(part: Part): Part {
  parts.push(part);
  return part;
}

/**
 * Creates and starts a server app that never goes to Bun.serve, stopped in afterEach.
 *
 * @param root - The project root.
 * @returns The started app.
 */
async function startedServerApp(root: string): Promise<ServerApp> {
  const app = createServerApp({
    pluginConfigs: { files: { root }, pages: { pageDir: await createPageDir() } }
  });
  app.log.clearSinks();
  extraApps.push(app);
  await app.start();
  return app;
}

/**
 * True when every name is a key of the app.
 *
 * @param app - An app.
 * @param names - Plugin api names.
 * @returns The missing names.
 */
function missingKeys(app: object, names: readonly string[]): string[] {
  return names.filter(name => !(name in app));
}

describe("core boot", () => {
  it("B1: each entry composes its default plugins; the root entry is runtime-free", async () => {
    unhandled = trackUnhandled();
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const root = await createProject("tiny");
    const server = keep(await startServer(root));
    installPage(server.origin);
    const game = keep(await createTinyGame());
    const agent: BareAgentStack = keep(await startAgent(undefined, game, { bare: true }));
    const tools: ToolsStack = keep(await bootTools(server));
    await until(() => tools.app.link.status().kind === "empty", "an empty link (no agent)");

    expect(missingKeys(agent.app, ["registry", "channel", "overlay", "log", "env"])).toEqual([]);
    expect("bridge" in agent.app).toBe(false);
    expect("capture" in agent.app).toBe(false);
    expect(missingKeys(server.app, ["files", "hub", "pages", "log", "env"])).toEqual([]);
    expect(
      missingKeys(tools.app, [
        "link",
        "workspace",
        "panels",
        "flowView",
        "gameView",
        "renderView",
        "stateView",
        "filesView",
        "consoleView",
        "log",
        "env"
      ])
    ).toEqual([]);

    const panels = tools.app.panels.list();
    expect(panels).toHaveLength(6);
    expect(panels.map(panel => panel.workspace).toSorted()).toEqual(WORKSPACES);

    for (const helper of [
      definePanel,
      checkInput,
      toWireValue,
      nodeFile,
      flowFile,
      wireError,
      bareMessage
    ]) {
      expect(helper).toBeTypeOf("function");
    }
    const exists = (file: string): boolean => existsSync(path.join(root, file));
    expect(nodeFile({ flow: "main", node: "home" }, undefined, {}, exists)).toBe("nodes/home.ts");
    expect(flowFile("visit", {}, exists)).toBe("flows/visit.ts");

    expect(logErrors(server.app, agent.app, tools.app, game.app)).toEqual([]);
    expect(unhandled.list).toEqual([]);
  });

  it("B2: opt-in plugins and dev modules extend the catalogue", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const server = keep(await startServer(await createProject("tiny")));
    const game: TinyGame = keep(await createTinyGame());
    const ping = createAgentPlugin("ping", {
      depends: [registryPlugin],
      onInit: ctx => {
        const registry = ctx.require(registryPlugin);
        registry.add({
          descriptor: { id: "probe.ping", title: "Ping", input: {}, effect: "read" },
          run: async () => ({ value: "pong", state: registry.envelope() })
        });
      }
    });
    const agent: AgentStack = keep(await startAgent(server, game, { plugins: [ping] }));
    const { registry } = agent.app;

    const manifest = registry.manifest();
    const commands = manifest.commands.map(command => command.id);
    expect(commands).toEqual(
      expect.arrayContaining([
        "editor.capture",
        "editor.series",
        "editor.seriesStop",
        "editor.overlay",
        "tiny.warn",
        "tiny.fail",
        "probe.ping",
        "game.step",
        "game.bookmark",
        "game.restore"
      ])
    );
    expect(manifest.sources.map(source => source.id)).toEqual(
      expect.arrayContaining([
        "tiny.count",
        "game.graph",
        "game.position",
        "game.model",
        "game.log"
      ])
    );
    expect(manifest.game).toBe(TINY_NAME);

    expect(registry.source("tiny.count")?.descriptor.changes).toBe("frame");
    expect(registry.command("nope")).toBeUndefined();
    expect(registry.command("probe.ping")?.descriptor.effect).toBe("read");
    const pong = await registry.command("probe.ping")?.run({});
    expect(pong?.value).toBe("pong");

    const envelope = registry.envelope();
    expect(envelope).toEqual({ path: "home", frame: expect.any(Number), tainted: false });
    expect(registry.clock().frame).toBeTypeOf("number");
    expect(registry.clock().frame).toBe(envelope.frame);

    const warn = tinyModule.commands?.filter(command => command.id === "tiny.warn") ?? [];
    expect(warn).toHaveLength(1);
    expect(() =>
      createAgentApp({
        pluginConfigs: {
          registry: { game: game.app, modules: [tinyModule, { commands: warn }], name: TINY_NAME }
        }
      })
    ).toThrow('[moku-editor] Duplicate registry id "tiny.warn".');
  });

  it("B3: pluginConfigs reach every plugin of every core", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const editorUrl = "idea://open?file={path}&line={line}";
    const server: ServerStack = keep(
      await startServer(await createProject("tiny"), {
        hub: { path: "/__dev" },
        pages: { title: "tiny game", editorUrl, gameUrl: "/game.html" }
      })
    );
    installPage(server.origin, "/__dev");
    const game = keep(await createTinyGame());
    const agent = keep(await startAgent(server, game));

    const page = await fetch(`${server.origin}/__dev/`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")?.startsWith(R3_POLICY)).toBe(true);
    expect(await page.text()).toContain('id="moku-editor-boot"');

    const tools = keep(
      await bootTools(server, { configs: { workspace: { storageKey: "tiny-editor" } } })
    );
    const { link, workspace } = tools.app;
    expect(link.boot()).toEqual({
      v: 1,
      ws: `ws://127.0.0.1:${String(server.port)}/__dev/ws`,
      token: server.app.hub.token(),
      path: "/__dev",
      title: "tiny game",
      editorUrl,
      root: server.app.files.root(),
      gameUrl: "/game.html"
    });
    expect(server.app.hub.path()).toBe("/__dev");
    expect(Object.keys(server.app.pages.routes()).toSorted()).toEqual([
      "/__dev",
      "/__dev/",
      "/__dev/assets/*",
      "/__dev/hello",
      "/__dev/hmr"
    ]);
    expect(workspace.gameFrame().url.endsWith("/game.html")).toBe(true);
    expect(workspace.devices()).toHaveLength(16);

    const prefs: unknown[] = [];
    const off = workspace.onPrefs(next => {
      prefs.push(next);
    });
    workspace.setTheme("dark");
    off();
    expect(prefs).toHaveLength(1);
    expect(workspace.theme()).toBe("dark");
    expect(globalThis.localStorage.getItem("tiny-editor")).toContain("dark");

    await until(() => link.status().kind === "live", "a live link over /__dev");
    const since = performance.now();
    const beats = () =>
      server.tap.entries.filter(
        entry =>
          entry.dir === "in" &&
          entry.kind === "agent" &&
          entry.at >= since &&
          "method" in entry.message &&
          entry.message.method === "heartbeat"
      );
    await until(() => beats().length >= 5, "5 agent heartbeats within 800 ms", 800);
    const times = beats().map(entry => entry.at);
    const first = times[0] ?? 0;
    const fifth = times[4] ?? 0;
    // Four gaps of about 100 ms each (heartbeatMs: 100), not a burst.
    expect(fifth - first).toBeGreaterThan(250);
    expect(agent.app.bridge.status().kind).toBe("live");
  });

  it("B4: hub.serve() merges the game's routes and fetch with the editor routes", async () => {
    const root = await createProject("tiny");
    const server = keep(
      await startServer(
        root,
        {},
        {
          fetch: req =>
            new URL(req.url).pathname === "/game.js"
              ? new Response("asset", { headers: { "content-type": "text/javascript" } })
              : new Response("missing", { status: 404 })
        }
      )
    );
    const get = (route: string, headers?: Record<string, string>) =>
      fetch(`${server.origin}${route}`, headers === undefined ? {} : { headers });

    const home = await get("/");
    expect(home.status).toBe(200);
    expect(await home.text()).toContain("data-game-page");

    const script = await get("/game.js");
    expect(script.status).toBe(200);
    expect(await script.text()).toBe("asset");
    expect(server.fetched).toEqual(["/game.js"]);

    const tools = await get("/__editor/");
    expect(tools.status).toBe(200);
    expect(await tools.text()).toContain('id="moku-editor-boot"');

    const asset = await get("/__editor/assets/app.js");
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toContain("javascript");

    const hello = await get("/__editor/hello", { origin: server.origin });
    expect(hello.status).toBe(200);
    expect(await hello.json()).toEqual({
      ws: `ws://127.0.0.1:${String(server.port)}/__editor/ws`,
      token: server.app.hub.token()
    });
    expect(server.server.hostname).toBe("127.0.0.1");

    // A started app that has not served yet: each refusal is its own rule, not "serve runs once".
    const fresh = await startedServerApp(root);
    expect(() => fresh.hub.serve({ hostname: "0.0.0.0", port: 0 })).toThrow(
      /^\[moku-editor\] hub\.serve\(\) refuses hostname "0\.0\.0\.0"/
    );
    const withSocket = () =>
      fresh.hub.serve({
        port: 0,
        // @ts-expect-error -- the editor owns the one websocket handler; the type refuses it too.
        websocket: { message: () => undefined }
      });
    expect(withSocket).toThrow(/^\[moku-editor\] hub\.serve\(\) refuses a websocket handler/);
  });
});

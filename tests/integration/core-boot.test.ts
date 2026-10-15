import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  createApp as createAgentApp,
  createPlugin as createAgentPlugin,
  type Perf,
  perfPlugin,
  type Recorder,
  recorderPlugin,
  registryPlugin
} from "../../src/agent";
import type { AgentEvents, ApiOf, ServerEvents } from "../../src/config";
import {
  anchorKey,
  bareMessage,
  checkInput,
  definePanel,
  firstDefinition,
  isAllowed,
  isHotSwapEntry,
  isReloading,
  isSelectionInfo,
  parseSelectionInfo,
  parseSelectParams,
  refusalOf,
  type SelectionInfo,
  toWireValue,
  wireError
} from "../../src/index";
import * as barrel from "../../src/plugins";
import { type Collector, collectorPlugin, createApp as createServerApp } from "../../src/server";
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

/**
 * How long B3 waits for five heartbeats over real sockets. Five beats at heartbeatMs 100 take about
 * 400 ms; the budget is generous because a loaded parallel run (the pre-commit's whole suite) can
 * delay timers and socket reads, and B3 asserts the spacing of the beats, not the wait.
 */
const HEARTBEAT_WAIT_MS = 5000;

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

    expect(
      missingKeys(agent.app, ["registry", "channel", "perf", "recorder", "overlay", "log", "env"])
    ).toEqual([]);
    expect("bridge" in agent.app).toBe(false);
    expect("capture" in agent.app).toBe(false);
    expect(missingKeys(server.app, ["files", "hub", "collector", "pages", "log", "env"])).toEqual(
      []
    );
    // The barrel and the entries name the same instances of the new plugins.
    expect([barrel.perfPlugin, barrel.recorderPlugin, barrel.collectorPlugin]).toEqual([
      perfPlugin,
      recorderPlugin,
      collectorPlugin
    ]);
    // The tiny game has no renderer monitor: perf is off, and the agent boots without a warning.
    expect(Reflect.get(game.app, "renderer")?.monitor).toBeUndefined();
    expect(agent.app.perf.status().state).toBe("off");
    expect(agent.app.log.trace().filter(entry => entry.level === "warn")).toEqual([]);
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
      firstDefinition,
      anchorKey,
      wireError,
      bareMessage,
      isSelectionInfo,
      parseSelectionInfo,
      parseSelectParams,
      isReloading,
      isHotSwapEntry,
      refusalOf,
      isAllowed
    ]) {
      expect(helper).toBeTypeOf("function");
    }
    expect(
      isReloading({ kind: "lost", reason: "bye", lastFrame: 1, retryInMs: 1000, reloading: true })
    ).toBe(true);
    expect(
      isHotSwapEntry({ level: "info", event: "ui:hot-swap", data: { file: "/g/a.tsx" }, ts: 1 })
    ).toBe(true);
    const selection: SelectionInfo = {
      ref: { kind: "ui", path: "hud/infoBar" },
      key: "infoBar",
      name: "infoBar",
      type: "row",
      at: 1
    };
    expect(isSelectionInfo(selection)).toBe(true);
    expect(parseSelectionInfo({ ...selection, extra: 1 })).toEqual(selection);
    expect(parseSelectParams({ key: "infoBar", card: false })).toEqual({
      key: "infoBar",
      card: false
    });
    // The project index of the tiny project is the only source of code locations (amendment N).
    const { link } = tools.app;
    await until(() => link.project()?.state === "on", "the project index on");
    expect(firstDefinition(link.project(), "node:main/home")).toBe("nodes/home.ts");
    expect(firstDefinition(link.project(), "flow:visit")).toBe("flows/visit.ts");

    expect(logErrors(server.app, agent.app, tools.app, game.app)).toEqual([]);
    expect(unhandled.list).toEqual([]);
  });

  it("B1: the global event maps hold only the events whose listener cannot depend on the emitter", () => {
    expectTypeOf<keyof AgentEvents>().toEqualTypeOf<
      "bridge:status" | "overlay:changed" | "overlay:connect"
    >();
    expectTypeOf<keyof ServerEvents>().toEqualTypeOf<
      "hub:session" | "files:written" | "files:project"
    >();
    // The entries' namespaces carry the new plugins' api types.
    expectTypeOf<ApiOf<typeof perfPlugin>>().toEqualTypeOf<Perf.PerfApi>();
    expectTypeOf<ApiOf<typeof recorderPlugin>>().toEqualTypeOf<Recorder.RecorderApi>();
    expectTypeOf<ApiOf<typeof collectorPlugin>>().toEqualTypeOf<Collector.CollectorApi>();
    const wrongPayload = createAgentPlugin("wrongPayload", {
      onInit: ctx => {
        // @ts-expect-error -- overlay:connect carries { address }, not { addr }.
        ctx.emit("overlay:connect", { addr: "192.168.1.5:47600" });
      }
    });
    expect(wrongPayload.name).toBe("wrongPayload");
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
        "editor.record",
        "editor.mark",
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
        "game.log",
        "editor.perf.second",
        "editor.perf.window",
        "editor.perf.spikes",
        "editor.perf.spike",
        "editor.spikes",
        "editor.recorder"
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
    expect(workspace.devices()).toHaveLength(21);

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
    // A wait on real sockets: the budget only bounds a hung run, so a loaded parallel run does not
    // fail it (the spacing below is what B3 asserts).
    await until(() => beats().length >= 5, "5 agent heartbeats", HEARTBEAT_WAIT_MS);
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

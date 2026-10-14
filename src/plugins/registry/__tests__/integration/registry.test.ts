/* eslint-disable unicorn/no-null -- null is the wire value for "no input" and JSON null */
import { defineCommand } from "@moku-labs/game/control";
import { defineSource, read, sources } from "@moku-labs/game/inspect";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { agentCoreConfig, createAgentCore, createAgentPlugin } from "../../../../config";
import { registryPlugin } from "../..";
import type { Json } from "../../protocol";
import type { DevModule, GameLike, RegistryApi, RegistryCommandEvent } from "../../types";
import type { StartedGame } from "../helpers";
import { startBareGame, stubBuild } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// An agent core composed with only the registry, over the bare game
// ─────────────────────────────────────────────────────────────────────────────

const framework = createAgentCore(agentCoreConfig, { plugins: [registryPlugin] });

/** The game's .dev module of the test: one source and one cheat. */
const testModule: DevModule = {
  sources: [
    defineSource({
      id: "tiny.coins",
      title: "Coins",
      input: {},
      changes: "commit",
      read: (app: GameLike) => app.model.store.snapshot().player
    })
  ],
  commands: [
    defineCommand({
      id: "tiny.addCoins",
      title: "Add coins",
      input: { amount: "number" },
      effect: "cheat",
      run: (_app: GameLike, { amount }) => amount
    })
  ]
};

let game: StartedGame;

beforeEach(async () => {
  vi.stubGlobal("__MOKU_GAME_DEV__", true);
  game = await startBareGame();
});

afterEach(async () => {
  await game.stop();
  vi.unstubAllGlobals();
});

describe("registry integration", () => {
  it("lists the bare game's 20 sources and 17 commands without modules", async () => {
    const app = framework.createApp({ pluginConfigs: { registry: { game: game.app } } });
    await app.start();

    const manifest = app.registry.manifest();
    expect(manifest.sources).toHaveLength(20);
    expect(manifest.commands).toHaveLength(17);
    expect(manifest.game).toBe("game");

    await app.stop();
  });

  it("createApp → start → manifest → read → run → stop", async () => {
    const app = framework.createApp({
      pluginConfigs: {
        registry: { game: game.app, modules: [testModule], name: "tiny-game 0.0.0" }
      }
    });
    await app.start();

    const manifest = app.registry.manifest();
    expect(manifest.game).toBe("tiny-game 0.0.0");
    expect(manifest.sources).toHaveLength(21);
    expect(manifest.commands).toHaveLength(18);
    expect(manifest.sources.at(-1)?.id).toBe("tiny.coins");
    expect(manifest.commands.at(-1)?.id).toBe("tiny.addCoins");

    expect(app.registry.source("game.position")?.read(null)).toMatchObject({
      path: read(game.app, sources.position).path
    });

    const before = app.registry.clock().frame;
    const result = await app.registry.command("game.step")?.run({ frames: 2 });
    expect(result?.state).toEqual({
      path: read(game.app, sources.position).path,
      frame: before + 2,
      tainted: false
    });

    await app.registry.command("tiny.addCoins")?.run({ amount: 1 });
    expect(app.registry.envelope().tainted).toBe(true);

    await app.stop();
  });

  it("says in clock() which pause a reload keeps: devtools, not another reason", async () => {
    const app = framework.createApp({ pluginConfigs: { registry: { game: game.app } } });
    await app.start();

    expect(app.registry.clock()).toMatchObject({ paused: false, held: false, reasons: [] });
    await app.registry.command("game.pause")?.run(null);
    expect(app.registry.clock()).toMatchObject({ paused: true, held: true, reasons: ["devtools"] });
    await app.registry.command("game.resume")?.run(null);
    expect(app.registry.clock()).toMatchObject({ paused: false, held: false, reasons: [] });

    await app.stop();
  });

  it("logs a failed command through ctx.log", async () => {
    const app = framework.createApp({ pluginConfigs: { registry: { game: game.app } } });
    vi.stubGlobal("__MOKU_GAME_DEV__", undefined);

    await expect(app.registry.command("game.pause")?.run(null)).rejects.toMatchObject({
      code: -32_000
    });
    expect(app.log.trace().some(entry => entry.event === "registry:command-failed")).toBe(true);
  });

  it("throws from createApp on a duplicate module id", () => {
    const duplicate: DevModule = {
      commands: [
        defineCommand({ id: "game.step", title: "Again", input: {}, effect: "read", run: () => 1 })
      ]
    };

    expect(() =>
      framework.createApp({ pluginConfigs: { registry: { game: game.app, modules: [duplicate] } } })
    ).toThrow('[moku-editor] Duplicate registry id "game.step".');
  });

  it("throws from createApp without a game", () => {
    expect(() => framework.createApp()).toThrow(
      "[moku-editor] registry.game is missing.\n  Pass pluginConfigs.registry.game: the app your game made with createApp."
    );
  });

  it("lets a later plugin add an editor command in its onInit", async () => {
    const pingPlugin = createAgentPlugin("ping", {
      depends: [registryPlugin],
      onInit: ctx => {
        const registry = ctx.require(registryPlugin);
        registry.add({
          descriptor: { id: "editor.ping", title: "Ping", input: {}, effect: "read" },
          run: async () => ({ value: "pong", state: registry.envelope() })
        });
      }
    });
    const app = framework.createApp({
      plugins: [pingPlugin],
      pluginConfigs: { registry: { game: game.app } }
    });

    expect(app.registry.manifest().commands.at(-1)?.id).toBe("editor.ping");
    await expect(app.registry.command("editor.ping")?.run(null)).resolves.toMatchObject({
      value: "pong"
    });
  });
});

describe("registry types", () => {
  it("exposes exactly manifest, source, command, add, envelope, clock, game, build", () => {
    const app = framework.createApp({ pluginConfigs: { registry: { game: game.app } } });

    expectTypeOf<keyof typeof app.registry>().toEqualTypeOf<
      "manifest" | "source" | "command" | "add" | "envelope" | "clock" | "game" | "build"
    >();
    expect(Object.keys(app.registry).toSorted()).toEqual([
      "add",
      "build",
      "clock",
      "command",
      "envelope",
      "game",
      "manifest",
      "source"
    ]);
  });

  it("rejects an entry without a descriptor and a game that is not an app", () => {
    const app = framework.createApp({ pluginConfigs: { registry: { game: game.app } } });

    expect(() =>
      // @ts-expect-error -- an entry needs a descriptor
      app.registry.add({ run: async () => ({ value: null, state: app.registry.envelope() }) })
    ).toThrow();
    expect(() =>
      // @ts-expect-error -- {} is not a game app
      framework.createApp({ pluginConfigs: { registry: { game: {} } } })
    ).toThrow("registry.game is not a game app");
  });

  it("types ctx.require(registryPlugin) to RegistryApi in a dependent plugin", () => {
    const probePlugin = createAgentPlugin("probe", {
      depends: [registryPlugin],
      api: ctx => ({ registry: (): RegistryApi => ctx.require(registryPlugin) })
    });
    const app = framework.createApp({
      plugins: [probePlugin],
      pluginConfigs: { registry: { game: game.app } }
    });

    expectTypeOf(app.probe.registry).returns.toEqualTypeOf<RegistryApi>();
    expect(app.probe.registry().manifest().sources).toHaveLength(20);
  });
});

describe("registry on a plain --debug build (agent flag, no dev flag)", () => {
  /** A route command of the game's .dev module that the shipped engine refuses on this build. */
  const tap = defineCommand({
    id: "tiny.tap",
    title: "Tap",
    input: {},
    effect: "route",
    run: () => {
      throw Object.assign(
        new Error("[game] tiny.tap runs on --debug=full builds only.\n  Build with --debug=full."),
        { reason: "read-only" }
      );
    }
  });

  it("createApp → start → manifest → refused run → editor source → stop", async () => {
    stubBuild({ agent: true, build: "debug-20261014T160000Z" });
    const listeners = new Set<(value: Json) => void>();
    const perfLike = createAgentPlugin("perfLike", {
      depends: [registryPlugin],
      onInit: ctx => {
        ctx.require(registryPlugin).add({
          descriptor: { id: "editor.perf.second", title: "Second", input: {}, changes: "frame" },
          read: () => ({ fps: 60 }),
          watch: (_raw, fn) => {
            listeners.add(fn);
            return () => {
              listeners.delete(fn);
            };
          },
          probe: () => undefined
        });
      }
    });
    const app = framework.createApp({
      plugins: [perfLike],
      pluginConfigs: { registry: { game: game.app, modules: [{ commands: [tap] }] } }
    });
    await app.start();

    const manifest = app.registry.manifest();
    expect(manifest.build).toEqual({ profile: "read", id: "debug-20261014T160000Z" });
    expect(manifest.commands.find(command => command.id === "tiny.tap")).toMatchObject({
      allowed: false,
      reason: "read-only"
    });
    expect(manifest.commands.find(command => command.id === "game.pause")?.allowed).toBe(true);
    expect(manifest.sources.find(source => source.id === "editor.perf.second")).toEqual({
      id: "editor.perf.second",
      title: "Second",
      input: {},
      changes: "frame"
    });

    // Engine 0.14.12 runs no command without its dev flag; the shipped engine's run refuses
    // tiny.tap itself with reason "read-only". The flag goes on for the run, so the command's own
    // tagged throw stands in for the engine's controlReadOnly.
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    await expect(app.registry.command("tiny.tap")?.run(null)).rejects.toMatchObject({
      code: -32_009,
      data: { reason: "read_only", retryable: false, id: "tiny.tap" }
    });
    expect(
      app.log
        .trace()
        .some(entry => entry.event === "registry:command-refused" && entry.level === "info")
    ).toBe(true);

    const stop = app.registry.source("editor.perf.second")?.watch(null, () => undefined);
    expect(listeners.size).toBe(1);
    stop?.();
    await app.stop();
    expect(listeners.size).toBe(0);
  });

  it("delivers registry:command to a plugin that depends on the registry", async () => {
    const seen: RegistryCommandEvent[] = [];
    const recorderLike = createAgentPlugin("recorderLike", {
      depends: [registryPlugin],
      hooks: () => ({
        "registry:command": payload => {
          seen.push(payload);
        }
      })
    });
    const app = framework.createApp({
      plugins: [recorderLike],
      pluginConfigs: { registry: { game: game.app } }
    });
    await app.start();

    await app.registry.command("game.pause")?.run(null, "overlay");
    await expect(app.registry.command("game.step")?.run({ frames: 1.5 })).rejects.toMatchObject({
      code: -32_000
    });

    expect(seen).toEqual([
      { id: "game.pause", input: null, via: "overlay", ok: true },
      { id: "game.step", input: { frames: 1.5 }, via: "local", ok: false }
    ]);
    await app.stop();
  });
});

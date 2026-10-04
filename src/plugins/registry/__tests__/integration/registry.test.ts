/* eslint-disable unicorn/no-null -- null is the wire value for "no input" and JSON null */
import { defineCommand } from "@moku-labs/game/control";
import { defineSource, read, sources } from "@moku-labs/game/inspect";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { agentCoreConfig, createAgentCore, createAgentPlugin } from "../../../../config";
import { registryPlugin } from "../..";
import type { DevModule, GameLike, RegistryApi } from "../../types";
import type { StartedGame } from "../helpers";
import { startGame } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// An agent core composed with only the registry, over the real merge game
// ─────────────────────────────────────────────────────────────────────────────

const framework = createAgentCore(agentCoreConfig, { plugins: [registryPlugin] });

/** The game's .dev module of the test: one source and one cheat. */
const testModule: DevModule = {
  sources: [
    defineSource({
      id: "merge.coins",
      title: "Coins",
      input: {},
      changes: "commit",
      read: (app: GameLike) => app.model.store.snapshot().player
    })
  ],
  commands: [
    defineCommand({
      id: "merge.addCoins",
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
  game = await startGame();
});

afterEach(async () => {
  await game.stop();
  vi.unstubAllGlobals();
});

describe("registry integration", () => {
  it("lists the merge game's 19 sources and 16 commands without modules", async () => {
    const app = framework.createApp({ pluginConfigs: { registry: { game: game.app } } });
    await app.start();

    const manifest = app.registry.manifest();
    expect(manifest.sources).toHaveLength(19);
    expect(manifest.commands).toHaveLength(16);
    expect(manifest.game).toBe("game");

    await app.stop();
  });

  it("createApp → start → manifest → read → run → stop", async () => {
    const app = framework.createApp({
      pluginConfigs: {
        registry: { game: game.app, modules: [testModule], name: "merge-game 0.0.0" }
      }
    });
    await app.start();

    const manifest = app.registry.manifest();
    expect(manifest.game).toBe("merge-game 0.0.0");
    expect(manifest.sources).toHaveLength(20);
    expect(manifest.commands).toHaveLength(17);
    expect(manifest.sources.at(-1)?.id).toBe("merge.coins");
    expect(manifest.commands.at(-1)?.id).toBe("merge.addCoins");

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

    await app.registry.command("merge.addCoins")?.run({ amount: 1 });
    expect(app.registry.envelope().tainted).toBe(true);

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
  it("exposes exactly manifest, source, command, add, envelope, clock", () => {
    const app = framework.createApp({ pluginConfigs: { registry: { game: game.app } } });

    expectTypeOf<keyof typeof app.registry>().toEqualTypeOf<
      "manifest" | "source" | "command" | "add" | "envelope" | "clock"
    >();
    expect(Object.keys(app.registry).toSorted()).toEqual([
      "add",
      "clock",
      "command",
      "envelope",
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
    expect(app.probe.registry().manifest().sources).toHaveLength(19);
  });
});

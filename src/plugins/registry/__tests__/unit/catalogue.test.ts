/* eslint-disable unicorn/no-null -- null is the wire value for "no input" and JSON null */
import { commands, defineCommand } from "@moku-labs/game/control";
import { defineSource, sources } from "@moku-labs/game/inspect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addEditorCommand, buildCatalogue, requireGame } from "../../catalogue";
import type { CommandDescriptor, SourceDescriptor } from "../../protocol";
import type { CommandEntry, DevModule, DoorCommand, DoorSource, GameLike } from "../../types";
import type { StartedGame } from "../helpers";
import { createCtx, startGame, thrownBy } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// buildCatalogue (onInit) and addEditorCommand: order, origins, the rules
// ─────────────────────────────────────────────────────────────────────────────

let game: StartedGame;

beforeEach(async () => {
  vi.stubGlobal("__MOKU_GAME_DEV__", true);
  game = await startGame();
});

afterEach(async () => {
  await game.stop();
  vi.unstubAllGlobals();
});

const doorSourceIds = Object.values(sources).map(source => source.id);
const doorCommandIds = Object.values(commands).map(command => command.id);

/** A module source. */
const coins = defineSource({
  id: "merge.coins",
  title: "Coins",
  input: {},
  changes: "commit",
  read: (app: GameLike) => app.model.store.snapshot().player
});

/** A module cheat (modules may claim cheat or raw). */
const refill = defineCommand({
  id: "merge.refill",
  title: "Refill energy",
  input: { amount: "number?" },
  effect: "cheat",
  run: () => true
});

/**
 * An editor command entry.
 *
 * @param descriptor - Its descriptor.
 * @returns The entry.
 */
const editorEntry = (descriptor: CommandDescriptor): CommandEntry => ({
  descriptor,
  run: async () => ({ value: null, state: { path: "home", frame: 0, tainted: false } })
});

/**
 * A door-like source with any descriptor fields (for the invalid cases).
 *
 * @param fields - Descriptor fields.
 * @returns The source.
 */
const sourceWith = (fields: Partial<SourceDescriptor>): DoorSource => ({
  id: "merge.source",
  title: "Source",
  input: {},
  changes: "frame",
  read: () => 1,
  ...fields
});

/**
 * A door-like command with any descriptor fields (for the invalid cases).
 *
 * @param fields - Descriptor fields.
 * @returns The command.
 */
const commandWith = (fields: Partial<CommandDescriptor>): DoorCommand => ({
  id: "merge.command",
  title: "Command",
  input: {},
  effect: "read",
  run: () => 1,
  ...fields
});

describe("buildCatalogue", () => {
  it("adds the 14 door sources and 13 door commands in catalogue key order", () => {
    const ctx = createCtx({ game: game.app });

    buildCatalogue(ctx);

    expect(doorSourceIds).toHaveLength(14);
    expect(doorCommandIds).toHaveLength(13);
    expect([...ctx.state.sources.keys()]).toEqual(doorSourceIds);
    expect([...ctx.state.commands.keys()]).toEqual(doorCommandIds);
    expect([...ctx.state.origins.values()].every(origin => origin === "door")).toBe(true);
    expect(ctx.state.origins.size).toBe(27);
  });

  it("adds module entries after the doors, modules in config order", () => {
    const first: DevModule = { sources: [coins], commands: [refill] };
    const second: DevModule = { commands: [commandWith({ id: "merge.second" })] };
    const ctx = createCtx({ game: game.app, modules: [first, second] });

    buildCatalogue(ctx);

    expect([...ctx.state.sources.keys()]).toEqual([...doorSourceIds, "merge.coins"]);
    expect([...ctx.state.commands.keys()]).toEqual([
      ...doorCommandIds,
      "merge.refill",
      "merge.second"
    ]);
    expect(ctx.state.origins.get("merge.coins")).toBe("module");
    expect(ctx.state.origins.get("merge.refill")).toBe("module");
    expect(ctx.state.commands.get("merge.refill")?.descriptor.effect).toBe("cheat");
  });

  it("re-appends editor commands added before init after the modules", () => {
    const ctx = createCtx({ game: game.app, modules: [{ commands: [refill] }] });

    addEditorCommand(
      ctx.state,
      editorEntry({ id: "editor.early", title: "Early", input: {}, effect: "read" })
    );
    const early = ctx.state.commands.get("editor.early");
    buildCatalogue(ctx);

    expect([...ctx.state.commands.keys()].slice(-2)).toEqual(["merge.refill", "editor.early"]);
    expect(ctx.state.commands.get("editor.early")).toBe(early);
    expect(ctx.state.origins.get("editor.early")).toBe("editor");
  });

  it("drops the manifest cache", () => {
    const ctx = createCtx({ game: game.app });
    ctx.state.manifest = { game: "g", page: "", embedded: false, sources: [], commands: [] };

    buildCatalogue(ctx);

    expect(ctx.state.manifest).toBeUndefined();
  });

  it("throws on an id used by a source and a command (one namespace)", () => {
    const ctx = createCtx({
      game: game.app,
      modules: [{ commands: [commandWith({ id: "game.position" })] }]
    });

    expect(() => buildCatalogue(ctx)).toThrow(
      '[moku-editor] Duplicate registry id "game.position".\n  Each source and command id must be unique; rename one of them.'
    );
  });

  it("throws on a module command that reuses a door command id", () => {
    const ctx = createCtx({
      game: game.app,
      modules: [{ commands: [commandWith({ id: "game.step" })] }]
    });

    expect(() => buildCatalogue(ctx)).toThrow('Duplicate registry id "game.step"');
  });

  it("throws on an invalid id", () => {
    const ctx = createCtx({
      game: game.app,
      modules: [{ sources: [sourceWith({ id: "Bad id" })] }]
    });

    expect(() => buildCatalogue(ctx)).toThrow(
      '[moku-editor] Registry id "Bad id" is not a dotted name.\n  Name it like "editor.capture": camelCase words joined by dots.'
    );
  });

  it("throws on an invalid input kind", () => {
    const ctx = createCtx({
      game: game.app,
      // boundary of the test: a schema kind no InputSchema allows
      modules: [{ commands: [commandWith({ input: JSON.parse('{"amount":"int"}') })] }]
    });

    expect(() => buildCatalogue(ctx)).toThrow(
      '[moku-editor] Command "merge.command" has an unknown input kind "int" for "amount".\n  Use string, number, boolean or json, with an optional ?.'
    );
  });

  it("throws on an unknown changes key or effect", () => {
    const changes = createCtx({
      game: game.app,
      modules: [{ sources: [sourceWith({ changes: JSON.parse('"sometimes"') })] }]
    });
    const effect = createCtx({
      game: game.app,
      modules: [{ commands: [commandWith({ effect: JSON.parse('"nuke"') })] }]
    });

    expect(() => buildCatalogue(changes)).toThrow(
      '[moku-editor] Source "merge.source" has an unknown changes'
    );
    expect(() => buildCatalogue(effect)).toThrow(
      '[moku-editor] Command "merge.command" has an unknown effect'
    );
  });

  it("throws the missing-game message when game is undefined", () => {
    expect(() => buildCatalogue(createCtx())).toThrow(
      "[moku-editor] registry.game is missing.\n  Pass pluginConfigs.registry.game: the app your game made with createApp."
    );
  });

  it.each([
    ["a promise", Promise.resolve(1)],
    ["a config object", { pluginConfigs: {} }],
    [
      "an app without isPaused",
      { time: { snapshot: () => 1, onFrame: () => 1 }, flow: { state: () => 1 } }
    ],
    ["null", null]
  ])("throws the not-an-app message for %s", (_label, value) => {
    // boundary of the test: a value that is not a game app
    const ctx = createCtx({ game: value as unknown as GameLike });

    expect(() => buildCatalogue(ctx)).toThrow(
      "[moku-editor] registry.game is not a game app.\n  Pass the object createApp returned, not a promise or a config."
    );
  });

  it("leaves the state alone when the game check fails", () => {
    const ctx = createCtx();

    expect(() => buildCatalogue(ctx)).toThrow();
    expect(ctx.state.sources.size).toBe(0);
  });
});

describe("requireGame", () => {
  it("returns the configured game", () => {
    expect(requireGame({ game: game.app, modules: [], name: undefined })).toBe(game.app);
  });

  it("throws the missing-game message", () => {
    expect(
      thrownBy(() => requireGame({ game: undefined, modules: [], name: undefined }))
    ).toMatchObject({
      message: expect.stringContaining("registry.game is missing")
    });
  });
});

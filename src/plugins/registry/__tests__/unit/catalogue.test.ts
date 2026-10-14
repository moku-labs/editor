/* eslint-disable unicorn/no-null -- null is the wire value for "no input" and JSON null */
import { commands, defineCommand } from "@moku-labs/game/control";
import { defineSource, sources } from "@moku-labs/game/inspect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addEditorCommand, addEditorSource, buildCatalogue, requireGame } from "../../catalogue";
import type { CommandDescriptor, Effect, SourceDescriptor } from "../../protocol";
import type {
  CommandEntry,
  DevModule,
  DoorCommand,
  DoorSource,
  GameLike,
  SourceEntry
} from "../../types";
import type { StartedGame } from "../helpers";
import { createCtx, startBareGame, stubBuild, thrownBy } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// buildCatalogue (onInit) and addEditorCommand: order, origins, the rules
// ─────────────────────────────────────────────────────────────────────────────

let game: StartedGame;

beforeEach(async () => {
  vi.stubGlobal("__MOKU_GAME_DEV__", true);
  game = await startBareGame();
});

afterEach(async () => {
  await game.stop();
  vi.unstubAllGlobals();
});

const doorSourceIds = Object.values(sources).map(source => source.id);
const doorCommandIds = Object.values(commands).map(command => command.id);

/** A module source. */
const coins = defineSource({
  id: "tiny.coins",
  title: "Coins",
  input: {},
  changes: "commit",
  read: (app: GameLike) => app.model.store.snapshot().player
});

/** A module cheat (modules may claim cheat or raw). */
const refill = defineCommand({
  id: "tiny.refill",
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
  id: "tiny.source",
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
const commandWith = (fields: Partial<DoorCommand>): DoorCommand => ({
  id: "tiny.command",
  title: "Command",
  input: {},
  effect: "read",
  run: () => 1,
  ...fields
});

describe("buildCatalogue", () => {
  it("adds the 20 door sources and 17 door commands in catalogue key order", () => {
    const ctx = createCtx({ game: game.app });

    buildCatalogue(ctx);

    expect(doorSourceIds).toHaveLength(20);
    expect(doorCommandIds).toHaveLength(17);
    expect([...ctx.state.sources.keys()]).toEqual(doorSourceIds);
    expect([...ctx.state.commands.keys()]).toEqual(doorCommandIds);
    expect([...ctx.state.origins.values()].every(origin => origin === "door")).toBe(true);
    expect(ctx.state.origins.size).toBe(37);
  });

  it("adds module entries after the doors, modules in config order", () => {
    const first: DevModule = { sources: [coins], commands: [refill] };
    const second: DevModule = { commands: [commandWith({ id: "tiny.second" })] };
    const ctx = createCtx({ game: game.app, modules: [first, second] });

    buildCatalogue(ctx);

    expect([...ctx.state.sources.keys()]).toEqual([...doorSourceIds, "tiny.coins"]);
    expect([...ctx.state.commands.keys()]).toEqual([
      ...doorCommandIds,
      "tiny.refill",
      "tiny.second"
    ]);
    expect(ctx.state.origins.get("tiny.coins")).toBe("module");
    expect(ctx.state.origins.get("tiny.refill")).toBe("module");
    expect(ctx.state.commands.get("tiny.refill")?.descriptor.effect).toBe("cheat");
  });

  it("re-appends editor commands added before init after the modules", () => {
    const ctx = createCtx({ game: game.app, modules: [{ commands: [refill] }] });

    addEditorCommand(
      ctx.state,
      editorEntry({ id: "editor.early", title: "Early", input: {}, effect: "read" }),
      ctx
    );
    const early = ctx.state.commands.get("editor.early");
    buildCatalogue(ctx);

    expect([...ctx.state.commands.keys()].slice(-2)).toEqual(["tiny.refill", "editor.early"]);
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
      '[moku-editor] Command "tiny.command" has an unknown input kind "int" for "amount".\n  Use string, number, boolean or json, with an optional ?.'
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
      '[moku-editor] Source "tiny.source" has an unknown changes'
    );
    expect(() => buildCatalogue(effect)).toThrow(
      '[moku-editor] Command "tiny.command" has an unknown effect'
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

/** The unsubscribe of a watch that holds nothing. */
const unsubscribe = (): void => undefined;

/**
 * An editor source entry.
 *
 * @param id - Its id.
 * @param probe - Its probe, if any.
 * @returns The entry.
 */
const editorSource = (id: string, probe?: () => string | undefined): SourceEntry => ({
  descriptor: { id, title: id, input: {}, changes: "frame" },
  read: () => 1,
  watch: () => unsubscribe,
  ...(probe === undefined ? {} : { probe })
});

/** The effects a plain --debug build runs (spec 10 C1). */
const READ_EFFECTS: ReadonlySet<Effect> = new Set(["read", "cosmetic"]);

describe("the build profile of the catalogue", () => {
  it("marks door and module commands by effect on a read build: route, cheat, raw refused", () => {
    stubBuild({ agent: true });
    const ctx = createCtx({ game: game.app, modules: [{ commands: [refill] }] });

    buildCatalogue(ctx);
    const descriptors = [...ctx.state.commands.values()].map(entry => entry.descriptor);

    expect(descriptors.map(({ id, allowed, reason }) => ({ id, allowed, reason }))).toEqual(
      descriptors.map(({ id, effect }) =>
        READ_EFFECTS.has(effect)
          ? { id, allowed: true, reason: undefined }
          : { id, allowed: false, reason: "read-only" }
      )
    );
    expect(ctx.state.commands.get("game.tap")?.descriptor).toMatchObject({
      allowed: false,
      reason: "read-only"
    });
    expect(ctx.state.commands.get("game.pause")?.descriptor.allowed).toBe(true);
    expect(ctx.state.commands.get("tiny.refill")?.descriptor.reason).toBe("read-only");
  });

  it("allows every door command on a dev page", () => {
    const ctx = createCtx({ game: game.app });

    buildCatalogue(ctx);

    expect([...ctx.state.commands.values()].every(entry => entry.descriptor.allowed)).toBe(true);
  });

  it.each([
    ["a read build", { agent: true }, "read-only"],
    ["a page without flags", {}, "dev-only"]
  ] as const)("allows editor commands on %s, where game.tap is refused", (_label, flags, reason) => {
    stubBuild(flags);
    const ctx = createCtx({ game: game.app });
    addEditorCommand(
      ctx.state,
      editorEntry({
        id: "editor.reload",
        title: "Reload the page",
        input: { restore: "boolean?" },
        effect: "route"
      }),
      ctx
    );

    buildCatalogue(ctx);

    expect(ctx.state.commands.get("editor.reload")?.descriptor).toEqual({
      id: "editor.reload",
      title: "Reload the page",
      input: { restore: "boolean?" },
      effect: "route",
      allowed: true
    });
    expect(ctx.state.commands.get("game.tap")?.descriptor).toMatchObject({
      allowed: false,
      reason
    });
  });

  it("lists game.debug { kept } and game.frameRate as plain commands, allowed on a read build", () => {
    stubBuild({ agent: true });
    // Engine 0.14.12 has game.debug { nineSlice } and no game.frameRate: the shipped commands are
    // stood in by module commands with the shipped input (the descriptor's input comes from the engine).
    const kept = commandWith({
      id: "shipped.debug",
      title: "Debug drawing",
      input: { ...commands.debug.input, kept: "boolean?" },
      effect: "cosmetic"
    });
    const frameRate = commandWith({
      id: "game.frameRate",
      title: "Frame rate",
      input: { rate: "number" },
      effect: "cosmetic"
    });
    const ctx = createCtx({ game: game.app, modules: [{ commands: [kept, frameRate] }] });

    buildCatalogue(ctx);

    expect(ctx.state.commands.get("game.debug")?.descriptor).toEqual({
      id: "game.debug",
      title: commands.debug.title,
      input: commands.debug.input,
      effect: "cosmetic",
      allowed: true
    });
    expect(ctx.state.commands.get("shipped.debug")?.descriptor).toEqual({
      id: "shipped.debug",
      title: "Debug drawing",
      input: { nineSlice: "boolean", kept: "boolean?" },
      effect: "cosmetic",
      allowed: true
    });
    expect(ctx.state.commands.get("game.frameRate")?.descriptor).toEqual({
      id: "game.frameRate",
      title: "Frame rate",
      input: { rate: "number" },
      effect: "cosmetic",
      allowed: true
    });
    // The registry adds no editor button for them (decision "No built-in debug buttons").
    expect([...ctx.state.origins.keys()].filter(id => id.startsWith("editor."))).toEqual([]);
  });
});

describe("overlay markers", () => {
  it("throws a two-line TypeError for an unknown marker", () => {
    // boundary of the test: a marker no OverlayMarker allows
    const ctx = createCtx({
      game: game.app,
      modules: [{ commands: [commandWith({ overlay: JSON.parse('"slider"') })] }]
    });
    const error = thrownBy(() => buildCatalogue(ctx));

    expect(error).toBeInstanceOf(TypeError);
    expect(error).toMatchObject({
      message:
        '[moku-editor] Command "tiny.command" has an unknown overlay "slider".\n  Use toggle or button.'
    });
  });

  it("throws a two-line TypeError for a toggle without value(app)", () => {
    const ctx = createCtx({
      game: game.app,
      modules: [{ commands: [commandWith({ overlay: "toggle" })] }]
    });
    const error = thrownBy(() => buildCatalogue(ctx));

    expect(error).toBeInstanceOf(TypeError);
    expect(error).toMatchObject({
      message:
        '[moku-editor] Command "tiny.command" is an overlay toggle without value(app).\n  Give the command a value(app) that answers the switch\'s state.'
    });
  });

  it("takes a button without value(app) and copies the marker", () => {
    const ctx = createCtx({
      game: game.app,
      modules: [{ commands: [commandWith({ id: "tiny.boss", overlay: "button" })] }]
    });

    buildCatalogue(ctx);

    expect(ctx.state.commands.get("tiny.boss")?.descriptor.overlay).toBe("button");
  });

  it("refuses an editor command with a marker, before the descriptor checks", () => {
    const ctx = createCtx({ game: game.app });
    const error = thrownBy(() =>
      addEditorCommand(
        ctx.state,
        editorEntry({
          id: "editor.glow",
          title: "Glow",
          input: {},
          effect: "cosmetic",
          overlay: "toggle"
        }),
        ctx
      )
    );

    expect(error).toBeInstanceOf(TypeError);
    expect(error).toMatchObject({
      message:
        '[moku-editor] Editor command "editor.glow" cannot set overlay.\n  The overlay lists only the game\'s commands.'
    });
    expect(ctx.state.origins.has("editor.glow")).toBe(false);
  });
});

describe("editor.toggles", () => {
  /** Toggles of two modules: on, broken (value throws), off. */
  const on = commandWith({ id: "tiny.glow", overlay: "toggle", value: () => true });
  const off = commandWith({ id: "tiny.fog", overlay: "toggle", value: () => false });
  const broken = commandWith({
    id: "tiny.rain",
    overlay: "toggle",
    value: () => {
      throw new Error("no weather");
    }
  });

  it("is absent when the game has no toggle", () => {
    const ctx = createCtx({
      game: game.app,
      modules: [{ commands: [commandWith({ id: "tiny.boss", overlay: "button" })] }]
    });

    buildCatalogue(ctx);

    expect(ctx.state.origins.has("editor.toggles")).toBe(false);
  });

  it("sits after the module sources, before the editor sources, and answers every toggle in catalogue order", () => {
    const ctx = createCtx({
      game: game.app,
      modules: [{ sources: [coins], commands: [on, broken] }, { commands: [off] }]
    });
    addEditorSource(ctx.state, editorSource("editor.early"), ctx.log);

    buildCatalogue(ctx);
    const toggles = ctx.state.sources.get("editor.toggles");
    const value = toggles?.read(null);

    expect([...ctx.state.sources.keys()].slice(-3)).toEqual([
      "tiny.coins",
      "editor.toggles",
      "editor.early"
    ]);
    expect(ctx.state.origins.get("editor.toggles")).toBe("registry");
    expect(toggles?.descriptor).toEqual({
      id: "editor.toggles",
      title: "Overlay toggles",
      input: {},
      changes: "frame"
    });
    expect(value).toEqual({ "tiny.glow": true, "tiny.rain": null, "tiny.fog": false });
    expect(Object.keys(value ?? {})).toEqual(["tiny.glow", "tiny.rain", "tiny.fog"]);
    expect(ctx.state.probes.has("editor.toggles")).toBe(false);
  });

  it("is rebuilt once on a second build, which keeps the editor sources and their probes", () => {
    const ctx = createCtx({ game: game.app, modules: [{ commands: [on] }] });
    addEditorSource(
      ctx.state,
      editorSource("editor.early", () => undefined),
      ctx.log
    );
    buildCatalogue(ctx);
    const early = ctx.state.sources.get("editor.early");

    expect(() => buildCatalogue(ctx)).not.toThrow();
    expect([...ctx.state.sources.keys()].filter(id => id.startsWith("editor."))).toEqual([
      "editor.toggles",
      "editor.early"
    ]);
    expect(ctx.state.sources.get("editor.early")).toBe(early);
    expect(ctx.state.origins.get("editor.early")).toBe("editor");
    expect(ctx.state.probes.has("editor.early")).toBe(true);
  });
});

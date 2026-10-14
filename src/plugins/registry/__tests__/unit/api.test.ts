/* eslint-disable unicorn/no-null -- null is the wire value for "no input" and JSON null */
import { defineCommand } from "@moku-labs/game/control";
import { read, sources } from "@moku-labs/game/inspect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRegistryApi } from "../../api";
import { buildCatalogue } from "../../catalogue";
import type { CommandDescriptor, SourceDescriptor } from "../../protocol";
import { checkInput } from "../../protocol";
import type { CommandEntry, GameLike, RegistryApi, SourceEntry } from "../../types";
import type { StartedGame, TestCtx } from "../helpers";
import { createCtx, startBareGame, stubBuild, thrownBy } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The registry api over the bare game
// ─────────────────────────────────────────────────────────────────────────────

/** A module cheat, to taint the session. */
const addCoins = defineCommand({
  id: "tiny.addCoins",
  title: "Add coins",
  input: { amount: "number" },
  effect: "cheat",
  run: (_app: GameLike, { amount }) => amount
});

let game: StartedGame;
let ctx: TestCtx;
let registry: RegistryApi;

beforeEach(async () => {
  vi.stubGlobal("__MOKU_GAME_DEV__", true);
  game = await startBareGame();
  ctx = createCtx({
    game: game.app,
    modules: [{ commands: [addCoins] }],
    name: "tiny-game 0.0.0"
  });
  registry = createRegistryApi(ctx);
  buildCatalogue(ctx);
});

afterEach(async () => {
  await game.stop();
  vi.unstubAllGlobals();
});

/**
 * An editor command entry with the given descriptor fields.
 *
 * @param fields - Descriptor fields.
 * @returns The entry.
 */
function editorEntry(fields: Partial<CommandDescriptor> = {}): CommandEntry {
  return {
    descriptor: {
      id: "editor.overlay",
      title: "Overlay in game",
      input: { on: "boolean" },
      effect: "cosmetic",
      ...fields
    },
    run: async raw => {
      const { on } = checkInput({ on: "boolean" }, raw);
      return { value: on, state: registry.envelope() };
    }
  };
}

describe("manifest()", () => {
  it("lists the doors, the module command and the game name", () => {
    const manifest = registry.manifest();

    expect(manifest.game).toBe("tiny-game 0.0.0");
    expect(manifest.page).toBe("");
    expect(manifest.embedded).toBe(false);
    expect(manifest.sources).toHaveLength(20);
    expect(manifest.commands).toHaveLength(18);
    expect(manifest.commands.at(-1)?.id).toBe("tiny.addCoins");
  });

  it("returns the cached manifest until the next add", () => {
    const first = registry.manifest();

    expect(registry.manifest()).toBe(first);
    registry.add(editorEntry());
    const second = registry.manifest();

    expect(second).not.toBe(first);
    expect(second.commands.at(-1)).toEqual({
      id: "editor.overlay",
      title: "Overlay in game",
      input: { on: "boolean" },
      effect: "cosmetic",
      allowed: true
    });
  });
});

describe("source() and command()", () => {
  it("look up entries by id", () => {
    expect(registry.source("game.position")?.descriptor.id).toBe("game.position");
    expect(registry.command("game.step")?.descriptor.id).toBe("game.step");
    expect(registry.command("tiny.addCoins")?.descriptor.effect).toBe("cheat");
  });

  it("return undefined for an unknown id or the other kind", () => {
    expect(registry.source("game.nope")).toBeUndefined();
    expect(registry.command("game.nope")).toBeUndefined();
    expect(registry.source("game.step")).toBeUndefined();
    expect(registry.command("game.position")).toBeUndefined();
  });

  it("read a source and run a command through the entries", async () => {
    expect(registry.source("game.position")?.read(null)).toMatchObject({
      path: read(game.app, sources.position).path
    });
    const result = await registry.command("game.step")?.run({ frames: 1 });

    expect(result?.state.path).toBe(read(game.app, sources.position).path);
  });
});

describe("add()", () => {
  it("stores a guarded frozen copy, reachable by command()", async () => {
    const entry = editorEntry();
    registry.add(entry);
    const stored = registry.command("editor.overlay");

    expect(stored).not.toBe(entry);
    expect(Object.isFrozen(stored)).toBe(true);
    await expect(stored?.run({ on: true })).resolves.toMatchObject({ value: true });
    await expect(stored?.run({ on: "yes" })).rejects.toMatchObject({ code: -32_602 });
  });

  it("maps a plain failure of an editor command to -32000 with the id", async () => {
    registry.add({
      ...editorEntry({ id: "editor.broken" }),
      run: () => Promise.reject(new Error("nope"))
    });

    await expect(registry.command("editor.broken")?.run(null)).rejects.toMatchObject({
      code: -32_000,
      message: "[moku-editor] editor.broken: nope",
      data: { id: "editor.broken", reason: "command_failed" }
    });
  });

  it.each([
    "editor",
    "Editor.capture",
    "editor..capture",
    "editor.capture!",
    "1editor.capture",
    `editor.${"a".repeat(122)}`
  ])("refuses the id %s", id => {
    expect(() => registry.add(editorEntry({ id }))).toThrow(
      `[moku-editor] Registry id "${id}" is not a dotted name.\n  Name it like "editor.capture": camelCase words joined by dots.`
    );
  });

  it("accepts an id of exactly 128 characters", () => {
    const id = `editor.${"a".repeat(121)}`;

    expect(id).toHaveLength(128);
    expect(() => registry.add(editorEntry({ id }))).not.toThrow();
  });

  it.each(["game.position", "game.step", "tiny.addCoins"])("refuses the duplicate id %s", id => {
    expect(() => registry.add(editorEntry({ id }))).toThrow(
      `[moku-editor] Duplicate registry id "${id}".\n  Each source and command id must be unique; rename one of them.`
    );
  });

  it("refuses an editor command added twice", () => {
    registry.add(editorEntry());

    expect(() => registry.add(editorEntry())).toThrow('Duplicate registry id "editor.overlay"');
  });

  it.each(["cheat", "raw"] as const)("refuses the effect %s", effect => {
    expect(() => registry.add(editorEntry({ id: "editor.cheat", effect }))).toThrow(
      `[moku-editor] Editor command "editor.cheat" cannot have effect "${effect}".\n  Cheat and raw commands taint the session; define them in the game's .dev module.`
    );
    expect(registry.command("editor.cheat")).toBeUndefined();
  });

  it("refuses an unknown input kind", () => {
    // boundary of the test: a schema kind no InputSchema allows
    const input = JSON.parse('{"on":"bool"}');

    expect(() => registry.add(editorEntry({ input }))).toThrow(
      '[moku-editor] Command "editor.overlay" has an unknown input kind "bool" for "on".\n  Use string, number, boolean or json, with an optional ?.'
    );
  });

  it("accepts every input kind, optional or not", () => {
    const input = {
      a: "string",
      b: "number",
      c: "boolean",
      d: "json",
      e: "string?",
      f: "number?",
      g: "boolean?",
      h: "json?"
    } as const;

    expect(() => registry.add(editorEntry({ input }))).not.toThrow();
  });
});

describe("envelope()", () => {
  it("equals the position path, the clock frame and the tainted flag", () => {
    game.app.time.step(16);

    expect(registry.envelope()).toEqual({
      path: read(game.app, sources.position).path,
      frame: registry.clock().frame,
      tainted: read(game.app, sources.tainted)
    });
    expect(registry.envelope()).toEqual({
      path: read(game.app, sources.position).path,
      frame: game.app.time.snapshot().frame,
      tainted: false
    });
  });

  it("turns tainted after a cheat module command", async () => {
    await registry.command("tiny.addCoins")?.run({ amount: 3 });

    expect(registry.envelope().tainted).toBe(true);
  });

  it("throws the missing-game message before a game is configured", () => {
    const empty = createRegistryApi(createCtx());

    expect(thrownBy(() => empty.envelope())).toMatchObject({
      message: expect.stringContaining("[moku-editor] registry.game is missing.")
    });
    expect(() => empty.clock()).toThrow("registry.game is missing");
  });
});

describe("clock()", () => {
  it("reads the frame and the pause flag of the game clock", () => {
    game.app.time.step(16);
    game.app.time.step(16);

    expect(registry.clock()).toEqual({
      frame: game.app.time.snapshot().frame,
      paused: false,
      held: false,
      reasons: []
    });
  });

  it("is held with the reason devtools after game.pause, and free after game.resume", async () => {
    await registry.command("game.pause")?.run(null);

    expect(registry.clock()).toMatchObject({ paused: true, held: true, reasons: ["devtools"] });
    await registry.command("game.resume")?.run(null);
    expect(registry.clock()).toMatchObject({ paused: false, held: false, reasons: [] });
  });

  it("is paused after game.pause (the devtools pause reason)", async () => {
    await registry.command("game.pause")?.run(null);

    expect(registry.clock().paused).toBe(true);
    await registry.command("game.resume")?.run(null);
    expect(registry.clock().paused).toBe(false);
  });
});

/** The unsubscribe of a watch that holds nothing. */
const unsubscribe = (): void => undefined;

/**
 * An editor source entry with the given descriptor fields.
 *
 * @param id - Its id.
 * @param fields - Other descriptor fields.
 * @returns The entry.
 */
function editorSource(id: string, fields: Partial<SourceDescriptor> = {}): SourceEntry {
  return {
    descriptor: { id, title: id, input: {}, changes: "frame", ...fields },
    read: () => ({ id }),
    watch: () => unsubscribe
  };
}

describe("add() of a source", () => {
  it("lists editor sources after the doors and modules, in add order, and drops the manifest cache", () => {
    const first = registry.manifest();

    registry.add(editorSource("editor.perf.window"));
    registry.add(editorSource("editor.perf.second"));
    const second = registry.manifest();

    expect(second).not.toBe(first);
    expect(second.sources.map(source => source.id)).toEqual([
      ...first.sources.map(source => source.id),
      "editor.perf.window",
      "editor.perf.second"
    ]);
    expect(registry.source("editor.perf.window")?.read(null)).toEqual({ id: "editor.perf.window" });
    expect(registry.command("editor.perf.window")).toBeUndefined();
  });

  it("refuses a source with an unknown changes key or an id already used", () => {
    // boundary of the test: a changes key no Changes allows
    const changes = JSON.parse('"sometimes"');

    expect(() => registry.add(editorSource("editor.bad", { changes }))).toThrow(
      '[moku-editor] Source "editor.bad" has an unknown changes "sometimes".\n  Use frame, commit or edge.'
    );
    expect(() => registry.add(editorSource("game.position"))).toThrow(
      'Duplicate registry id "game.position"'
    );
    expect(() => registry.add(editorSource("tiny.addCoins"))).toThrow(
      'Duplicate registry id "tiny.addCoins"'
    );
  });
});

describe("game()", () => {
  it("answers the configured game app", () => {
    expect(registry.game()).toBe(game.app);
  });

  it("throws a two-line Error without a game", () => {
    const error = thrownBy(() => createRegistryApi(createCtx()).game());

    expect(error).toBeInstanceOf(Error);
    const lines = error instanceof Error ? error.message.split("\n") : [];
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("[moku-editor] registry.game is missing.");
    expect(lines[1]).toMatch(/^ {2}Pass pluginConfigs\.registry\.game/);
  });
});

describe("build()", () => {
  it("answers the page's build, and the manifest carries the same build", () => {
    stubBuild({ agent: true, build: "debug-20261014T160000Z", engine: "0.14.12+9c41e0" });
    const read = createCtx({ game: game.app });
    const api = createRegistryApi(read);
    buildCatalogue(read);

    expect(api.build()).toEqual({
      profile: "read",
      id: "debug-20261014T160000Z",
      engine: "0.14.12+9c41e0"
    });
    expect(api.manifest().build).toEqual(api.build());
  });

  it("reads the flags once: the first answer stays", () => {
    expect(registry.build()).toEqual({ profile: "dev" });

    stubBuild({ agent: true });

    expect(registry.build()).toEqual({ profile: "dev" });
    expect(registry.manifest().build).toEqual({ profile: "dev" });
  });
});

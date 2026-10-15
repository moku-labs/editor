/* eslint-disable unicorn/no-null -- null is the wire value for "no input" and JSON null */
import { commands, defineCommand } from "@moku-labs/game/control";
import { read, sources } from "@moku-labs/game/inspect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commandEntry, guardEntry } from "../../entries/command-entry";
import { ProtocolError, wireError } from "../../protocol";
import type { CommandEntry, DoorCommand, GameLike } from "../../types";
import type { LogMock, StartedGame } from "../helpers";
import { createLog, startBareGame } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// commandEntry over the bare game, and guardEntry for editor commands
// ─────────────────────────────────────────────────────────────────────────────

let game: StartedGame;
let log: LogMock;

beforeEach(async () => {
  vi.stubGlobal("__MOKU_GAME_DEV__", true);
  game = await startBareGame();
  log = createLog();
});

afterEach(async () => {
  await game.stop();
  vi.unstubAllGlobals();
});

/** A module cheat: adds nothing, answers the amount; taints the session through the door. */
const addCoins = defineCommand({
  id: "test.addCoins",
  title: "Add coins",
  input: { amount: "number" },
  effect: "cheat",
  run: (_app: GameLike, { amount }) => amount
});

/** A module command that answers a value the wire cannot carry. */
const leaky = defineCommand({
  id: "test.leaky",
  title: "Leaky",
  input: {},
  effect: "read",
  run: () => ({ fn: () => 1 })
});

/** A module command that answers nothing. */
const silent = defineCommand({
  id: "test.silent",
  title: "Silent",
  input: {},
  effect: "cosmetic",
  run: () => undefined
});

describe("commandEntry", () => {
  it("has a fresh frozen descriptor without functions", () => {
    const entry = commandEntry(game.app, commands.step, log);

    expect(entry.descriptor).toEqual({
      id: "game.step",
      title: "Step frames",
      input: { frames: "number", deltaMs: "number?" },
      effect: "cosmetic",
      allowed: true
    });
    expect(entry.descriptor).not.toBe(commands.step);
    expect(Object.isFrozen(entry.descriptor)).toBe(true);
    expect(Object.isFrozen(entry)).toBe(true);
  });

  it("runs game.step { frames: 1 }: frame + 1 and the RunResult shape", async () => {
    const before = game.app.time.snapshot().frame;
    const result = await commandEntry(game.app, commands.step, log).run({ frames: 1 });

    expect(result.value).toMatchObject({ frame: before + 1 });
    expect(result.state).toEqual({
      path: read(game.app, sources.position).path,
      frame: before + 1,
      tainted: false
    });
    expect(Object.keys(result)).toEqual(["value", "state"]);
  });

  it("rejects { frames: '1' } with -32602 naming the field and the id", async () => {
    const run = commandEntry(game.app, commands.step, log).run({ frames: "1" });

    await expect(run).rejects.toBeInstanceOf(ProtocolError);
    await expect(run).rejects.toMatchObject({
      code: -32_602,
      message: "[moku-editor] game.step: frames must be a number",
      data: { reason: "invalid_input", retryable: false, field: "frames", id: "game.step" }
    });
  });

  it("never throws synchronously", async () => {
    const entry = commandEntry(game.app, commands.step, log);
    let pending: Promise<unknown> | undefined;

    expect(() => {
      pending = entry.run({ frames: "x" });
    }).not.toThrow();
    await expect(pending).rejects.toMatchObject({ code: -32_602 });
  });

  it("rejects -32009 dev_only with two lines when the dev flag is off (the engine's controlRefused, reason dev-only)", async () => {
    // Engine answer 2026-10-15 item 3: controlRefused carries reason "dev-only" and is mapped like
    // the read-only refusal (it was -32000 command_failed before the engine tagged it).
    vi.stubGlobal("__MOKU_GAME_DEV__", undefined);
    const run = commandEntry(game.app, commands.step, log).run({ frames: 1 });

    await expect(run).rejects.toBeInstanceOf(ProtocolError);
    await expect(run).rejects.toMatchObject({
      code: -32_009,
      message:
        "[moku-editor] game.step: refused by this build, which has neither the dev nor the debug flag.\n  Run the game from the dev server, or build it with --debug.",
      data: { reason: "dev_only", retryable: false, id: "game.step" }
    });
    expect(log.info).toHaveBeenCalledWith("registry:command-refused", {
      id: "game.step",
      reason: "dev-only"
    });
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("rejects -32000 when the door command throws (game.step with a fractional frame count)", async () => {
    await expect(
      commandEntry(game.app, commands.step, log).run({ frames: 1.5 })
    ).rejects.toMatchObject({
      code: -32_000,
      message: "[moku-editor] game.step: [game] game.step takes a whole number of frames."
    });
  });

  it("taints the session after a cheat module command", async () => {
    const result = await commandEntry(game.app, addCoins, log).run({ amount: 5 });

    expect(result).toEqual({
      value: 5,
      state: {
        path: read(game.app, sources.position).path,
        frame: game.app.time.snapshot().frame,
        tainted: true
      }
    });
    expect(read(game.app, sources.tainted)).toBe(true);
  });

  it("rejects -32006 when the command answers a value the wire cannot carry", async () => {
    await expect(commandEntry(game.app, leaky, log).run(null)).rejects.toMatchObject({
      code: -32_006,
      message: "[moku-editor] test.leaky: function is not JSON at $.fn",
      data: { reason: "not_json", retryable: false, field: "$.fn", id: "test.leaky" }
    });
  });

  it("answers null for a command that returns nothing", async () => {
    const result = await commandEntry(game.app, silent, log).run(null);

    expect(result.value).toBeNull();
  });
});

describe("guardEntry", () => {
  const descriptor = {
    id: "editor.probe",
    title: "Probe",
    input: { on: "boolean" },
    effect: "cosmetic"
  } as const;
  const state = { path: "home", frame: 1, tainted: false };

  /**
   * Guards an entry whose run is the given function.
   *
   * @param run - The run.
   * @returns The guarded entry.
   */
  const guarded = (run: CommandEntry["run"]): CommandEntry => guardEntry({ descriptor, run });

  it("is a frozen copy with a fresh frozen descriptor", () => {
    const entry: CommandEntry = { descriptor, run: async () => ({ value: null, state }) };
    const copy = guardEntry(entry);

    expect(copy).not.toBe(entry);
    expect(copy.descriptor).not.toBe(descriptor);
    expect(copy.descriptor).toEqual({ ...descriptor, allowed: true });
    expect(Object.isFrozen(copy)).toBe(true);
    expect(Object.isFrozen(copy.descriptor)).toBe(true);
  });

  it("passes a result through", async () => {
    await expect(guarded(async () => ({ value: true, state })).run({ on: true })).resolves.toEqual({
      value: true,
      state
    });
  });

  it("maps a synchronous throw to -32000 command_failed with the id", async () => {
    const entry = guarded(() => {
      throw new Error("overlay is not mounted\n  second line");
    });

    await expect(entry.run(null)).rejects.toMatchObject({
      code: -32_000,
      message: "[moku-editor] editor.probe: overlay is not mounted",
      data: { reason: "command_failed", retryable: false, id: "editor.probe" }
    });
  });

  it("maps a plain rejection to -32000", async () => {
    await expect(
      guarded(() => Promise.reject(new TypeError("boom"))).run(null)
    ).rejects.toMatchObject({
      code: -32_000,
      message: "[moku-editor] editor.probe: boom"
    });
  });

  it("keeps a ProtocolError unchanged", async () => {
    const error = wireError(-32_602, "on must be a boolean", {
      reason: "invalid_input",
      field: "on"
    });

    await expect(guarded(() => Promise.reject(error)).run(null)).rejects.toBe(error);
  });
});

/**
 * A module command whose run throws the given value.
 *
 * @param thrown - What the run throws.
 * @returns The command.
 */
const throwing = (thrown: unknown): DoorCommand => ({
  id: "test.tap",
  title: "Tap",
  input: {},
  effect: "route",
  run: () => {
    throw thrown;
  }
});

/**
 * A game toggle whose value(app) is the given function.
 *
 * @param value - Its value(app).
 * @returns The command.
 */
const toggle = (value: (app: unknown) => unknown): DoorCommand => ({
  id: "test.glow",
  title: "Glow",
  input: { on: "boolean" },
  effect: "cosmetic",
  overlay: "toggle",
  run: () => true,
  // boundary of the test: a value(app) that may answer anything
  value: app => value(app) as boolean
});

/**
 * A value(app) that throws a two-line message.
 *
 * @throws {Error} Always.
 */
const failingGlow = (): never => {
  throw new Error("no glow\n  the garden is not loaded");
};

describe("commandEntry refusals", () => {
  it("rejects -32009 read_only with the id and two lines when the run refuses with reason read-only", async () => {
    // spec 10 C2: controlReadOnly is an Error tagged with reason "read-only"; no engine import.
    const refusal = Object.assign(
      new Error("[game] game.tap runs on --debug=full builds only.\n  Build with --debug=full."),
      { reason: "read-only" }
    );
    const run = commandEntry(game.app, throwing(refusal), log).run(null);

    await expect(run).rejects.toBeInstanceOf(ProtocolError);
    await expect(run).rejects.toMatchObject({
      code: -32_009,
      message:
        "[moku-editor] test.tap: refused by this debug build, which runs read and cosmetic commands only.\n  Build the game with --debug=full to run it.",
      data: { reason: "read_only", retryable: false, id: "test.tap" }
    });
    expect(log.info).toHaveBeenCalledWith("registry:command-refused", {
      id: "test.tap",
      reason: "read-only"
    });
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("keeps -32000 and a warn for an error with another reason, and for a thrown string", async () => {
    const busy = Object.assign(new Error("[game] busy"), { reason: "busy" });

    await expect(commandEntry(game.app, throwing(busy), log).run(null)).rejects.toMatchObject({
      code: -32_000,
      data: { reason: "command_failed", id: "test.tap" }
    });
    await expect(
      commandEntry(game.app, throwing("read-only"), log).run(null)
    ).rejects.toMatchObject({ code: -32_000, message: "[moku-editor] test.tap: read-only" });
    expect(log.warn).toHaveBeenCalledWith("registry:command-failed", {
      id: "test.tap",
      message: "[game] busy"
    });
    expect(log.info).not.toHaveBeenCalled();
  });
});

describe("commandEntry value()", () => {
  it("answers the toggle's value(app), asked of the game app at each call", () => {
    let on = true;
    const asked: unknown[] = [];
    const entry = commandEntry(
      game.app,
      toggle(app => {
        asked.push(app);
        return on;
      }),
      log
    );

    expect(entry.value?.()).toBe(true);
    on = false;
    expect(entry.value?.()).toBe(false);
    expect(asked).toEqual([game.app, game.app]);
  });

  it("has no value() for a button or a command without a marker", () => {
    expect(commandEntry(game.app, { ...toggle(() => true), overlay: "button" }, log).value).toBe(
      undefined
    );
    expect(commandEntry(game.app, commands.step, log).value).toBeUndefined();
  });

  it("answers undefined and warns once per failure streak for a throw or a non-boolean", () => {
    let answer: () => unknown = failingGlow;
    const entry = commandEntry(
      game.app,
      toggle(() => answer()),
      log
    );

    expect(entry.value?.()).toBeUndefined();
    expect(entry.value?.()).toBeUndefined();
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith("registry:value-failed", {
      id: "test.glow",
      message: "no glow"
    });

    answer = () => true;
    expect(entry.value?.()).toBe(true);
    answer = () => "yes";
    expect(entry.value?.()).toBeUndefined();
    expect(log.warn).toHaveBeenCalledTimes(2);
  });
});

/* eslint-disable unicorn/no-null -- null is the wire value for "no input" and JSON null */
import { defineSource, read, sources } from "@moku-labs/game/inspect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sourceEntry } from "../../entries/source-entry";
import type { Json } from "../../protocol";
import { ProtocolError } from "../../protocol";
import type { GameLike } from "../../types";
import type { LogMock, StartedGame } from "../helpers";
import { createLog, startGame, thrownBy } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// sourceEntry: read and watch over the real merge game
// ─────────────────────────────────────────────────────────────────────────────

let game: StartedGame;
let log: LogMock;

beforeEach(async () => {
  vi.stubGlobal("__MOKU_GAME_DEV__", true);
  game = await startGame();
  log = createLog();
});

afterEach(async () => {
  await game.stop();
  vi.unstubAllGlobals();
});

/** A function value: what a source must never hand to the wire. */
const returnsOne = (): number => 1;

/** A frame source whose read the test controls. */
const frameSource = (id: string, readValue: (app: GameLike) => unknown) =>
  defineSource({ id, title: id, input: {}, changes: "frame", read: readValue });

describe("sourceEntry descriptor", () => {
  it("is a fresh frozen descriptor without functions, never the door", () => {
    const entry = sourceEntry(game.app, sources.history, log);

    expect(entry.descriptor).toEqual({
      id: "game.history",
      title: "History",
      input: { last: "number?" },
      changes: "edge"
    });
    expect(entry.descriptor).not.toBe(sources.history);
    expect(Object.isFrozen(entry.descriptor)).toBe(true);
    expect(Object.isFrozen(entry.descriptor.input)).toBe(true);
    expect(Object.values(entry.descriptor).some(value => typeof value === "function")).toBe(false);
    expect(Object.isFrozen(entry)).toBe(true);
  });
});

describe("sourceEntry.read", () => {
  it("reads the door and returns Json", () => {
    const entry = sourceEntry(game.app, sources.position, log);

    expect(entry.read(null)).toEqual(read(game.app, sources.position));
    expect(entry.read(null)).toMatchObject({ path: expect.any(String) });
  });

  it("passes the checked input to the door", () => {
    const entry = sourceEntry(game.app, sources.history, log);
    const value = entry.read({ last: 1 });

    expect(Array.isArray(value)).toBe(true);
    expect((value as Json[]).length).toBeLessThanOrEqual(1);
  });

  it("throws -32602 with the id after the prefix for invalid input", () => {
    const error = thrownBy(() => sourceEntry(game.app, sources.history, log).read({ last: "1" }));

    expect(error).toBeInstanceOf(ProtocolError);
    expect(error).toMatchObject({
      code: -32_602,
      message: "[moku-editor] game.history: last must be a number",
      data: { reason: "invalid_input", retryable: false, field: "last", id: "game.history" }
    });
  });

  it("throws -32602 for an unknown input field", () => {
    expect(
      thrownBy(() => sourceEntry(game.app, sources.position, log).read({ x: 1 }))
    ).toMatchObject({
      code: -32_602,
      message: "[moku-editor] game.position: x is not a known input"
    });
  });

  it("throws -32000 command_failed when the door throws, and warns once", () => {
    const error = thrownBy(() => sourceEntry(game.app, sources.log, log).read({ level: "loud" }));
    const message =
      '[game] game.log takes the level "debug", "info", "warn" or "error".\n  Leave the level out to read every entry.';

    expect(error).toBeInstanceOf(ProtocolError);
    expect(error).toMatchObject({
      code: -32_000,
      message: `[moku-editor] game.log: ${message}`,
      data: { reason: "command_failed", retryable: false, id: "game.log" }
    });
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith("registry:source-failed", { id: "game.log", message });
  });

  it("names a thrown non-Error value", () => {
    const door = frameSource("test.throws", () => {
      throw "plain";
    });

    expect(thrownBy(() => sourceEntry(game.app, door, log).read(null))).toMatchObject({
      message: "[moku-editor] test.throws: plain"
    });
  });

  it("throws -32006 not_json when the door returns a function", () => {
    const door = frameSource("test.fn", () => returnsOne);
    const error = thrownBy(() => sourceEntry(game.app, door, log).read(null));

    expect(error).toMatchObject({
      code: -32_006,
      message: "[moku-editor] test.fn: function is not JSON at $",
      data: { reason: "not_json", retryable: false, field: "$", id: "test.fn" }
    });
  });

  it("converts the door value to wire Json (Map, undefined, Error)", () => {
    const door = frameSource("test.map", () => ({
      map: new Map([["a", 1]]),
      gone: undefined,
      error: new Error("x")
    }));

    expect(sourceEntry(game.app, door, log).read(null)).toEqual({
      map: { $map: [["a", 1]] },
      error: { $error: { name: "Error", message: "x" } }
    });
  });
});

describe("sourceEntry.watch", () => {
  it("does not deliver at once; delivers after a frame", () => {
    const values: Json[] = [];
    const stop = sourceEntry(game.app, sources.position, log).watch(null, value =>
      values.push(value)
    );

    expect(values).toEqual([]);
    game.app.time.step(16);
    expect(values).toHaveLength(1);
    expect(values[0]).toMatchObject({ path: read(game.app, sources.position).path });
    stop();
  });

  it("checks the input synchronously and throws -32602", () => {
    const entry = sourceEntry(game.app, sources.history, log);

    expect(thrownBy(() => entry.watch({ last: true }, () => undefined))).toMatchObject({
      code: -32_602,
      message: "[moku-editor] game.history: last must be a number"
    });
  });

  it("passes the checked input to the door", () => {
    const values: Json[] = [];
    const stop = sourceEntry(game.app, sources.history, log).watch({ last: 0 }, value =>
      values.push(value)
    );

    game.app.time.step(16);
    expect(values).toEqual([[]]);
    stop();
  });

  it("delivers wire Json, converted", () => {
    const values: Json[] = [];
    const door = frameSource("test.set", () => new Set([1]));
    const stop = sourceEntry(game.app, door, log).watch(null, value => values.push(value));

    game.app.time.step(16);
    expect(values).toEqual([{ $set: [1] }]);
    stop();
  });

  it("swallows a listener throw, logs once per streak, and resets after a delivery", () => {
    let failing = true;
    const door = frameSource("test.frame", app => app.time.snapshot().frame);
    const stop = sourceEntry(game.app, door, log).watch(null, () => {
      if (failing) throw new Error("listener broke");
    });

    expect(() => {
      game.app.time.step(16);
      game.app.time.step(16);
      game.app.time.step(16);
    }).not.toThrow();
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith("registry:watch-failed", {
      id: "test.frame",
      message: "listener broke"
    });

    failing = false;
    game.app.time.step(16);
    failing = true;
    game.app.time.step(16);
    expect(log.warn).toHaveBeenCalledTimes(2);
    stop();
  });

  it("swallows a door read throw and skips the delivery", () => {
    const values: Json[] = [];
    const door = frameSource("test.broken", () => {
      throw new Error("door broke");
    });
    const stop = sourceEntry(game.app, door, log).watch(null, value => values.push(value));

    expect(() => {
      game.app.time.step(16);
      game.app.time.step(16);
    }).not.toThrow();
    expect(values).toEqual([]);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith("registry:watch-failed", {
      id: "test.broken",
      message: "door broke"
    });
    stop();
  });

  it("swallows a value that is not JSON", () => {
    const values: Json[] = [];
    const door = frameSource("test.bigint", () => 1n);
    const stop = sourceEntry(game.app, door, log).watch(null, value => values.push(value));

    expect(() => game.app.time.step(16)).not.toThrow();
    expect(values).toEqual([]);
    expect(log.warn).toHaveBeenCalledWith("registry:watch-failed", {
      id: "test.bigint",
      message: "[moku-editor] bigint is not JSON at $"
    });
    stop();
  });

  it("stops delivering after unsubscribe, which is idempotent", () => {
    const values: Json[] = [];
    const door = frameSource("test.tick", app => app.time.snapshot().frame);
    const stop = sourceEntry(game.app, door, log).watch(null, value => values.push(value));

    game.app.time.step(16);
    stop();
    expect(() => stop()).not.toThrow();
    game.app.time.step(16);
    expect(values).toHaveLength(1);
  });
});

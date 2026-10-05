/* eslint-disable unicorn/no-null -- null is the wire value for "no input" and JSON null */
import type { createApp } from "@moku-labs/game";
import type { Command } from "@moku-labs/game/control";
import { commands, defineCommand, run } from "@moku-labs/game/control";
import type { InputOf as GameInputOf } from "@moku-labs/game/inspect";
import { read, sources, watch } from "@moku-labs/game/inspect";
import { describe, expect, expectTypeOf, it } from "vitest";
import { loadMergeGame } from "../../../../../tests/fixtures/merge-game";
import type { InputOf, InputSchema, Json } from "../../protocol";
import type { DevModule, DoorCommand, DoorSource, GameLike } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// S1 typing spike (01-registry, Risks R1): the erased door types hold every
// door descriptor without a cast, and the generic door functions accept them
// with `game: GameLike`. The checks are compile-time (tsc); every `it` also
// asserts at run time against the real catalogue.
// ─────────────────────────────────────────────────────────────────────────────

/** The headless app of a game made with the default plugins. */
type HeadlessGameApp = ReturnType<typeof createApp>;

/** A dev command whose app is the registry's GameLike (wider than HeadlessApp). */
const addCoins = defineCommand({
  id: "merge.addCoins",
  title: "Add coins",
  input: { amount: "number", note: "json?" },
  effect: "cheat",
  run: (app: GameLike, { amount, note }) => ({
    amount,
    note: note ?? null,
    frame: app.time.snapshot().frame
  })
});

/**
 * Reads an erased source with checked input: the closure the registry builds.
 *
 * @param game - The game.
 * @param door - Any door source.
 * @param input - Input checked against `door.input`.
 * @returns What the door read.
 */
const readErased = (game: GameLike, door: DoorSource, input: InputOf<InputSchema>): unknown =>
  read(game, door, input);

/**
 * Runs an erased command with checked input.
 *
 * @param game - The game.
 * @param door - Any door command.
 * @param input - Input checked against `door.input`.
 * @returns The door's Ran.
 */
const runErased = (game: GameLike, door: DoorCommand, input: InputOf<InputSchema>) =>
  run(game, door, input);

/**
 * Watches an erased source.
 *
 * @param game - The game.
 * @param door - Any door source.
 * @param input - Input checked against `door.input`.
 * @param fn - Listener.
 * @returns Unsubscribe.
 */
const watchErased = (
  game: GameLike,
  door: DoorSource,
  input: InputOf<InputSchema>,
  fn: (value: unknown) => void
): (() => void) => watch(game, door, input, fn);

/**
 * A generic closure: `run(game, command, input)` with a generic schema S.
 *
 * @param game - The game.
 * @param command - A typed command.
 * @param input - Its typed input.
 * @returns The door's Ran.
 */
const runGeneric = <S extends InputSchema, O>(
  game: GameLike,
  command: Command<S, O, GameLike>,
  input: InputOf<S>
) => run(game, command, input);

describe("typing spike (S1)", () => {
  it("stores the whole door catalogue as a DevModule without a cast", () => {
    const module: DevModule = {
      sources: Object.values(sources),
      commands: Object.values(commands)
    };

    expect(module.sources).toHaveLength(19);
    expect(module.commands).toHaveLength(16);
  });

  it("fits a defineCommand with App = GameLike and an optional json field into DoorCommand", () => {
    const door: DoorCommand = addCoins;
    const module: DevModule = { commands: [addCoins] };

    expect(door.id).toBe("merge.addCoins");
    expect(module.commands?.[0]?.input).toEqual({ amount: "number", note: "json?" });
  });

  it("fits the headless game app into GameLike", async () => {
    const { createGame } = await loadMergeGame();
    const { app } = createGame();

    expectTypeOf<HeadlessGameApp>().toExtend<GameLike>();
    expect(typeof app.time.snapshot).toBe("function");
    expect(typeof app.flow.state).toBe("function");
  });

  it("calls the generic door functions with erased descriptors and checked input", async () => {
    const { createGame } = await loadMergeGame();
    const { app } = createGame();
    const input: InputOf<InputSchema> = {};

    expect(readErased(app, sources.position, input)).toEqual(read(app, sources.position));
    const stop = watchErased(app, sources.position, input, () => undefined);
    stop();
    await expect(runErased(app, commands.step, { frames: 1 })).rejects.toThrow(/dev builds only/);
    await expect(runGeneric(app, addCoins, { amount: 5 })).rejects.toThrow(/dev builds only/);
  });

  it("keeps the protocol InputOf identical to the game's InputOf", () => {
    type Step = { frames: "number"; deltaMs: "number?" };

    expectTypeOf<InputOf<Step>>().toEqualTypeOf<GameInputOf<Step>>();
    expectTypeOf<InputOf<{ amount: "number"; note: "json?" }>>().toEqualTypeOf<{
      amount: number;
      note?: Json | undefined;
    }>();
    expect(Object.keys(addCoins.input)).toEqual(["amount", "note"]);
  });

  it("rejects a descriptor whose changes key is not a Changes", () => {
    const bad = {
      id: "merge.bad",
      title: "Bad",
      input: {},
      changes: "sometimes",
      read: () => 1
    };
    // @ts-expect-error -- "sometimes" is not "frame" | "commit" | "edge"
    const door: DoorSource = bad;

    expect(door.changes).toBe("sometimes");
  });
});

import { createHeadless } from "@moku-labs/game/testing";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from "vitest";
import { clockOf } from "../../entries/envelope";
import type { Clock, GameLike } from "../../types";
import { createBareApp } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// clockOf over the bare game: the frame, the pause flag, the pause reasons and
// `held`, the pause a reload keeps (change reload-background-pause).
// ─────────────────────────────────────────────────────────────────────────────

/** The bare game with its whole api, the pause stack included. */
type BareApp = ReturnType<typeof createBareApp>;

let app: BareApp;
let stop: () => Promise<void>;

beforeEach(async () => {
  app = createBareApp();
  const game = await createHeadless(app);
  stop = () => game.stop();
});

afterEach(async () => {
  await stop();
});

/**
 * A copy of the game behind a Proxy whose `lifecycle` is the given value: a game without the
 * plugin, an older one without `reasons`, or a fake stack. A copy, because the app is frozen and a
 * Proxy cannot answer another value for a frozen property.
 *
 * @param game - The game app.
 * @param lifecycle - What `game.lifecycle` answers.
 * @returns The proxied copy.
 */
function withLifecycle(game: GameLike, lifecycle: unknown): GameLike {
  return new Proxy(
    { ...game },
    { get: (target, key) => (key === "lifecycle" ? lifecycle : Reflect.get(target, key)) }
  );
}

/**
 * Pushes pause reasons on the game's stack, in order.
 *
 * @param reasons - The reasons.
 */
function pause(...reasons: readonly string[]): void {
  for (const reason of reasons) app.lifecycle.push(reason);
}

describe("clockOf()", () => {
  it("is not paused and not held without a pause reason", () => {
    app.time.step(16);

    expect(clockOf(app)).toEqual({
      frame: app.time.snapshot().frame,
      paused: false,
      held: false,
      reasons: []
    });
  });

  it("is paused but not held for a background pause", () => {
    pause("background");

    expect(clockOf(app)).toEqual({
      frame: app.time.snapshot().frame,
      paused: true,
      held: false,
      reasons: ["background"]
    });
  });

  it("is held for a devtools pause", () => {
    pause("devtools");

    expect(clockOf(app)).toMatchObject({ paused: true, held: true, reasons: ["devtools"] });
  });

  it("is held when background and devtools both hold", () => {
    pause("background", "devtools");

    expect(clockOf(app)).toMatchObject({
      paused: true,
      held: true,
      reasons: ["background", "devtools"]
    });
  });

  it("is no longer held once devtools leaves, while background keeps the pause", () => {
    pause("background", "devtools");
    app.lifecycle.pop("devtools");

    expect(clockOf(app)).toMatchObject({ paused: true, held: false, reasons: ["background"] });
  });

  it("is not held for a reason that only contains the word devtools", () => {
    pause("devtools-panel");

    expect(clockOf(app)).toMatchObject({ paused: true, held: false, reasons: ["devtools-panel"] });
  });

  it("answers a copy of the reasons", () => {
    const stack = ["background"];
    const clock = clockOf(withLifecycle(app, { reasons: () => stack }));
    stack.push("devtools");

    expect(clock.reasons).not.toBe(stack);
    expect(clock.reasons).toEqual(["background"]);
    expect(clock.held).toBe(false);
  });
});

describe("clockOf() of a game without lifecycle.reasons", () => {
  it("is held when the clock is paused, with no reasons", () => {
    pause("background");

    expect(clockOf(withLifecycle(app, undefined))).toEqual({
      frame: app.time.snapshot().frame,
      paused: true,
      held: true,
      reasons: []
    });
  });

  it("is not held when the clock runs", () => {
    expect(clockOf(withLifecycle(app, undefined))).toMatchObject({
      paused: false,
      held: false,
      reasons: []
    });
  });

  it("reads a lifecycle without reasons like a missing one", () => {
    pause("background");

    expect(clockOf(withLifecycle(app, {}))).toMatchObject({
      paused: true,
      held: true,
      reasons: []
    });
  });
});

describe("Clock type", () => {
  it("has the frame, the two flags and the readonly reasons", () => {
    expectTypeOf<Clock>().toEqualTypeOf<{
      readonly frame: number;
      readonly paused: boolean;
      readonly held: boolean;
      readonly reasons: readonly string[];
    }>();
    expectTypeOf(clockOf).returns.toEqualTypeOf<Clock>();
    expect(Object.keys(clockOf(app)).toSorted()).toEqual(["frame", "held", "paused", "reasons"]);
  });

  it("takes a game with or without lifecycle as GameLike, without a cast", () => {
    const withStack: GameLike = app;
    const { lifecycle } = withStack;

    expectTypeOf(lifecycle).toEqualTypeOf<{ reasons(): readonly string[] } | undefined>();
    expect(lifecycle?.reasons()).toEqual([]);
  });
});

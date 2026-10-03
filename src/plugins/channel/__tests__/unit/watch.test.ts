/* eslint-disable unicorn/no-null -- null is the wire value for "no input" */
import { describe, expect, it } from "vitest";
import type { Json } from "../../../registry/protocol";
import { openWatch } from "../../watch";
import type { FakeSource } from "../helpers";
import { createDeps, fakeSource, thrownBy } from "../helpers";

/**
 * The fake game.position source of a deps object.
 *
 * @param deps - The test deps.
 * @returns The fake source.
 */
function positionOf(deps: ReturnType<typeof createDeps>): FakeSource {
  const source = deps.registry.sources.get("game.position");
  if (source === undefined) throw new Error("fixture lacks game.position");
  return source;
}

describe("openWatch — first value", () => {
  it("delivers the current value synchronously before it returns", () => {
    const deps = createDeps();
    const values: Json[] = [];

    const stop = openWatch(deps, "game.position", undefined, value => values.push(value));

    expect(values).toEqual([{ path: "home" }]);
    expect(typeof stop).toBe("function");
  });

  it("reads and watches with null for a missing input and the raw input otherwise", () => {
    const deps = createDeps();
    const source = positionOf(deps);
    const values: Json[] = [];

    openWatch(deps, "game.position", undefined, value => values.push(value));
    openWatch(deps, "game.position", { last: 1 }, value => values.push(value));

    expect(source.reads).toEqual([null, { last: 1 }]);
    expect(source.opened).toBe(2);
  });

  it("throws -32601 for an unknown id and opens no door watch", () => {
    const deps = createDeps();

    expect(thrownBy(() => openWatch(deps, "game.nope", undefined, () => {}))).toMatchObject({
      code: -32_601,
      data: { reason: "unknown_id", retryable: false, id: "game.nope" }
    });
    expect(deps.state.watches.size).toBe(0);
  });

  it("throws the entry error for an invalid input and opens no door watch", () => {
    const deps = createDeps();
    const source = positionOf(deps);

    expect(thrownBy(() => openWatch(deps, "game.position", "bad", () => {}))).toMatchObject({
      code: -32_602
    });
    expect(source.opened).toBe(0);
    expect(deps.state.watches.size).toBe(0);
  });

  it("forgets the watch when the door watch itself throws", () => {
    const deps = createDeps();
    const source = positionOf(deps);
    const failure = new Error("door refused");
    source.watch = () => {
      throw failure;
    };

    expect(thrownBy(() => openWatch(deps, "game.position", undefined, () => {}))).toBe(failure);
    expect(deps.state.watches.size).toBe(0);
  });

  it("propagates an onValue error on the first value and opens no door watch", () => {
    const deps = createDeps();
    const source = positionOf(deps);
    const boom = new Error("listener broke");

    expect(
      thrownBy(() =>
        openWatch(deps, "game.position", undefined, () => {
          throw boom;
        })
      )
    ).toBe(boom);
    expect(source.opened).toBe(0);
    expect(deps.state.watches.size).toBe(0);
  });
});

describe("openWatch — door deliveries", () => {
  it("drops the first door delivery equal to the first read", () => {
    const deps = createDeps();
    const source = positionOf(deps);
    const values: Json[] = [];

    openWatch(deps, "game.position", undefined, value => values.push(value));
    source.frame({ path: "home" });

    expect(values).toEqual([{ path: "home" }]);
  });

  it("delivers a first door delivery that differs from the first read", () => {
    const deps = createDeps();
    const source = positionOf(deps);
    const values: Json[] = [];

    openWatch(deps, "game.position", undefined, value => values.push(value));
    source.frame({ path: "board" });

    expect(values).toEqual([{ path: "home" }, { path: "board" }]);
  });

  it("dedupes the first delivery only: later equal deliveries reach onValue", () => {
    const deps = createDeps();
    const source = positionOf(deps);
    const values: Json[] = [];

    openWatch(deps, "game.position", undefined, value => values.push(value));
    source.frame({ path: "home" });
    source.frame({ path: "home" });
    source.frame({ path: "home" });

    expect(values).toEqual([{ path: "home" }, { path: "home" }, { path: "home" }]);
  });
});

describe("openWatch — stop", () => {
  it("registers stop in state.watches and removes it on stop", () => {
    const deps = createDeps();

    const stop = openWatch(deps, "game.position", undefined, () => {});
    expect(deps.state.watches.has(stop)).toBe(true);

    stop();
    expect(deps.state.watches.size).toBe(0);
  });

  it("is idempotent: the door stop runs once", () => {
    const deps = createDeps();
    const source = positionOf(deps);

    const stop = openWatch(deps, "game.position", undefined, () => {});
    stop();
    stop();

    expect(source.stopped).toBe(1);
    expect(source.doors.size).toBe(0);
  });

  it("delivers nothing after stop", () => {
    const deps = createDeps();
    const source = positionOf(deps);
    const values: Json[] = [];
    let late: ((value: Json) => void) | undefined;
    source.watch = (_raw, fn) => {
      late = fn;
      return noop;
    };

    const stop = openWatch(deps, "game.position", undefined, value => values.push(value));
    stop();
    late?.({ path: "board" });

    expect(values).toEqual([{ path: "home" }]);
  });

  it("allows stop inside onValue: the door callback is removed", () => {
    const deps = createDeps();
    const source = positionOf(deps);
    const values: Json[] = [];
    let stop: (() => void) | undefined;

    stop = openWatch(deps, "game.position", undefined, value => {
      values.push(value);
      if (values.length === 2) stop?.();
    });
    source.frame({ path: "board" });
    source.frame({ path: "level" });

    expect(values).toEqual([{ path: "home" }, { path: "board" }]);
    expect(source.doors.size).toBe(0);
    expect(deps.state.watches.size).toBe(0);
  });

  it("closes the door at once when a synchronous door delivery stops the watch", () => {
    const deps = createDeps();
    const sync = fakeSource("game.sync", 1);
    sync.watch = (_raw, fn) => {
      sync.opened += 1;
      fn(2);
      return () => {
        sync.stopped += 1;
      };
    };
    deps.registry.sources.set("game.sync", sync);
    const values: Json[] = [];
    const stop = openWatch(deps, "game.sync", undefined, value => {
      values.push(value);
      if (value === 2) closeAll(deps.state.watches);
    });

    expect(values).toEqual([1, 2]);
    expect(sync.stopped).toBe(1);
    expect(deps.state.watches.size).toBe(0);
    stop();
    expect(sync.stopped).toBe(1);
  });

  it("adds stop before the door opens, so a stop in the first door delivery leaves no watch", () => {
    const deps = createDeps();
    const sync = fakeSource("game.sync", 1);
    const seenAtOpen: number[] = [];
    sync.watch = (_raw, fn) => {
      seenAtOpen.push(deps.state.watches.size);
      fn(2);
      return noop;
    };
    deps.registry.sources.set("game.sync", sync);
    const values: Json[] = [];

    openWatch(deps, "game.sync", undefined, value => {
      values.push(value);
      if (value === 2) closeAll(deps.state.watches);
    });

    expect(values).toEqual([1, 2]);
    expect(seenAtOpen).toEqual([1]);
    expect(deps.state.watches.size).toBe(0);
  });
});

/**
 * A door stop that does nothing.
 */
function noop(): void {
  // nothing to close
}

/**
 * Calls every stop of a watch set (what onStop does).
 *
 * @param watches - The stops.
 */
function closeAll(watches: Set<() => void>): void {
  for (const stop of watches) stop();
}

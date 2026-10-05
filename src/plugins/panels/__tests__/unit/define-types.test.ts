/* eslint-disable unicorn/no-null -- null is a JSON value on the wire */
import { h } from "preact";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { Json, RunResult } from "../../../registry/protocol";
import type { CommandArgs, SourceValue, Wire } from "../../catalogue";
import { definePanel } from "../../define";
import type { PanelTools, PanelValues } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// Typing spike, step 2 (11-panels): the value of a source id and the input of
// a command id flow from `@moku-labs/game/inspect` and `/control` (type-only).
// These tests fail at `tsc` time when the map is wrong; each also asserts at
// run time so vitest counts it.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A panel with a workspace that is not one of the six (compile-time check only).
 */
const buildBadWorkspace = () =>
  definePanel({
    id: "bad",
    title: "Bad",
    // @ts-expect-error -- not one of the six workspaces
    workspace: "nope",
    sources: {},
    view: () => h("div", null)
  });

/**
 * A panel whose view passes a wrong command input (compile-time check only).
 */
const buildWrongInput = () =>
  definePanel({
    id: "step",
    title: "Step",
    workspace: "flow",
    sources: {},
    commands: { step: "game.step" },
    view: (_values, tools) => {
      // @ts-expect-error -- frames must be a number
      const pending = tools.run.step({ frames: true });
      return h("div", { title: String(pending !== undefined) });
    }
  });

describe("catalogue spike: source values", () => {
  it("game.position has path: string", () => {
    expectTypeOf<SourceValue<"game.position">>().toHaveProperty("path").toEqualTypeOf<string>();
    // flow is `string | undefined` in the game: undefined at top level of a field → optional key.
    expectTypeOf<SourceValue<"game.position">["waiting"]>().toEqualTypeOf<string[]>();
    const position: SourceValue<"game.position"> = {
      path: "board/awaitIntent",
      node: "awaitIntent",
      waiting: ["tap"]
    };
    expect(position.path).toBe("board/awaitIntent");
  });

  it("game.history is an array of entries", () => {
    expectTypeOf<SourceValue<"game.history">>().toBeArray();
    expectTypeOf<SourceValue<"game.history">[number]["outcome"]>().toEqualTypeOf<string>();
    const history: SourceValue<"game.history"> = [];
    expect(history).toEqual([]);
  });

  it("game.locate (undefined at top level) becomes a rect or null", () => {
    expectTypeOf<SourceValue<"game.locate">>().toEqualTypeOf<{
      x: number;
      y: number;
      w: number;
      h: number;
    } | null>();
    const rect: SourceValue<"game.locate"> = null;
    expect(rect).toBeNull();
  });

  it("game.ui is a recursive node tree", () => {
    expectTypeOf<SourceValue<"game.ui">["children"][number]["key"]>().toEqualTypeOf<
      string | undefined
    >();
    expectTypeOf<SourceValue<"game.ui">["type"]>().toEqualTypeOf<string>();
    expect(true).not.toBe(false);
  });

  it("an id of a .dev module and an unknown id are Json", () => {
    expectTypeOf<SourceValue<"merge.coins">>().toEqualTypeOf<Json>();
    expectTypeOf<SourceValue<"nope">>().toEqualTypeOf<Json>();
    const coins: SourceValue<"merge.coins"> = 120;
    expect(coins).toBe(120);
  });
});

describe("catalogue spike: Wire<T>", () => {
  it("a Map-valued field becomes { $map: [key, value][] } and a Set { $set }", () => {
    type Value = Wire<{ readonly counts: ReadonlyMap<string, number>; readonly tags: Set<string> }>;
    expectTypeOf<Value["counts"]>().toEqualTypeOf<{ $map: [string, number][] }>();
    expectTypeOf<Value["tags"]>().toEqualTypeOf<{ $set: string[] }>();
    const value: Value = { counts: { $map: [["wood", 4]] }, tags: { $set: ["a"] } };
    expect(value.counts.$map).toHaveLength(1);
  });

  it("an Error-valued field becomes { $error: { name, message } }", () => {
    type Value = Wire<{ readonly failure: Error }>;
    expectTypeOf<Value["failure"]>().toEqualTypeOf<{ $error: { name: string; message: string } }>();
    const value: Value = { failure: { $error: { name: "Error", message: "boom" } } };
    expect(value.failure.$error.name).toBe("Error");
  });

  it("drops function keys, makes undefined-able keys optional, nulls undefined array items", () => {
    type Value = Wire<{
      readonly run: () => void;
      readonly label: string | undefined;
      readonly items: readonly (number | undefined)[];
    }>;
    expectTypeOf<Value>().toEqualTypeOf<{ label?: string; items: (number | null)[] }>();
    const value: Value = { items: [1, null] };
    expect(value.items).toHaveLength(2);
  });

  it("primitives stay; functions, symbols and bigint are never; unknown is Json", () => {
    expectTypeOf<Wire<number>>().toEqualTypeOf<number>();
    expectTypeOf<Wire<undefined>>().toEqualTypeOf<null>();
    expectTypeOf<Wire<() => void>>().toBeNever();
    expectTypeOf<Wire<symbol>>().toBeNever();
    expectTypeOf<Wire<bigint>>().toBeNever();
    expectTypeOf<Wire<unknown>>().toEqualTypeOf<Json>();
    expect(Number.isFinite(1)).toBe(true);
  });
});

describe("catalogue spike: command inputs", () => {
  it("game.step requires frames; game.pause takes no input; unknown ids take Json", () => {
    expectTypeOf<CommandArgs<"game.step">>().toEqualTypeOf<
      [input: { frames: number; deltaMs?: number | undefined }]
    >();
    expectTypeOf<CommandArgs<"game.pause">>().toEqualTypeOf<[input?: Record<never, never>]>();
    expectTypeOf<CommandArgs<"merge.addCoins">>().toEqualTypeOf<[input?: Json]>();
    expect(true).toBe(true);
  });

  it("tools.run: step without input is a type error, with frames passes, pause passes", () => {
    type Tools = PanelTools<{ readonly step: "game.step"; readonly pause: "game.pause" }>;
    const use = (tools: Tools): Promise<RunResult>[] => [
      // @ts-expect-error -- frames is required
      tools.run.step(),
      tools.run.step({ frames: 1 }),
      // @ts-expect-error -- frames must be a number
      tools.run.step({ frames: "1" }),
      tools.run.pause()
    ];
    expect(typeof use).toBe("function");
  });
});

describe("definePanel inference", () => {
  it("types values from the source ids, tuple refs included", () => {
    const panel = definePanel({
      id: "flow",
      title: "Flow",
      workspace: "flow",
      sources: {
        position: "game.position",
        history: ["game.history", { last: 20 }],
        coins: "merge.coins"
      },
      commands: { step: "game.step" },
      view: (values, tools) => {
        expectTypeOf(values.position.path).toEqualTypeOf<string>();
        expectTypeOf(values.history).toBeArray();
        expectTypeOf(values.coins).toEqualTypeOf<Json>();
        expectTypeOf(tools.run.step).parameters.toEqualTypeOf<
          [input: { frames: number; deltaMs?: number | undefined }]
        >();
        // @ts-expect-error -- the view reads a key it did not declare
        const undeclared: unknown = values.graph;
        return h("div", { title: String(undeclared) }, values.position.path);
      }
    });
    expect(panel.id).toBe("flow");
  });

  it("rejects a bad workspace id and a wrong command input at compile time", () => {
    expect(typeof buildBadWorkspace).toBe("function");
    expect(typeof buildWrongInput).toBe("function");
  });

  it("PanelValues of an empty source map is empty", () => {
    expectTypeOf<PanelValues<Record<never, never>>>().toEqualTypeOf<Record<never, never>>();
    expect({}).toEqual({});
  });
});
